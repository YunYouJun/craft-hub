import type { CraftHubPlugin, LoadCraftHubPluginsResult } from './plugins'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { loadCraftHubPlugins } from './plugins'

const registrationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  manifestPath: z.string().refine(isAbsolute, 'An absolute manifest path is required'),
  modules: z.array(z.string().refine(isAbsolute, 'An absolute module path is required')).min(1),
  enabled: z.boolean(),
})
const stateSchema = z.object({ schemaVersion: z.literal(1), extensions: z.array(registrationSchema) })

/** Machine-local installation of explicitly trusted executable host modules. */
export type HostExtension = z.infer<typeof registrationSchema>

/** Installation state and the result of the last application startup. */
export interface HostExtensionStatus {
  extensions: HostExtension[]
  diagnostics: LoadCraftHubPluginsResult['diagnostics']
  restartRequired: boolean
}

/**
 * Manage trusted host extensions independently of declarative Marketplace plugins.
 * Only a trusted host installation flow may register modules. Registration never
 * imports code; startup imports only the saved module list, never a changed manifest.
 */
export class HostExtensionManager {
  readonly path: string
  private writeTail: Promise<unknown> = Promise.resolve()
  private startupState?: string
  private diagnostics: LoadCraftHubPluginsResult['diagnostics'] = []

  constructor(dataDir: string) {
    this.path = resolve(dataDir, 'host-extensions.json')
  }

  /** Inspect saved extensions without executing their code. */
  async status(): Promise<HostExtensionStatus> {
    const extensions = await this.read()
    return {
      extensions,
      diagnostics: structuredClone(this.diagnostics),
      restartRequired: this.startupState !== undefined && this.startupState !== JSON.stringify(extensions),
    }
  }

  /** Prepare a reviewable installation from a host-supplied module list, without importing it. */
  prepare(input: { id: string, name: string, manifestPath: string, modules: string[] }): HostExtension {
    const manifestPath = resolve(input.manifestPath)
    const require = createRequire(manifestPath)
    const modules = input.modules.map(specifier => isAbsolute(specifier)
      ? specifier
      : specifier.startsWith('.') ? resolve(dirname(manifestPath), specifier) : require.resolve(specifier))
    return registrationSchema.parse({ ...input, manifestPath, modules, enabled: true })
  }

  /** Persist an installation after the host has obtained explicit trust for its exact modules. */
  async install(extension: HostExtension): Promise<void> {
    const parsed = registrationSchema.parse(extension)
    await this.mutate(items => [...items.filter(item => item.id !== parsed.id), parsed])
  }

  /** Save whether an installed extension should load on the next startup. */
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.mutate((items) => {
      const item = items.find(item => item.id === id)
      if (!item)
        throw new Error(`Host extension is not installed: ${id}`)
      item.enabled = enabled
      return items
    })
  }

  /** Remove registration only; local source files and Marketplace plugins are retained. */
  async remove(id: string): Promise<void> {
    await this.mutate(items => items.filter(item => item.id !== id))
  }

  /** Load saved extensions on startup, isolating failures and preserving host-owned providers. */
  async load(builtinPlugins: CraftHubPlugin[] = [], preloadedModules: string[] = []): Promise<LoadCraftHubPluginsResult> {
    const plugins = [...builtinPlugins]
    this.diagnostics = []
    let extensions: HostExtension[]
    try {
      extensions = await this.read()
      this.startupState = JSON.stringify(extensions)
    }
    catch (error) {
      this.diagnostics.push({ pluginId: this.path, phase: 'load', message: errorMessage(error) })
      return { plugins, diagnostics: structuredClone(this.diagnostics) }
    }
    for (const extension of extensions.filter(item => item.enabled)) {
      const loaded = await loadCraftHubPlugins(extension.modules.filter(path => !preloadedModules.includes(path)))
      // An extension is activated as a whole. Partial registrations must not leave
      // a broken provider set or replace another explicitly configured provider.
      try {
        if (loaded.diagnostics.length)
          throw new Error(loaded.diagnostics.map(item => item.message).join('\n'))
        assertCompatiblePlugins([...plugins, ...loaded.plugins])
        plugins.push(...loaded.plugins)
      }
      catch (error) {
        this.diagnostics.push({ pluginId: extension.id, phase: 'load', message: errorMessage(error) })
      }
    }
    return { plugins, diagnostics: structuredClone(this.diagnostics) }
  }

  private async read(): Promise<HostExtension[]> {
    try {
      const { extensions } = stateSchema.parse(JSON.parse(await readFile(this.path, 'utf8')))
      if (new Set(extensions.map(item => item.id)).size !== extensions.length)
        throw new Error('Duplicate host extension id')
      return extensions
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return []
      throw error
    }
  }

  private async mutate(update: (items: HostExtension[]) => HostExtension[]): Promise<void> {
    const operation = this.writeTail.then(async () => {
      const extensions = update(await this.read())
      const value = stateSchema.parse({ schemaVersion: 1, extensions })
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
        await rename(temporary, this.path)
      }
      finally {
        await rm(temporary, { force: true })
      }
    })
    this.writeTail = operation.catch(() => {})
    await operation
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertCompatiblePlugins(plugins: CraftHubPlugin[]): void {
  const groups = [
    plugins.map(plugin => plugin.id),
    plugins.flatMap(plugin => plugin.integrationProviders?.map(provider => provider.id) ?? []),
    plugins.flatMap(plugin => plugin.workspaceRepositoryProviders?.map(provider => provider.id) ?? []),
    plugins.flatMap(plugin => plugin.workspaceCatalogProviders?.map(provider => provider.id) ?? []),
  ]
  for (const ids of groups) {
    if (new Set(ids).size !== ids.length)
      throw new Error('Host extension conflicts with an already loaded plugin or provider')
  }
  if (plugins.filter(plugin => plugin.accountProvider).length > 1)
    throw new Error('Only one host account provider can be configured')
}

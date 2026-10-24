import type { CraftHubPlugin } from 'craft-hub'
import { Buffer } from 'node:buffer'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { createWorkstationPlugin, resolveLocalExecutable, workstationTransport } from '@craft-hub/craft-hub-plugin-workstation'

/** Application-owned backend metadata, distinct from user-installed Marketplace declarations. */
export interface BundledWorkstation { schemaVersion: 1, version: string, revision: string }

/** Remove native backup keys from the general child environment, retaining them only for configuration operations. */
export function takeConfigurationBackupKeys(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keys: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('CRAFT_HUB_BACKUP_KEY_'))
      continue
    delete env[name]
    if (/^[A-Z][A-Z0-9_]*$/.test(name) && name.length <= 128 && value !== undefined && Buffer.byteLength(value) <= 16384)
      keys[name] = value
  }
  return keys
}

/** Validate only the fixed app resource; a manifest cannot select an executable path. */
export function readBundledWorkstation(directory: string): BundledWorkstation | undefined {
  const file = join(directory, 'runtime.json')
  if (!existsSync(file))
    return
  const value = JSON.parse(readFileSync(file, 'utf8')) as BundledWorkstation
  const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name?: string, version?: string }
  if (value.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(value.version) || !/^[a-f0-9]{40}$/.test(value.revision)
    || metadata.name !== '@yunyoujun/workstation' || metadata.version !== value.version || !existsSync(join(directory, 'dist/cli.js'))) {
    throw new Error('Invalid bundled Workstation backend')
  }
  return value
}

/** Prefer an explicitly configured or installed CLI; fresh desktops use their prebuilt app backend. */
export function desktopWorkstation(options: {
  directory: string
  executable?: string
  /** Non-macOS Electron hosts retain their existing backend mode; macOS packages supply an independent Node. */
  electronNodeMode?: boolean
  homeDirectory?: string
  env?: NodeJS.ProcessEnv
  configurationEnvironment?: NodeJS.ProcessEnv
}): { plugin: CraftHubPlugin, bundled?: BundledWorkstation } {
  const env = options.env ?? process.env
  const home = options.homeDirectory ?? homedir()
  const installed = (): { plugin: CraftHubPlugin } => ({ plugin: createWorkstationPlugin(workstationTransport(env.CRAFT_HUB_WORKSTATION_COMMAND ?? 'workstation', [], 'configuration', options.configurationEnvironment)) })
  if (env.CRAFT_HUB_WORKSTATION_COMMAND)
    return installed()
  try {
    resolveLocalExecutable('workstation', { homeDirectory: home, env })
    return installed()
  }
  catch { /* A fresh machine can use the signed application's own backend. */ }
  const bundled = readBundledWorkstation(options.directory)
  if (!bundled)
    return installed()
  const command = options.executable ?? process.execPath
  const args = [join(options.directory, 'dist/cli.js')]
  // Configuration sources stay in the user's checkout, so reviewed writes never modify the application bundle.
  const environment = { NODE_OPTIONS: undefined, NODE_PATH: undefined, ELECTRON_RUN_AS_NODE: options.electronNodeMode ? '1' : undefined, DOTFILES_REPO_ROOT: env.DOTFILES_REPO_ROOT ?? join(home, 'repos/github.com/YunYouJun/workstation') }
  return {
    bundled,
    plugin: createWorkstationPlugin(
      workstationTransport(command, args, 'configuration', { ...environment, ...options.configurationEnvironment }),
      workstationTransport(command, args, 'software-json', environment),
      workstationTransport(command, args, 'host-json', environment),
      { homeDirectory: home, sourceDirectory: environment.DOTFILES_REPO_ROOT, managed: true, invocation: { command, args, environment } },
    ),
  }
}

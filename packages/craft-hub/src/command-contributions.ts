import type { ProjectCommandInputConfig, ProjectConfig } from './project-config-schema'
import type { Capability, CapabilityDiscoveryDiagnostic, CommandCapability, CommandCategory, CommandPackage } from './types'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { z } from 'zod'
import { loadProjectConfig } from './config'
import { commandInputs, localizedText } from './discovery'
import { projectCommandInputSchema } from './project-config-schema'

const safePackageFile = z.string().min(1).refine(value => !isAbsolute(value) && !value.split(/[\\/]/).includes('..'), 'Package markers must stay inside the package')

/** Declarative matcher evaluated only against discovered workspace package roots. */
export const commandPackageMatcherSchema = z.strictObject({
  allFiles: z.array(safePackageFile).default([]),
  anyFiles: z.array(safePackageFile).default([]),
}).refine(value => value.allFiles.length > 0 || value.anyFiles.length > 0, 'A package matcher must declare at least one marker')

/** Declarative enhancement for commands already discovered by Craft Hub. */
export const commandPresetContributionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  commands: z.array(z.string().min(1)).min(1),
  unlessCommands: z.array(z.string().min(1)).default([]),
  package: commandPackageMatcherSchema,
  inputs: z.record(z.string(), projectCommandInputSchema).refine(value => Object.keys(value).length > 0, 'A command preset must contribute at least one input'),
})

/** Declarative command instantiated at each matching workspace package root. */
export const commandTemplateContributionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  category: z.enum(['build', 'deploy', 'develop', 'other', 'preview', 'quality', 'test']).optional(),
  package: commandPackageMatcherSchema,
  unlessCommands: z.array(z.string().min(1)).default([]),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  requiredEnv: z.array(z.string()).default([]),
  inputPreset: z.string().min(1).optional(),
  inputs: z.record(z.string(), projectCommandInputSchema).default({}),
})

/** Files that identify a workspace package eligible for a contribution. */
export type CommandPackageMatcher = z.infer<typeof commandPackageMatcherSchema>
/** Declarative input enhancement for an existing discovered command. */
export type CommandPresetContribution = z.infer<typeof commandPresetContributionSchema>
/** Declarative command created when a matching package lacks that command. */
export type CommandTemplateContribution = z.infer<typeof commandTemplateContributionSchema>

/** One installed plugin's declarative command contributions. */
export interface PluginCommandContributions {
  pluginId: string
  source: string
  presets: CommandPresetContribution[]
  templates: CommandTemplateContribution[]
}

/** Inputs required to resolve installed plugin contributions for one Project. */
export interface ResolveCommandContributionsInput {
  projectPath: string
  locale: string
  capabilities: Capability[]
  packages: CommandPackage[]
  plugins: PluginCommandContributions[]
}

/** Capabilities and non-fatal diagnostics produced by contribution resolution. */
export interface ResolveCommandContributionsResult {
  capabilities: Capability[]
  diagnostics: CapabilityDiscoveryDiagnostic[]
}

/**
 * Resolve installed declarative command contributions against safe package roots.
 *
 * Original discovery remains authoritative. Presets fill an unconfigured input
 * surface, templates fill missing commands, and project JSONC is the final
 * repository-owned override.
 */
export async function resolveCommandContributions(input: ResolveCommandContributionsInput): Promise<ResolveCommandContributionsResult> {
  const config = await loadProjectConfig(input.projectPath)
  const disabled = new Set(config?.capabilities?.disabledPresets ?? [])
  const diagnostics: CapabilityDiscoveryDiagnostic[] = []
  const capabilities = [...input.capabilities]
  const packageRoots = new Map(input.packages.map(commandPackage => [commandPackage.relativePath, resolve(input.projectPath, commandPackage.relativePath)]))
  const presetInputs = new Map<string, { pluginId: string, inputs: Record<string, ProjectCommandInputConfig> }[]>()

  for (const plugin of input.plugins) {
    for (const preset of plugin.presets) {
      const qualifiedId = `${plugin.pluginId}:${preset.id}`
      if (disabled.has(preset.id) || disabled.has(qualifiedId))
        continue
      for (const capability of capabilities) {
        if (capability.kind !== 'command' || !preset.commands.includes(capability.name) || !capability.package)
          continue
        const packageRoot = packageRoots.get(capability.package.relativePath)
        if (!packageRoot || !await packageMatches(packageRoot, preset.package))
          continue
        const packageCommands = capabilities.filter((item): item is CommandCapability => item.kind === 'command' && item.package?.relativePath === capability.package?.relativePath)
        if (preset.unlessCommands.some(name => packageCommands.some(item => item.name === name)))
          continue
        const entries = presetInputs.get(capability.id) ?? []
        entries.push({ pluginId: plugin.pluginId, inputs: preset.inputs })
        presetInputs.set(capability.id, entries)
      }
    }
  }

  for (let index = 0; index < capabilities.length; index++) {
    const capability = capabilities[index]!
    if (capability.kind !== 'command' || capability.inputs)
      continue
    const contributions = presetInputs.get(capability.id) ?? []
    const conflict = conflictingInput(contributions)
    if (conflict) {
      diagnostics.push(pluginDiagnostic(capability.package?.relativePath ?? '.', `Command ${capability.name} has conflicting plugin input "${conflict}"; no preset was applied.`))
      continue
    }
    const merged = Object.assign({}, ...contributions.map(item => item.inputs)) as Record<string, ProjectCommandInputConfig>
    if (Object.keys(merged).length)
      capabilities[index] = { ...capability, inputs: commandInputs(merged, input.locale), inputArgSeparator: capability.source.endsWith('package.json') ? '--' : capability.inputArgSeparator }
  }

  for (const plugin of input.plugins) {
    for (const template of plugin.templates) {
      const qualifiedId = `${plugin.pluginId}:${template.id}`
      if (disabled.has(template.id) || disabled.has(qualifiedId))
        continue
      for (const commandPackage of input.packages) {
        const packageRoot = packageRoots.get(commandPackage.relativePath)!
        if (!await packageMatches(packageRoot, template.package))
          continue
        const packageCommands = capabilities.filter((capability): capability is CommandCapability => capability.kind === 'command' && capability.package?.relativePath === commandPackage.relativePath)
        if (template.unlessCommands.some(name => packageCommands.some(capability => capability.name === name)))
          continue
        const id = templateCapabilityId(plugin.pluginId, template.id, commandPackage.relativePath)
        if (capabilities.some(capability => capability.id === id)) {
          diagnostics.push(pluginDiagnostic(commandPackage.relativePath, `Plugin command template produced duplicate capability id: ${id}`))
          continue
        }
        const referencedInputs = template.inputPreset
          ? plugin.presets.find(preset => preset.id === template.inputPreset)?.inputs
          : undefined
        if (template.inputPreset && !referencedInputs) {
          diagnostics.push(pluginDiagnostic(commandPackage.relativePath, `Command template ${template.id} references unknown input preset: ${template.inputPreset}`))
          continue
        }
        const templateInputs = referencedInputs ?? template.inputs
        const command: CommandCapability = {
          id,
          kind: 'command',
          name: template.name,
          description: template.description,
          source: plugin.source,
          category: template.category as CommandCategory | undefined,
          package: commandPackage,
          invocation: { command: template.command, args: template.args, cwd: packageRoot, requiredEnv: template.requiredEnv },
          availability: await executableAvailability(template.command),
          ...(Object.keys(templateInputs).length ? { inputs: commandInputs(templateInputs, input.locale) } : {}),
        }
        capabilities.push(applyProjectCommandOverride(command, config, input.locale))
      }
    }
  }

  return {
    capabilities: capabilities.map(capability => capability.kind === 'command' ? applyProjectCommandOverride(capability, config, input.locale) : capability),
    diagnostics,
  }
}

async function executableAvailability(command: string): Promise<{ available: boolean, diagnostic?: string }> {
  const pathEntries = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
    : ['']
  for (const directory of pathEntries) {
    for (const extension of extensions) {
      try {
        await access(join(directory, `${command}${extension}`), constants.X_OK)
        return { available: true }
      }
      catch {}
    }
  }
  return { available: false, diagnostic: `Required command is not available on PATH: ${command}` }
}

async function packageMatches(packageRoot: string, matcher: CommandPackageMatcher): Promise<boolean> {
  const all = await Promise.all(matcher.allFiles.map(file => markerExists(packageRoot, file)))
  if (all.some(exists => !exists))
    return false
  if (!matcher.anyFiles.length)
    return true
  return (await Promise.all(matcher.anyFiles.map(file => markerExists(packageRoot, file)))).some(Boolean)
}

async function markerExists(packageRoot: string, marker: string): Promise<boolean> {
  const target = resolve(packageRoot, marker)
  const relativePath = relative(packageRoot, target)
  if (relativePath.startsWith('..') || isAbsolute(relativePath))
    return false
  try {
    await access(target)
    return true
  }
  catch {
    return false
  }
}

function conflictingInput(contributions: Array<{ pluginId: string, inputs: Record<string, ProjectCommandInputConfig> }>): string | undefined {
  const owners = new Map<string, string>()
  for (const contribution of contributions) {
    for (const inputId of Object.keys(contribution.inputs)) {
      const owner = owners.get(inputId)
      if (owner && owner !== contribution.pluginId)
        return inputId
      owners.set(inputId, contribution.pluginId)
    }
  }
}

function applyProjectCommandOverride(command: CommandCapability, config: ProjectConfig | undefined, locale: string): CommandCapability {
  const descriptions = config?.capabilities?.descriptions
  const configuredDescription = descriptions?.[command.id] ?? descriptions?.[command.name] ?? descriptions?.[`${command.source}:${command.name}`]
  const configuredInputs = config?.capabilities?.inputs?.[command.id] ?? config?.capabilities?.inputs?.[command.name] ?? config?.capabilities?.inputs?.[`${command.source}:${command.name}`]
  const configuredOperation = config?.capabilities?.operations?.[command.id] ?? config?.capabilities?.operations?.[command.name] ?? config?.capabilities?.operations?.[`${command.source}:${command.name}`]
  const defaultOperation = command.name === 'release' && command.package?.relativePath === '.'
    ? { kind: 'release' as const, requiresCleanGit: true }
    : undefined
  return {
    ...command,
    ...(configuredDescription ? { description: localizedText(configuredDescription, locale) } : {}),
    ...(configuredInputs ? { inputs: commandInputs(configuredInputs, locale) } : {}),
    ...((configuredOperation || defaultOperation)
      ? { operation: { ...defaultOperation, ...configuredOperation, kind: 'release' as const, requiresCleanGit: configuredOperation?.requiresCleanGit ?? defaultOperation?.requiresCleanGit ?? true } }
      : {}),
  }
}

function templateCapabilityId(pluginId: string, templateId: string, packageRelativePath: string): string {
  const packageHash = createHash('sha256').update(packageRelativePath).digest('hex').slice(0, 10)
  return `plugin:${pluginId}:template:${templateId}:${packageHash}`
}

function pluginDiagnostic(path: string, message: string): CapabilityDiscoveryDiagnostic {
  return { source: 'plugin', path, message }
}

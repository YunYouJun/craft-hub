import type { ProjectCommandInputConfig, ProjectConfig } from './project-config-schema'
import type { Capability, CapabilityDiscoveryDiagnostic, CommandCapability, CommandCategory, CommandPackage } from './types'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, readFile, realpath, stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { z } from 'zod'
import { loadProjectConfig } from './config'
import { commandInputs, localizedText } from './discovery'
import { projectCommandInputSchema } from './project-config-schema'

const contributionLocalizedTextSchema = z.union([
  z.string().min(1),
  z.object({ default: z.string().min(1) }).catchall(z.string().min(1)),
])

const safePackageFile = z.string().min(1).refine(value => !isAbsolute(value) && !value.split(/[\\/]/).includes('..'), 'Package markers must stay inside the package')
const userSettingKey = z.string().regex(/^extensions\.(?!_)\w[\w.-]*\.(?!_)\w[\w.-]*$/i, 'User setting sources must use extensions.<plugin>.<setting>')

const commandInputOptionSourceSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('package-json-array'),
    files: z.array(safePackageFile).min(1),
    path: z.array(z.string().min(1)).min(1),
    valueKey: z.string().min(1).optional(),
    labelKey: z.string().min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('user-setting'),
    key: userSettingKey,
  }),
])

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
  optionSources: z.record(z.string(), commandInputOptionSourceSchema).default({}),
  /** Whether this reusable preset also enhances matching repository-owned commands. */
  applyToCommands: z.boolean().default(true),
}).superRefine((preset, context) => {
  for (const input of Object.keys(preset.optionSources)) {
    if (preset.inputs[input]?.type !== 'select')
      context.addIssue({ code: 'custom', message: `Option source must reference a select input: ${input}`, path: ['optionSources', input] })
  }
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
  toolGroup: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).optional(),
})

/** Declarative package tool surface that groups plugin commands and links. */
export const packageToolGroupContributionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  title: contributionLocalizedTextSchema,
  description: contributionLocalizedTextSchema.optional(),
  package: commandPackageMatcherSchema,
})

/** Declarative package overview actions resolved against discovered capabilities. */
export const packageQuickActionContributionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  package: commandPackageMatcherSchema,
  capabilities: z.array(z.string().min(1)).min(1),
})

const secureUrlTemplateSchema = z.string().min(1).refine((value) => {
  if (value.split('{value}').length !== 2)
    return false
  try {
    const url = new URL(value.replace('{value}', 'example'))
    return url.protocol === 'https:' && !url.username && !url.password
  }
  catch {
    return false
  }
}, 'Package link templates must be credential-free HTTPS URLs containing one {value} placeholder')

/** Declarative package link resolved from a quoted literal in a bounded config file. */
export const packageLinkContributionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  title: contributionLocalizedTextSchema,
  description: contributionLocalizedTextSchema.optional(),
  package: commandPackageMatcherSchema,
  urlTemplate: secureUrlTemplateSchema,
  value: z.strictObject({
    files: z.array(safePackageFile).min(1),
    key: z.string().regex(/^[a-z_$][\w$]*$/i),
  }),
  toolGroup: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).optional(),
})

/** Files that identify a workspace package eligible for a contribution. */
export type CommandPackageMatcher = z.infer<typeof commandPackageMatcherSchema>
/** Declarative input enhancement for an existing discovered command. */
export type CommandPresetContribution = z.infer<typeof commandPresetContributionSchema>
/** Bounded package JSON or user-setting source used to extend select options. */
export type CommandInputOptionSource = z.infer<typeof commandInputOptionSourceSchema>
/** Declarative command created when a matching package lacks that command. */
export type CommandTemplateContribution = z.infer<typeof commandTemplateContributionSchema>
/** Package matcher and localized metadata for a plugin-owned command surface. */
export type PackageToolGroupContribution = z.infer<typeof packageToolGroupContributionSchema>
/** Package matcher and capability selectors contributed to matching package overviews. */
export type PackageQuickActionContribution = z.infer<typeof packageQuickActionContributionSchema>
/** Package matcher, literal metadata source, and HTTPS template for one overview link. */
export type PackageLinkContribution = z.infer<typeof packageLinkContributionSchema>

/** One installed plugin's declarative command contributions. */
export interface PluginCommandContributions {
  pluginId: string
  source: string
  presets: CommandPresetContribution[]
  templates: CommandTemplateContribution[]
  packageQuickActions?: PackageQuickActionContribution[]
  packageLinks?: PackageLinkContribution[]
  packageToolGroups?: PackageToolGroupContribution[]
}

/** Inputs required to resolve installed plugin contributions for one Project. */
export interface ResolveCommandContributionsInput {
  projectPath: string
  locale: string
  capabilities: Capability[]
  packages: CommandPackage[]
  plugins: PluginCommandContributions[]
  userSettings?: Record<string, unknown>
}

/** Capabilities and non-fatal diagnostics produced by contribution resolution. */
export interface ResolveCommandContributionsResult {
  capabilities: Capability[]
  diagnostics: CapabilityDiscoveryDiagnostic[]
  packages: CommandPackage[]
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
  const presetInputs = new Map<string, { pluginId: string, preset: CommandPresetContribution, packageRoot: string }[]>()

  for (const plugin of input.plugins) {
    for (const preset of plugin.presets) {
      if (!preset.applyToCommands)
        continue
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
        entries.push({ pluginId: plugin.pluginId, preset, packageRoot })
        presetInputs.set(capability.id, entries)
      }
    }
  }

  for (let index = 0; index < capabilities.length; index++) {
    const capability = capabilities[index]!
    if (capability.kind !== 'command' || capability.inputs)
      continue
    const contributions = presetInputs.get(capability.id) ?? []
    const conflict = conflictingInput(contributions.map(item => ({ pluginId: item.pluginId, inputs: item.preset.inputs })))
    if (conflict) {
      diagnostics.push(pluginDiagnostic(capability.package?.relativePath ?? '.', `Command ${capability.name} has conflicting plugin input "${conflict}"; no preset was applied.`))
      continue
    }
    const resolved = await Promise.all(contributions.map(item => resolvePresetInputs(item.preset, item.packageRoot, input.userSettings ?? {})))
    const merged = Object.assign({}, ...resolved) as Record<string, ProjectCommandInputConfig>
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
        const referencedPreset = template.inputPreset
          ? plugin.presets.find(preset => preset.id === template.inputPreset)
          : undefined
        if (template.inputPreset && !referencedPreset) {
          diagnostics.push(pluginDiagnostic(commandPackage.relativePath, `Command template ${template.id} references unknown input preset: ${template.inputPreset}`))
          continue
        }
        const templateInputs = referencedPreset
          ? await resolvePresetInputs(referencedPreset, packageRoot, input.userSettings ?? {})
          : template.inputs
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
          ...(template.toolGroup ? { toolGroupId: qualifiedToolGroupId(plugin.pluginId, template.toolGroup) } : {}),
          ...(Object.keys(templateInputs).length ? { inputs: commandInputs(templateInputs, input.locale) } : {}),
        }
        capabilities.push(applyProjectCommandOverride(command, config, input.locale))
      }
    }
  }

  const resolvedPackages = await Promise.all(input.packages.map(async (commandPackage) => {
    let resolvedPackage = commandPackage
    const packageRoot = packageRoots.get(commandPackage.relativePath)!
    const toolGroups = [...(commandPackage.toolGroups ?? [])]
    for (const plugin of input.plugins) {
      for (const contribution of plugin.packageToolGroups ?? []) {
        if (!await packageMatches(packageRoot, contribution.package))
          continue
        const id = qualifiedToolGroupId(plugin.pluginId, contribution.id)
        if (toolGroups.some(group => group.id === id))
          continue
        toolGroups.push({
          id,
          title: localizedText(contribution.title, input.locale) ?? contribution.id,
          ...(contribution.description ? { description: localizedText(contribution.description, input.locale) } : {}),
          source: plugin.source,
        })
      }
    }
    if (toolGroups.length)
      resolvedPackage = { ...resolvedPackage, toolGroups }
    if (commandPackage.quickActions === undefined) {
      const selectors: string[] = []
      for (const plugin of input.plugins) {
        for (const contribution of plugin.packageQuickActions ?? []) {
          if (!await packageMatches(packageRoot, contribution.package))
            continue
          for (const selector of contribution.capabilities) {
            if (!selectors.includes(selector))
              selectors.push(selector)
          }
        }
      }
      if (selectors.length)
        resolvedPackage = { ...resolvedPackage, quickActions: selectors }
    }

    const links = [...(commandPackage.links ?? [])]
    for (const plugin of input.plugins) {
      for (const contribution of plugin.packageLinks ?? []) {
        if (!await packageMatches(packageRoot, contribution.package))
          continue
        const value = await packageLiteralValue(packageRoot, contribution.value.files, contribution.value.key)
        if (!value)
          continue
        const id = `${plugin.pluginId}:${contribution.id}`
        if (links.some(link => link.id === id))
          continue
        links.push({
          id,
          title: localizedText(contribution.title, input.locale) ?? contribution.id,
          ...(contribution.description ? { description: localizedText(contribution.description, input.locale) } : {}),
          url: contribution.urlTemplate.replace('{value}', encodeURIComponent(value)),
          source: plugin.source,
          ...(contribution.toolGroup ? { toolGroupId: qualifiedToolGroupId(plugin.pluginId, contribution.toolGroup) } : {}),
        })
      }
    }
    return links.length ? { ...resolvedPackage, links } : resolvedPackage
  }))
  const resolvedPackagesByPath = new Map(resolvedPackages.map(commandPackage => [commandPackage.relativePath, commandPackage]))

  return {
    capabilities: capabilities.map((capability) => {
      if (capability.kind !== 'command')
        return capability
      const configured = applyProjectCommandOverride(capability, config, input.locale)
      const commandPackage = configured.package && resolvedPackagesByPath.get(configured.package.relativePath)
      return commandPackage ? { ...configured, package: commandPackage } : configured
    }),
    diagnostics,
    packages: resolvedPackages,
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

async function packageLiteralValue(packageRoot: string, files: string[], key: string): Promise<string | undefined> {
  const canonicalRoot = await realpath(packageRoot)
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:["']${escapedKey}["']|\\b${escapedKey}\\b)\\s*:\\s*(["'])([^"'\\r\\n]+)\\1`)
  for (const file of files) {
    const target = resolve(packageRoot, file)
    try {
      const canonicalTarget = await realpath(target)
      const offset = relative(canonicalRoot, canonicalTarget)
      if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset))
        continue
      const metadata = await stat(canonicalTarget)
      if (!metadata.isFile() || metadata.size > 64 * 1024)
        continue
      const match = pattern.exec(await readFile(canonicalTarget, 'utf8'))
      const value = match?.[2]?.trim()
      if (value && value.length <= 256)
        return value
    }
    catch {}
  }
}

async function resolvePresetInputs(preset: CommandPresetContribution, packageRoot: string, userSettings: Record<string, unknown>): Promise<Record<string, ProjectCommandInputConfig>> {
  const resolved = structuredClone(preset.inputs)
  for (const [inputId, source] of Object.entries(preset.optionSources ?? {})) {
    const definition = resolved[inputId]
    if (!definition || definition.type !== 'select')
      continue
    const sourced = source.type === 'user-setting'
      ? userSettingOptions(userSettings[source.key])
      : await packageJsonArrayOptions(packageRoot, source)
    const options = [...definition.options]
    for (const option of sourced) {
      if (!options.some(existing => (typeof existing === 'string' ? existing : existing.value) === option.value))
        options.push(option.label ? option : option.value)
    }
    resolved[inputId] = { ...definition, options }
  }
  return resolved
}

function userSettingOptions(value: unknown): Array<{ value: string, label?: string }> {
  if (!Array.isArray(value))
    return []
  return value.slice(0, 100).flatMap((item) => {
    if (typeof item === 'string')
      return validSourcedOption(item) ? [{ value: item }] : []
    if (!item || typeof item !== 'object' || Array.isArray(item))
      return []
    const record = item as Record<string, unknown>
    if (!validSourcedOption(record.value))
      return []
    return [{ value: record.value, ...(validSourcedOption(record.label) ? { label: record.label } : {}) }]
  })
}

async function packageJsonArrayOptions(packageRoot: string, source: Extract<CommandInputOptionSource, { type: 'package-json-array' }>): Promise<Array<{ value: string, label?: string }>> {
  for (const file of source.files) {
    const document = await boundedPackageJson(packageRoot, file)
    if (document === undefined)
      continue
    let current: unknown = document
    for (const segment of source.path) {
      if (!current || typeof current !== 'object') {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[segment]
    }
    if (!Array.isArray(current))
      continue
    return current.slice(0, 100).flatMap((item) => {
      if (source.valueKey === undefined)
        return validSourcedOption(item) ? [{ value: item }] : []
      if (!item || typeof item !== 'object' || Array.isArray(item))
        return []
      const record = item as Record<string, unknown>
      const value = record[source.valueKey]
      if (!validSourcedOption(value))
        return []
      const label = source.labelKey ? record[source.labelKey] : undefined
      return [{ value, ...(validSourcedOption(label) ? { label } : {}) }]
    })
  }
  return []
}

async function boundedPackageJson(packageRoot: string, file: string): Promise<unknown | undefined> {
  try {
    const canonicalRoot = await realpath(packageRoot)
    const canonicalTarget = await realpath(resolve(packageRoot, file))
    const offset = relative(canonicalRoot, canonicalTarget)
    if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset))
      return undefined
    const metadata = await stat(canonicalTarget)
    if (!metadata.isFile() || metadata.size > 256 * 1024)
      return undefined
    return JSON.parse(await readFile(canonicalTarget, 'utf8')) as unknown
  }
  catch {
    return undefined
  }
}

function validSourcedOption(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !value.includes('\0')
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

function qualifiedToolGroupId(pluginId: string, groupId: string): string {
  return `${pluginId}:${groupId}`
}

function pluginDiagnostic(path: string, message: string): CapabilityDiscoveryDiagnostic {
  return { source: 'plugin', path, message }
}

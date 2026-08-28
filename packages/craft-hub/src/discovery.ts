import type { LocalizedText, ProjectCommandInputConfig, ProjectSkillInputConfig } from './config'
import type { Capability, CapabilityDiscoveryDiagnostic, CapabilityDiscoveryResult, CapabilitySource, CommandCapability, CommandCategory, CommandInputDefinition, CommandPackage, SkillCapability, SkillInputDefinition } from './types'
import { createHash } from 'node:crypto'
import { access, readdir, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { glob } from 'tinyglobby'
import { isMap, isScalar, parseDocument, parse as parseYaml } from 'yaml'
import { loadProjectConfig } from './config'

function localizedText(value: LocalizedText | undefined, locale: string): string | undefined {
  if (typeof value === 'string')
    return value
  if (!value || Array.isArray(value))
    return undefined

  const candidates = [locale]
  let parent = locale
  while (parent.includes('-')) {
    parent = parent.slice(0, parent.lastIndexOf('-'))
    candidates.push(parent)
  }
  candidates.push('default')

  return candidates.map(candidate => value[candidate]).find(description => typeof description === 'string')
}

function configuredValue<T>(values: Record<string, T>, capability: Capability): T | undefined {
  return values[capability.id]
    ?? values[`${capability.source}:${capability.name}`]
    ?? values[capability.name]
}

function skillInputs(config: Record<string, ProjectSkillInputConfig>, locale: string): SkillInputDefinition[] {
  const entries = Object.entries(config)
  const ids = new Set(entries.map(([input]) => input))
  return entries.map(([input, definition]) => {
    if (!/^[a-z][\w-]*$/i.test(input))
      throw new Error(`Invalid skill input id: ${input}`)
    for (const condition of [definition.requiredWhen, definition.visibleWhen]) {
      if (condition && (!ids.has(condition.input) || typeof condition.equals !== 'string'))
        throw new Error(`Skill input ${input} references an unknown condition input`)
    }
    const pattern = definition.pattern ? new RegExp(definition.pattern) : undefined
    const options = definition.options?.map(option => typeof option === 'string'
      ? { value: option }
      : { value: option.value, label: localizedText(option.label, locale) })
    if (definition.type === 'select' && (!options?.length || options.some(option => !option.value)))
      throw new Error(`Select skill input ${input} must declare non-empty options`)
    if (definition.default && definition.type === 'select' && !options?.some(option => option.value === definition.default))
      throw new Error(`Default value for skill input ${input} must match an option`)

    return {
      id: input,
      type: definition.type,
      label: localizedText(definition.label, locale),
      description: localizedText(definition.description, locale),
      options,
      default: definition.default,
      required: definition.required,
      requiredWhen: definition.requiredWhen,
      visibleWhen: definition.visibleWhen,
      pattern: pattern ? definition.pattern : undefined,
    }
  })
}

function commandInputs(config: Record<string, ProjectCommandInputConfig>, locale: string): CommandInputDefinition[] {
  const entries = Object.entries(config)
  const ids = new Set(entries.map(([input]) => input))
  return entries.map(([input, definition]) => {
    if (!/^[a-z][\w-]*$/i.test(input))
      throw new Error(`Invalid command input id: ${input}`)
    if (!definition || !['select', 'text'].includes(definition.type))
      throw new Error(`Command input ${input} must use type select or text`)
    if (typeof definition.flag !== 'string' || !definition.flag.startsWith('-') || /\s/.test(definition.flag))
      throw new Error(`Command input ${input} must declare a flag without whitespace`)
    if (definition.argumentStyle && !['equals', 'separate'].includes(definition.argumentStyle))
      throw new Error(`Command input ${input} has an invalid argumentStyle`)
    for (const condition of [definition.requiredWhen, definition.visibleWhen]) {
      if (condition && (!ids.has(condition.input) || typeof condition.equals !== 'string'))
        throw new Error(`Command input ${input} references an unknown condition input`)
    }
    const pattern = definition.pattern ? new RegExp(definition.pattern) : undefined

    const options = definition.options?.map((option) => {
      if (typeof option === 'string')
        return { value: option }
      if (option.omitArgument !== undefined && typeof option.omitArgument !== 'boolean')
        throw new Error(`Select command input ${input} option ${option.value} has an invalid omitArgument`)
      return { value: option.value, label: localizedText(option.label, locale), omitArgument: option.omitArgument }
    })
    if (definition.type === 'select' && (!options?.length || options.some(option => !option.value)))
      throw new Error(`Select command input ${input} must declare non-empty options`)
    if (definition.default && definition.type === 'select' && !options?.some(option => option.value === definition.default))
      throw new Error(`Default value for command input ${input} must match an option`)

    return {
      id: input,
      type: definition.type,
      label: localizedText(definition.label, locale),
      description: localizedText(definition.description, locale),
      options,
      default: definition.default,
      required: definition.required,
      requiredWhen: definition.requiredWhen,
      visibleWhen: definition.visibleWhen,
      pattern: pattern ? definition.pattern : undefined,
      flag: definition.flag,
      argumentStyle: definition.argumentStyle,
    }
  })
}

function id(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 20)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

async function packageManager(cwd: string, packageJson: Record<string, unknown>): Promise<string> {
  if (typeof packageJson.packageManager === 'string')
    return packageJson.packageManager.split('@')[0]!
  if (await exists(join(cwd, 'pnpm-lock.yaml')))
    return 'pnpm'
  if (await exists(join(cwd, 'yarn.lock')))
    return 'yarn'
  if (await exists(join(cwd, 'bun.lockb')) || await exists(join(cwd, 'bun.lock')))
    return 'bun'
  return 'npm'
}

function packageDescription(value: unknown): string | undefined {
  if (typeof value !== 'string')
    return undefined
  const description = value.trim()
  return description && description !== '_description_' ? description : undefined
}

const rootCommandPackage = (name?: string, description?: string): CommandPackage => ({ name, description, relativePath: '.', root: true })

/** Infer a stable presentation category from a package script or task name. */
export function commandCategory(name: string): CommandCategory {
  const normalized = name.replace(/^(?:pre|post)(?=[a-z])/, '').toLowerCase()
  const prefix = normalized.split(':', 1)[0]!
  if (['dev', 'serve', 'start'].includes(prefix))
    return 'develop'
  if (['build', 'bundle', 'compile', 'generate'].includes(prefix))
    return 'build'
  if (['e2e', 'integration', 'test', 'vitest'].includes(prefix))
    return 'test'
  if (['check', 'format', 'lint', 'typecheck'].includes(prefix))
    return 'quality'
  if (prefix === 'preview')
    return 'preview'
  if (['deploy', 'publish', 'release'].includes(prefix) || normalized === 'publishonly')
    return 'deploy'
  return 'other'
}

function lineNumberAt(content: string, offset: number): number {
  return content.slice(0, offset).split('\n').length
}

function mappingEntryLines(content: string, mappingName: string): Map<string, number> {
  const mapping = parseDocument(content).get(mappingName, true)
  if (!isMap(mapping))
    return new Map()

  return new Map(mapping.items.flatMap((pair) => {
    const key = pair.key
    return isScalar(key) && typeof key.value === 'string' && key.range
      ? [[key.value, lineNumberAt(content, key.range[0])]]
      : []
  }))
}

async function discoverPackageScripts(
  projectRoot: string,
  cwd: string,
  commandPackage: CommandPackage,
  manager?: string,
): Promise<CommandCapability[]> {
  const path = join(cwd, 'package.json')
  if (!await exists(path))
    return []
  const content = await readFile(path, 'utf8')
  const manifest = JSON.parse(content) as Record<string, unknown>
  const scripts = manifest.scripts && typeof manifest.scripts === 'object' ? manifest.scripts as Record<string, unknown> : {}
  const resolvedManager = manager ?? await packageManager(cwd, manifest)
  const sourceLines = mappingEntryLines(content, 'scripts')
  const source = commandPackage.root ? 'package.json' : `${commandPackage.relativePath}/package.json`
  return Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, script]) => ({
      id: id(projectRoot, source, name),
      kind: 'command',
      name,
      description: script,
      source,
      sourcePath: path,
      sourceLine: sourceLines.get(name),
      category: commandCategory(name),
      package: { ...commandPackage, name: typeof manifest.name === 'string' ? manifest.name : commandPackage.name },
      invocation: { command: resolvedManager, args: ['run', name], cwd, requiredEnv: [] },
    }))
}

function manifestPattern(pattern: string): string {
  const negated = pattern.startsWith('!')
  const directoryPattern = (negated ? pattern.slice(1) : pattern).replace(/\/+$/, '')
  return `${negated ? '!' : ''}${directoryPattern}/package.json`
}

function portablePath(path: string): string {
  return path.split(sep).join('/')
}

function isInside(root: string, target: string): boolean {
  const relativePath = relative(root, target)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

async function discoverPnpmWorkspacePackages(projectRoot: string): Promise<{ capabilities: CommandCapability[], diagnostics: CapabilityDiscoveryDiagnostic[], packages: CommandPackage[] }> {
  const workspacePath = join(projectRoot, 'pnpm-workspace.yaml')
  if (!await exists(workspacePath))
    return { capabilities: [], diagnostics: [], packages: [] }

  const document = parseYaml(await readFile(workspacePath, 'utf8')) as { packages?: unknown } | undefined
  if (!document || document.packages === undefined)
    return { capabilities: [], diagnostics: [], packages: [] }
  if (!Array.isArray(document.packages) || !document.packages.every(pattern => typeof pattern === 'string'))
    throw new Error('pnpm-workspace.yaml must declare packages as an array of glob patterns')

  const root = await realpath(projectRoot)
  const manifests = await glob(document.packages.map(manifestPattern), {
    cwd: projectRoot,
    dot: true,
    expandDirectories: false,
    followSymbolicLinks: false,
    onlyFiles: true,
  })
  const diagnostics: CapabilityDiscoveryDiagnostic[] = []
  const capabilities: CommandCapability[] = []
  const packages: CommandPackage[] = []
  const seen = new Set<string>()

  for (const relativeManifest of manifests.sort()) {
    const manifestPath = join(projectRoot, relativeManifest)
    const packageDirectory = dirname(manifestPath)
    let canonicalDirectory: string
    try {
      canonicalDirectory = await realpath(packageDirectory)
    }
    catch (error) {
      diagnostics.push({ source: 'pnpm-workspace', path: portablePath(relativeManifest), message: error instanceof Error ? error.message : String(error) })
      continue
    }
    if (!isInside(root, canonicalDirectory)) {
      diagnostics.push({ source: 'pnpm-workspace', path: portablePath(relativeManifest), message: 'Workspace package resolves outside the project and was skipped.' })
      continue
    }
    const relativeDirectory = portablePath(relative(root, canonicalDirectory)) || '.'
    if (relativeDirectory === '.' || seen.has(canonicalDirectory))
      continue
    seen.add(canonicalDirectory)
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
      const commandPackage: CommandPackage = {
        name: typeof manifest.name === 'string' ? manifest.name : undefined,
        description: packageDescription(manifest.description),
        relativePath: relativeDirectory,
        root: false,
      }
      const packageCapabilities = await discoverPackageScripts(projectRoot, canonicalDirectory, commandPackage, 'pnpm')
      packages.push(commandPackage)
      capabilities.push(...packageCapabilities)
    }
    catch (error) {
      diagnostics.push({ source: 'pnpm-workspace', path: portablePath(relativeManifest), message: error instanceof Error ? error.message : String(error) })
    }
  }

  return { capabilities, diagnostics, packages }
}

async function discoverMakeTargets(cwd: string, commandPackage: CommandPackage): Promise<CommandCapability[]> {
  const path = join(cwd, 'Makefile')
  if (!await exists(path))
    return []
  const content = await readFile(path, 'utf8')
  const targets = [...content.matchAll(/^(\w[\w.-]*):(?:\s|$)/gm)]
    .filter(match => !match[1]!.includes('%'))
  const uniqueTargets = new Map(targets.map(match => [match[1]!, lineNumberAt(content, match.index)]))
  return [...uniqueTargets].map(([name, sourceLine]) => ({
    id: id(cwd, 'Makefile', name),
    kind: 'command',
    name,
    source: 'Makefile',
    sourcePath: path,
    sourceLine,
    category: commandCategory(name),
    package: commandPackage,
    invocation: { command: 'make', args: [name], cwd, requiredEnv: [] },
  }))
}

async function discoverTaskfileTasks(cwd: string, commandPackage: CommandPackage): Promise<CommandCapability[]> {
  const path = (await exists(join(cwd, 'Taskfile.yml'))) ? join(cwd, 'Taskfile.yml') : join(cwd, 'Taskfile.yaml')
  if (!await exists(path))
    return []
  const content = await readFile(path, 'utf8')
  const document = parseYaml(content) as { tasks?: Record<string, string | { desc?: string }> }
  const sourceLines = mappingEntryLines(content, 'tasks')
  return Object.entries(document.tasks ?? {}).map(([name, task]) => ({
    id: id(cwd, 'Taskfile', name),
    kind: 'command',
    name,
    description: typeof task === 'object' ? task.desc : undefined,
    source: 'Taskfile',
    sourcePath: path,
    sourceLine: sourceLines.get(name),
    category: commandCategory(name),
    package: commandPackage,
    invocation: { command: 'task', args: [name], cwd, requiredEnv: [] },
  }))
}

function skillMetadata(content: string, fallbackName: string): { name: string, description?: string } {
  if (!content.startsWith('---\n'))
    return { name: fallbackName }
  const closing = content.indexOf('\n---', 4)
  if (closing < 0)
    return { name: fallbackName }
  const metadata = parseYaml(content.slice(4, closing)) as { name?: unknown, description?: unknown }
  return {
    name: typeof metadata.name === 'string' ? metadata.name : fallbackName,
    description: typeof metadata.description === 'string' ? metadata.description : undefined,
  }
}

async function discoverSkills(cwd: string): Promise<SkillCapability[]> {
  const roots: Array<[string, CapabilitySource]> = [
    ['.agents/skills', 'agent-skill'],
    ['.claude/skills', 'claude-skill'],
    ['.codex/skills', 'codex-skill'],
  ]
  const results: SkillCapability[] = []
  const canonicalPaths = new Set<string>()
  const contentHashes = new Set<string>()

  for (const [relativeRoot, source] of roots) {
    const root = join(cwd, relativeRoot)
    if (!await exists(root))
      continue
    const directories = await readdir(root, { withFileTypes: true })
    for (const directory of directories.filter(entry => entry.isDirectory())) {
      const path = join(root, directory.name, 'SKILL.md')
      if (!await exists(path))
        continue
      const canonicalPath = await realpath(path)
      const content = await readFile(canonicalPath, 'utf8')
      const contentHash = createHash('sha256').update(content).digest('hex')
      if (canonicalPaths.has(canonicalPath) || contentHashes.has(contentHash))
        continue
      canonicalPaths.add(canonicalPath)
      contentHashes.add(contentHash)
      const metadata = skillMetadata(content, basename(directory.name))
      results.push({
        id: id(cwd, source, canonicalPath, contentHash),
        kind: 'skill',
        name: metadata.name,
        description: metadata.description,
        source,
        path: canonicalPath,
        contentHash,
        content,
      })
    }
  }
  return results
}

function compareCapabilities(left: Capability, right: Capability): number {
  if (left.kind !== right.kind)
    return left.kind === 'command' ? -1 : 1
  if (left.kind === 'command' && right.kind === 'command') {
    const rootDifference = Number(right.package?.root ?? true) - Number(left.package?.root ?? true)
    if (rootDifference)
      return rootDifference
    const packageDifference = (left.package?.relativePath ?? '.').localeCompare(right.package?.relativePath ?? '.', undefined, { numeric: true })
    if (packageDifference)
      return packageDifference
  }
  return left.name.localeCompare(right.name, undefined, { numeric: true })
}

/** Discover built-in command and skill capabilities plus non-fatal pnpm workspace diagnostics. */
export async function discoverCapabilitiesWithDiagnostics(cwd: string, locale = 'en'): Promise<CapabilityDiscoveryResult> {
  const rootPackagePath = join(cwd, 'package.json')
  const rootManifest = await exists(rootPackagePath)
    ? JSON.parse(await readFile(rootPackagePath, 'utf8')) as Record<string, unknown>
    : {}
  const commandPackage = rootCommandPackage(
    typeof rootManifest.name === 'string' ? rootManifest.name : undefined,
    packageDescription(rootManifest.description),
  )
  const workspace = await discoverPnpmWorkspacePackages(cwd)
  const groups = await Promise.all([
    discoverPackageScripts(cwd, cwd, commandPackage),
    discoverMakeTargets(cwd, commandPackage),
    discoverTaskfileTasks(cwd, commandPackage),
    discoverSkills(cwd),
  ])
  const projectConfig = await loadProjectConfig(cwd)
  const capabilityConfig = projectConfig?.capabilities
  const hidden = new Set(capabilityConfig?.hidden ?? [])
  const descriptions = capabilityConfig?.descriptions ?? {}
  const inputs = capabilityConfig?.inputs ?? {}
  const configuredSkillInputs = capabilityConfig?.skillInputs ?? {}
  const capabilities = [...groups.flat(), ...workspace.capabilities]
    .filter(capability => !hidden.has(capability.id) && !hidden.has(capability.name) && !hidden.has(`${capability.source}:${capability.name}`))
    .map((capability) => {
      const configuredDescription = configuredValue(descriptions, capability)
      const description = localizedText(configuredDescription, locale)
      if (capability.kind !== 'command') {
        const configuredInputs = configuredValue(configuredSkillInputs, capability)
        return {
          ...capability,
          ...(description ? { description } : {}),
          ...(configuredInputs ? { inputs: skillInputs(configuredInputs, locale) } : {}),
        }
      }
      const configuredInputs = configuredValue(inputs, capability)
      return {
        ...capability,
        ...(description ? { description } : {}),
        ...(configuredInputs
          ? {
              inputs: commandInputs(configuredInputs, locale),
              ...(capability.source.endsWith('package.json') ? { inputArgSeparator: '--' as const } : {}),
            }
          : {}),
      }
    })
    .sort(compareCapabilities)
  const packages = [commandPackage, ...workspace.packages].map((commandPackage) => {
    const configuredDescription = localizedText(projectConfig?.packages?.[commandPackage.relativePath]?.description, locale)
    return configuredDescription ? { ...commandPackage, description: configuredDescription } : commandPackage
  })
  const packageDescriptions = new Map(packages.map(commandPackage => [commandPackage.relativePath, commandPackage.description]))
  const localizedCapabilities = capabilities.map((capability) => {
    if (capability.kind !== 'command' || !capability.package)
      return capability
    const description = packageDescriptions.get(capability.package.relativePath)
    return description === capability.package.description
      ? capability
      : { ...capability, package: { ...capability.package, description } }
  })
  return { capabilities: localizedCapabilities, diagnostics: workspace.diagnostics, packages }
}

/** Discover built-in command and skill capabilities for one project. */
export async function discoverCapabilities(cwd: string, locale = 'en'): Promise<Capability[]> {
  return (await discoverCapabilitiesWithDiagnostics(cwd, locale)).capabilities
}

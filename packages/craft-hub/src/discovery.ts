import type { LocalizedText } from './config'
import type { Capability, CapabilitySource, CommandCapability, SkillCapability } from './types'
import { createHash } from 'node:crypto'
import { access, readdir, readFile, realpath } from 'node:fs/promises'
import { basename, join } from 'node:path'
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

async function discoverPackageScripts(cwd: string): Promise<CommandCapability[]> {
  const path = join(cwd, 'package.json')
  if (!await exists(path))
    return []
  const content = await readFile(path, 'utf8')
  const manifest = JSON.parse(content) as Record<string, unknown>
  const scripts = manifest.scripts && typeof manifest.scripts === 'object' ? manifest.scripts as Record<string, unknown> : {}
  const manager = await packageManager(cwd, manifest)
  const sourceLines = mappingEntryLines(content, 'scripts')
  return Object.entries(scripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, script]) => ({
      id: id(cwd, 'package.json', name),
      kind: 'command',
      name,
      description: script,
      source: 'package.json',
      sourcePath: path,
      sourceLine: sourceLines.get(name),
      invocation: { command: manager, args: ['run', name], cwd, requiredEnv: [] },
    }))
}

async function discoverMakeTargets(cwd: string): Promise<CommandCapability[]> {
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
    invocation: { command: 'make', args: [name], cwd, requiredEnv: [] },
  }))
}

async function discoverTaskfileTasks(cwd: string): Promise<CommandCapability[]> {
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

/** Discover built-in command and skill capabilities for one project. */
export async function discoverCapabilities(cwd: string, locale = 'en'): Promise<Capability[]> {
  const groups = await Promise.all([
    discoverPackageScripts(cwd),
    discoverMakeTargets(cwd),
    discoverTaskfileTasks(cwd),
    discoverSkills(cwd),
  ])
  const capabilityConfig = (await loadProjectConfig(cwd))?.capabilities
  const hidden = new Set(capabilityConfig?.hidden ?? [])
  const descriptions = capabilityConfig?.descriptions ?? {}
  return groups.flat()
    .filter(capability => !hidden.has(capability.id) && !hidden.has(capability.name) && !hidden.has(`${capability.source}:${capability.name}`))
    .map((capability) => {
      const configuredDescription = descriptions[capability.id]
        ?? descriptions[`${capability.source}:${capability.name}`]
        ?? descriptions[capability.name]
      const description = localizedText(configuredDescription, locale)
      return description ? { ...capability, description } : capability
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

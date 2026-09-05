import type { CapabilityDiscoveryDiagnostic, CommandPackage, LocalSkillActivationSettings, ProjectSkillStatus, SkillActivationEvidence, SkillActivationScope, SkillActivationSettings, SkillCapability } from './types'
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { glob } from 'tinyglobby'
import { z } from 'zod'

const ignoredPatterns = ['**/.git/**', '**/node_modules/**', '**/build/**', '**/coverage/**', '**/dist/**', '**/out/**', '**/target/**', '**/vendor/**']
const safeProjectPattern = z.string().min(1).max(256).refine(value => !isAbsolute(value) && !value.split(/[\\/]/).includes('..'), 'Pattern must stay inside its project scope')
const packageManagerFiles = {
  bun: ['bun.lock', 'bun.lockb'],
  npm: ['package-lock.json'],
  pnpm: ['pnpm-lock.yaml', 'pnpm-workspace.yaml'],
  yarn: ['yarn.lock'],
} as const

/** Bounded project fact expression contributed by one Marketplace Skill. */
export type SkillActivationCondition
  = | { file: string }
    | { dependency: string }
    | { packageManager: 'bun' | 'npm' | 'pnpm' | 'yarn' }
    | { all: SkillActivationCondition[] }
    | { any: SkillActivationCondition[] }
    | { not: SkillActivationCondition }

const recursiveConditionSchema: z.ZodType<SkillActivationCondition> = z.lazy(() => z.union([
  z.strictObject({ file: safeProjectPattern }),
  z.strictObject({ dependency: z.string().min(1).max(214).regex(/^(?:@[^/\s]+\/)?[^/\s]+$/) }),
  z.strictObject({ packageManager: z.enum(['bun', 'npm', 'pnpm', 'yarn']) }),
  z.strictObject({ all: z.array(recursiveConditionSchema).min(1).max(16) }),
  z.strictObject({ any: z.array(recursiveConditionSchema).min(1).max(16) }),
  z.strictObject({ not: recursiveConditionSchema }),
]))

/** Runtime validator for declarative Skill activation expressions. */
export const skillActivationConditionSchema = recursiveConditionSchema.superRefine((condition, context) => {
  const size = conditionSize(condition)
  if (size.depth > 8)
    context.addIssue({ code: 'custom', message: 'Skill activation expressions may be at most 8 levels deep' })
  if (size.nodes > 64)
    context.addIssue({ code: 'custom', message: 'Skill activation expressions may contain at most 64 conditions' })
})

/** Runtime validator for one stable Skill reference and optional package scopes. */
export const skillActivationRuleSchema = z.strictObject({
  id: z.string().min(1),
  scopes: z.array(safeProjectPattern).min(1).optional(),
})

/** Runtime validator shared by repository and local Skill activation settings. */
export const skillActivationSettingsSchema = z.strictObject({
  mode: z.enum(['auto', 'manual']).optional(),
  enabledPlugins: z.array(z.string().min(1)).optional(),
  disabledPlugins: z.array(z.string().min(1)).optional(),
  enabled: z.array(skillActivationRuleSchema).optional(),
  disabled: z.array(skillActivationRuleSchema).optional(),
})

/** Runtime validator for machine-local settings and remembered invocation scopes. */
export const localSkillActivationSettingsSchema = skillActivationSettingsSchema.extend({
  selectedScopes: z.record(z.string(), safeProjectPattern).optional(),
})

/** Installed, data-only Skill declaration passed across the Marketplace seam. */
export interface InstalledSkillContribution {
  pluginId: string
  version: string
  source: string
  packagePath: string
  projectFiles: string[]
  skill: {
    id: string
    path: string
    activation?: SkillActivationCondition
  }
}

/** Complete inputs for one project-level Skill activation pass. */
export interface ResolveSkillActivationsInput {
  projectPath: string
  packages: CommandPackage[]
  contributions: InstalledSkillContribution[]
  project?: SkillActivationSettings
  local?: LocalSkillActivationSettings
}

/** Available capabilities, management state, and watcher hints from one pass. */
export interface ResolvedSkillActivations {
  capabilities: SkillCapability[]
  diagnostics: CapabilityDiscoveryDiagnostic[]
  skills: ProjectSkillStatus[]
  mode: 'auto' | 'manual'
  modeSource: 'default' | 'local' | 'project'
  missingPluginIds: string[]
  watchPatterns: string[]
}

interface ConditionResult {
  matched: boolean
  evidence: SkillActivationEvidence[]
}

interface ScopeCandidate {
  relativePath: string
  packageName?: string
  rootPath: string
}

/** Resolve every installed Marketplace Skill behind one small, deterministic interface. */
export async function resolveSkillActivations(input: ResolveSkillActivationsInput): Promise<ResolvedSkillActivations> {
  const project = input.project ?? {}
  const local = input.local ?? {}
  const mode = local.mode ?? project.mode ?? 'manual'
  const modeSource = local.mode ? 'local' : project.mode ? 'project' : 'default'
  const scopeCandidates = projectScopes(input.projectPath, input.packages)
  const capabilities: SkillCapability[] = []
  const skills: ProjectSkillStatus[] = []
  const diagnostics: CapabilityDiscoveryDiagnostic[] = []
  const watchPatterns = new Set<string>()

  for (const contribution of input.contributions) {
    const capabilityId = skillCapabilityId(contribution.pluginId, contribution.skill.id)
    try {
      const references = [capabilityId, `${contribution.pluginId}:${contribution.skill.id}`]
      const documentPath = safePath(contribution.packagePath, contribution.skill.path)
      const content = await readBoundedRegularFile(documentPath, contribution.packagePath)
      const metadata = skillMetadata(content, contribution.skill.path)
      const explicit = explicitScopes(references, contribution.pluginId, scopeCandidates, project, local)
      let automaticScopes: SkillActivationScope[] = []

      if (mode === 'auto' && contribution.skill.activation) {
        const projectFilesResult = await evaluateProjectFiles(input.projectPath, contribution.projectFiles)
        for (const file of contribution.projectFiles)
          watchPatterns.add(file)
        for (const candidate of scopeCandidates) {
          const result = await evaluateCondition(contribution.skill.activation, candidate, input.projectPath)
          for (const pattern of watchedPatterns(contribution.skill.activation, candidate.relativePath))
            watchPatterns.add(pattern)
          if (projectFilesResult.matched && result.matched) {
            automaticScopes.push({
              relativePath: candidate.relativePath,
              packageName: candidate.packageName,
              evidence: [...projectFilesResult.evidence, ...result.evidence],
            })
          }
        }
      }

      if (explicit.projectPluginDisabled)
        automaticScopes = []
      let scopes = mergeScopes(automaticScopes, explicit.projectEnabled)
      scopes = scopes.filter(scope => !matchesRules(explicit.projectDisabled, scope.relativePath))
      if (explicit.localPluginDisabled)
        scopes = []
      scopes = mergeScopes(scopes, explicit.localEnabled)
      scopes = scopes.filter(scope => !matchesRules(explicit.localDisabled, scope.relativePath))
      const activationSource = explicit.localEnabled.length || explicit.localDisabled.length || explicit.localPluginEnabled || explicit.localPluginDisabled
        ? 'local' as const
        : explicit.projectEnabled.length || explicit.projectDisabled.length || explicit.projectPluginEnabled || explicit.projectPluginDisabled
          ? 'project' as const
          : scopes.length
            ? 'automatic' as const
            : undefined
      const status: ProjectSkillStatus['status'] = scopes.length
        ? 'enabled'
        : explicit.projectDisabled.length || explicit.localDisabled.length || explicit.projectPluginDisabled || explicit.localPluginDisabled
          ? 'disabled'
          : !contribution.skill.activation
              ? 'manual-only'
              : mode === 'manual'
                ? 'manual-only'
                : 'unmatched'

      if (scopes.length) {
        capabilities.push({
          id: capabilityId,
          kind: 'skill',
          name: metadata.name,
          description: metadata.description,
          source: contribution.source,
          path: documentPath,
          content,
          contentHash: sha256(content),
          activation: { source: activationSource!, scopes },
        })
      }
      skills.push({
        id: capabilityId,
        pluginId: contribution.pluginId,
        name: metadata.name,
        description: metadata.description,
        source: contribution.source,
        status,
        activationSource,
        scopes,
      })
    }
    catch (error) {
      diagnostics.push({
        source: 'plugin',
        path: `${contribution.pluginId}:${contribution.skill.path}`,
        message: error instanceof Error ? error.message : String(error),
      })
      skills.push({
        id: capabilityId,
        pluginId: contribution.pluginId,
        name: contribution.skill.id,
        source: contribution.source,
        status: 'disabled',
        scopes: [],
      })
    }
  }

  const installedPlugins = new Set(input.contributions.map(contribution => contribution.pluginId))
  const configuredPlugins = [
    ...(project.enabledPlugins ?? []),
    ...(local.enabledPlugins ?? []),
    ...(project.disabledPlugins ?? []),
    ...(local.disabledPlugins ?? []),
    ...[...(project.enabled ?? []), ...(local.enabled ?? []), ...(project.disabled ?? []), ...(local.disabled ?? [])].flatMap(rule => pluginIdFromReference(rule.id)),
  ]
  return {
    capabilities,
    diagnostics,
    skills,
    mode,
    modeSource,
    missingPluginIds: [...new Set(configuredPlugins.filter(pluginId => !installedPlugins.has(pluginId)))].sort(),
    watchPatterns: mode === 'auto' ? [...watchPatterns].sort() : [],
  }
}

function conditionSize(condition: SkillActivationCondition): { depth: number, nodes: number } {
  if ('all' in condition || 'any' in condition) {
    const children = ('all' in condition ? condition.all : condition.any).map(conditionSize)
    return { depth: 1 + Math.max(...children.map(child => child.depth)), nodes: 1 + children.reduce((sum, child) => sum + child.nodes, 0) }
  }
  if ('not' in condition) {
    const child = conditionSize(condition.not)
    return { depth: child.depth + 1, nodes: child.nodes + 1 }
  }
  return { depth: 1, nodes: 1 }
}

function projectScopes(projectPath: string, packages: CommandPackage[]): ScopeCandidate[] {
  const byPath = new Map<string, ScopeCandidate>()
  byPath.set('.', { relativePath: '.', rootPath: projectPath, packageName: packages.find(item => item.relativePath === '.')?.name })
  for (const item of packages) {
    if (!byPath.has(item.relativePath))
      byPath.set(item.relativePath, { relativePath: item.relativePath, rootPath: safePath(projectPath, item.relativePath), packageName: item.name })
  }
  return [...byPath.values()]
}

async function evaluateProjectFiles(projectPath: string, files: string[]): Promise<ConditionResult> {
  const results = await Promise.all(files.map(file => evaluateFile(file, { relativePath: '.', rootPath: projectPath }, projectPath)))
  return { matched: results.every(result => result.matched), evidence: results.flatMap(result => result.evidence) }
}

async function evaluateCondition(condition: SkillActivationCondition, scope: ScopeCandidate, projectPath: string): Promise<ConditionResult> {
  if ('file' in condition)
    return evaluateFile(condition.file, scope, projectPath)
  if ('dependency' in condition)
    return evaluateDependency(condition.dependency, scope, projectPath)
  if ('packageManager' in condition)
    return evaluatePackageManager(condition.packageManager, scope, projectPath)
  if ('not' in condition) {
    const result = await evaluateCondition(condition.not, scope, projectPath)
    return { matched: !result.matched, evidence: result.evidence }
  }
  const children = 'all' in condition ? condition.all : condition.any
  const results = await Promise.all(children.map(child => evaluateCondition(child, scope, projectPath)))
  return {
    matched: 'all' in condition ? results.every(result => result.matched) : results.some(result => result.matched),
    evidence: results.flatMap(result => result.evidence),
  }
}

async function evaluateFile(pattern: string, scope: ScopeCandidate, projectPath: string): Promise<ConditionResult> {
  const matches = await glob(pattern, {
    cwd: scope.rootPath,
    dot: true,
    expandDirectories: false,
    followSymbolicLinks: false,
    ignore: ignoredPatterns,
    onlyFiles: true,
  })
  let matchedPath: string | undefined
  for (const match of matches.sort()) {
    try {
      const canonical = await realpath(join(scope.rootPath, match))
      if (inside(await realpath(scope.rootPath), canonical) && (await stat(canonical)).isFile()) {
        matchedPath = portable(relative(await realpath(projectPath), canonical))
        break
      }
    }
    catch {}
  }
  return {
    matched: Boolean(matchedPath),
    evidence: [{ kind: 'file', expected: pattern, matched: Boolean(matchedPath), path: matchedPath }],
  }
}

async function evaluateDependency(name: string, scope: ScopeCandidate, projectPath: string): Promise<ConditionResult> {
  const manifestPath = join(scope.rootPath, 'package.json')
  let matched = false
  try {
    const content = await readBoundedRegularFile(manifestPath, scope.rootPath)
    const document = JSON.parse(content) as Record<string, unknown>
    matched = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
      .some(section => hasOwnString(document[section], name))
  }
  catch {}
  return {
    matched,
    evidence: [{ kind: 'dependency', expected: name, matched, path: portable(relative(projectPath, manifestPath)) }],
  }
}

async function evaluatePackageManager(manager: 'bun' | 'npm' | 'pnpm' | 'yarn', scope: ScopeCandidate, projectPath: string): Promise<ConditionResult> {
  const roots = [...new Set([scope.rootPath, projectPath])]
  let declaredPath: string | undefined
  for (const rootPath of roots) {
    const manifestPath = join(rootPath, 'package.json')
    try {
      const document = JSON.parse(await readBoundedRegularFile(manifestPath, rootPath)) as { packageManager?: unknown }
      if (typeof document.packageManager === 'string' && document.packageManager.split('@')[0] === manager) {
        declaredPath = portable(relative(projectPath, manifestPath))
        break
      }
    }
    catch {}
  }
  const fileResults = await Promise.all(packageManagerFiles[manager].map(file => evaluateFile(file, { relativePath: '.', rootPath: projectPath }, projectPath)))
  const matchedFile = fileResults.flatMap(result => result.evidence).find(evidence => evidence.matched)?.path
  const matched = Boolean(declaredPath || matchedFile)
  return { matched, evidence: [{ kind: 'package-manager', expected: manager, matched, path: declaredPath ?? matchedFile }] }
}

function explicitScopes(
  references: string[],
  pluginId: string,
  scopes: ScopeCandidate[],
  project: SkillActivationSettings,
  local: LocalSkillActivationSettings,
): {
  localEnabled: SkillActivationScope[]
  localDisabled: SkillActivationRuleLike[]
  projectEnabled: SkillActivationScope[]
  projectDisabled: SkillActivationRuleLike[]
  localPluginEnabled: boolean
  localPluginDisabled: boolean
  projectPluginEnabled: boolean
  projectPluginDisabled: boolean
} {
  const localEnabledRules = matchingRules(local.enabled, references)
  const localDisabled = matchingRules(local.disabled, references)
  const projectEnabledRules = matchingRules(project.enabled, references)
  const projectDisabled = matchingRules(project.disabled, references)
  const localPluginEnabled = (local.enabledPlugins ?? []).includes(pluginId)
  const localPluginDisabled = (local.disabledPlugins ?? []).includes(pluginId)
  const projectPluginEnabled = (project.enabledPlugins ?? []).includes(pluginId)
  const projectPluginDisabled = (project.disabledPlugins ?? []).includes(pluginId)
  return {
    localEnabled: scopesFromRules([...localPluginEnabled ? [{ id: pluginId }] : [], ...localEnabledRules], scopes),
    localDisabled,
    projectEnabled: scopesFromRules([...projectPluginEnabled ? [{ id: pluginId }] : [], ...projectEnabledRules], scopes),
    projectDisabled,
    localPluginEnabled,
    localPluginDisabled,
    projectPluginEnabled,
    projectPluginDisabled,
  }
}

interface SkillActivationRuleLike { id: string, scopes?: string[] }

function matchingRules(rules: SkillActivationRuleLike[] | undefined, references: string[]): SkillActivationRuleLike[] {
  return (rules ?? []).filter(rule => references.includes(rule.id))
}

function scopesFromRules(rules: SkillActivationRuleLike[], candidates: ScopeCandidate[]): SkillActivationScope[] {
  const byPath = new Map(candidates.map(scope => [scope.relativePath, scope]))
  const requested = new Set(rules.flatMap(rule => rule.scopes ?? ['.']))
  return [...requested].flatMap((relativePath) => {
    const candidate = byPath.get(relativePath)
    return candidate ? [{ relativePath, packageName: candidate.packageName, evidence: [] }] : []
  })
}

function matchesRules(rules: SkillActivationRuleLike[], relativePath: string): boolean {
  return rules.some(rule => !rule.scopes || rule.scopes.includes(relativePath))
}

function mergeScopes(left: SkillActivationScope[], right: SkillActivationScope[]): SkillActivationScope[] {
  const scopes = new Map(left.map(scope => [scope.relativePath, scope]))
  for (const scope of right)
    scopes.set(scope.relativePath, scope)
  return [...scopes.values()].sort((a, b) => a.relativePath === '.' ? -1 : b.relativePath === '.' ? 1 : a.relativePath.localeCompare(b.relativePath))
}

function watchedPatterns(condition: SkillActivationCondition, relativePath: string): string[] {
  const prefix = relativePath === '.' ? '' : `${relativePath}/`
  if ('file' in condition)
    return [`${prefix}${condition.file}`]
  if ('dependency' in condition)
    return [`${prefix}package.json`]
  if ('packageManager' in condition)
    return ['package.json', ...packageManagerFiles[condition.packageManager]]
  if ('not' in condition)
    return watchedPatterns(condition.not, relativePath)
  return ('all' in condition ? condition.all : condition.any).flatMap(child => watchedPatterns(child, relativePath))
}

function safePath(root: string, relativePath: string): string {
  const path = resolve(root, relativePath)
  if (!inside(root, path))
    throw new Error(`Path escapes its root: ${relativePath}`)
  return path
}

function inside(root: string, target: string): boolean {
  const candidate = relative(root, target)
  return candidate === '' || (!candidate.startsWith('..') && !isAbsolute(candidate))
}

async function readBoundedRegularFile(path: string, root: string): Promise<string> {
  const [canonicalRoot, canonicalPath] = await Promise.all([realpath(root), realpath(path)])
  if (!inside(canonicalRoot, canonicalPath))
    throw new Error(`File escapes its root: ${path}`)
  const metadata = await stat(canonicalPath)
  if (!metadata.isFile() || metadata.size > 1024 * 1024)
    throw new Error(`File must be a regular file no larger than 1 MiB: ${path}`)
  return readFile(canonicalPath, 'utf8')
}

function skillMetadata(content: string, path: string): { name: string, description?: string } {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() === '---') {
    const boundary = lines.indexOf('---', 1)
    const metadata = Object.fromEntries(lines.slice(1, boundary < 0 ? 1 : boundary).flatMap((line) => {
      const separator = line.indexOf(':')
      return separator < 0 ? [] : [[line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')]]
    }))
    if (metadata.name)
      return { name: metadata.name, description: metadata.description || undefined }
  }
  return { name: path.split(/[\\/]/).at(-2) || path }
}

function hasOwnString(value: unknown, key: string): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>)[key] === 'string')
}

function skillCapabilityId(pluginId: string, skillId: string): string {
  return `plugin:${pluginId}:skill:${skillId}`
}

function pluginIdFromReference(reference: string): string[] {
  const capabilityMatch = /^plugin:(@[^:]+):skill:/.exec(reference)
  if (capabilityMatch)
    return [capabilityMatch[1]!]
  const separator = reference.lastIndexOf(':')
  return separator > 0 ? [reference.slice(0, separator)] : []
}

function portable(path: string): string {
  return path.split(sep).join('/') || '.'
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

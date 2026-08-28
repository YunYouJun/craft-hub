import type { ParseError } from 'jsonc-parser'
import type { ProjectConfig } from './project-config-schema'
import type { ProjectAccentColor, ProjectConfigPath, ProjectDescriptionApplication, ProjectDescriptionChange } from './types'
import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { applyEdits, findNodeAtLocation, modify, parse as parseJsonc, parseTree, printParseErrorCode } from 'jsonc-parser'
import { projectConfigSchema, projectConfigSchemaUrl } from './project-config-schema'

export type { LocalizedText, ProjectCommandInputConfig, ProjectCommandInputOptionConfig, ProjectConfig, ProjectSkillInputConfig } from './project-config-schema'
export { projectConfigJsonSchema, projectConfigSchema, projectConfigSchemaUrl } from './project-config-schema'
export { projectConfigSchemaRevision } from './project-config-schema-revision'

/** Repository-relative path of the optional Craft Hub project configuration. */
export const projectConfigTargetPath = '.craft-hub/project.jsonc' as const

interface ProjectConfigSource {
  path: string
  content: string
}

/** Preview or result of initializing repository-owned project metadata. */
export interface ProjectConfigInitialization {
  targetPath: ProjectConfigPath
  path: string
  content: string
  revision: string
  exists: boolean
  created?: boolean
}

/** Load optional project-owned metadata without requiring configuration. */
export async function loadProjectConfig(projectPath: string): Promise<ProjectConfig | undefined> {
  const source = await readProjectConfigSource(projectPath)
  if (!source)
    return undefined
  return parseProjectConfig(source.content)
}

/** Preview the exact file content used to initialize optional project metadata. */
export async function previewProjectConfigInitialization(projectPath: string, projectName: string): Promise<ProjectConfigInitialization> {
  const current = await readProjectConfigSource(projectPath)
  if (current) {
    parseProjectConfig(current.content)
    return {
      targetPath: projectConfigTargetPath,
      path: current.path,
      content: current.content,
      revision: configRevision(current.content),
      exists: true,
    }
  }
  const path = resolve(projectPath, projectConfigTargetPath)
  const content = `${JSON.stringify({
    $schema: projectConfigSchemaUrl,
    version: 1,
    project: { name: projectName },
    capabilities: { hidden: [], descriptions: {} },
  }, null, 2)}\n`
  return {
    targetPath: projectConfigTargetPath,
    path,
    content,
    revision: configRevision(''),
    exists: false,
  }
}

/** Create the previewed project configuration if its target revision is unchanged. */
export async function applyProjectConfigInitialization(projectPath: string, projectName: string, expectedRevision: string): Promise<ProjectConfigInitialization> {
  const preview = await previewProjectConfigInitialization(projectPath, projectName)
  if (preview.revision !== expectedRevision)
    throw new Error('Project config changed after preview. Preview it again before applying.')
  if (preview.exists)
    return { ...preview, created: false }

  const temporary = `${preview.path}.${randomUUID()}.tmp`
  await mkdir(dirname(preview.path), { recursive: true })
  await assertInsideProject(projectPath, dirname(preview.path), 'Project config directory')
  await writeFile(temporary, preview.content, 'utf8')
  try {
    await link(temporary, preview.path)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('Project config changed after preview. Preview it again before applying.')
    throw error
  }
  finally {
    await rm(temporary, { force: true })
  }
  return { ...preview, exists: true, created: true, revision: configRevision(preview.content) }
}

/** Persist user-selected project visuals in the portable project configuration. */
export async function saveProjectVisual(projectPath: string, visual: { icon?: string, color?: ProjectAccentColor }): Promise<ProjectConfig> {
  const source = await readProjectConfigSource(projectPath)
  const path = source?.path ?? resolve(projectPath, projectConfigTargetPath)
  const current = source ? parseProjectConfig(source.content) : { $schema: projectConfigSchemaUrl, version: 1 as const }
  const project = { ...current.project, icon: visual.icon || undefined, color: visual.color }
  let content = source?.content ?? `${JSON.stringify(current, null, 2)}\n`
  content = setJsoncValue(content, ['$schema'], current.$schema ?? projectConfigSchemaUrl)
  content = setJsoncValue(content, ['version'], 1)
  content = setJsoncValue(content, ['project', 'icon'], project.icon)
  content = setJsoncValue(content, ['project', 'color'], project.color)
  if (!content.endsWith('\n'))
    content += '\n'
  const next = parseProjectConfig(content)
  const temporary = `${path}.${randomUUID()}.tmp`
  await mkdir(dirname(path), { recursive: true })
  await assertInsideProject(projectPath, dirname(path), 'Project config directory')
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, path)
  return next
}

async function readProjectConfigSource(projectPath: string): Promise<ProjectConfigSource | undefined> {
  const path = resolve(projectPath, projectConfigTargetPath)
  try {
    await assertInsideProject(projectPath, path, 'Project config')
    return { path, content: await readFile(path, 'utf8') }
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return undefined
    throw error
  }
}

function configRevision(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/** Return the revision used to guard incremental project configuration edits. */
export async function projectConfigRevision(projectPath: string): Promise<string> {
  return configRevision((await readProjectConfigSource(projectPath))?.content ?? '')
}

function setJsoncValue(content: string, path: (string | number)[], value: unknown): string {
  return applyEdits(content, modify(content, path, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
  }))
}

/** Atomically merge reviewed descriptions while preserving comments and extension fields. */
export async function applyProjectDescriptionChanges(
  projectPath: string,
  changes: ProjectDescriptionChange[],
  expectedRevision: string,
): Promise<ProjectDescriptionApplication> {
  const source = await readProjectConfigSource(projectPath)
  const path = source?.path ?? resolve(projectPath, projectConfigTargetPath)
  const current = source?.content ?? ''
  const previousRevision = configRevision(current)
  if (previousRevision !== expectedRevision)
    throw new Error('Project config changed after descriptions were reviewed. Analyze it again before applying.')

  let content = current || `${JSON.stringify({ $schema: projectConfigSchemaUrl, version: 1 }, null, 2)}\n`
  let config = parseProjectConfig(content)
  content = setJsoncValue(content, ['$schema'], config.$schema ?? projectConfigSchemaUrl)
  content = setJsoncValue(content, ['version'], 1)
  for (const change of changes) {
    const pathParts = change.target === 'command'
      ? ['capabilities', 'descriptions', change.key]
      : ['packages', change.key, 'description']
    const existing = change.target === 'command'
      ? config.capabilities?.descriptions?.[change.key]
      : config.packages?.[change.key]?.description
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      for (const [locale, description] of Object.entries(change.description)) {
        if (existing[locale] === undefined)
          content = setJsoncValue(content, [...pathParts, locale], description)
      }
    }
    else {
      content = setJsoncValue(content, pathParts, {
        ...change.description,
        ...(typeof existing === 'string' ? { default: existing } : {}),
      })
    }
    config = parseProjectConfig(content)
  }
  if (!content.endsWith('\n'))
    content += '\n'
  const temporary = `${path}.${randomUUID()}.tmp`
  await mkdir(dirname(path), { recursive: true })
  await assertInsideProject(projectPath, dirname(path), 'Project config directory')
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, path)
  return {
    appliedCount: changes.length,
    previousRevision,
    revision: configRevision(content),
    targetPath: projectConfigTargetPath,
  }
}

/** One actionable project-configuration problem. */
export interface ProjectConfigDiagnostic {
  path: string
  line: number
  column: number
  message: string
}

/** Aggregated syntax or schema failures found in project.jsonc. */
export class ProjectConfigValidationError extends Error {
  constructor(readonly diagnostics: ProjectConfigDiagnostic[]) {
    super(`Invalid Craft Hub project config:\n${diagnostics
      .map(diagnostic => `${projectConfigTargetPath}:${diagnostic.line}:${diagnostic.column} ${diagnostic.path} ${diagnostic.message}`)
      .join('\n')}`)
    this.name = 'ProjectConfigValidationError'
  }
}

function offsetPosition(content: string, offset: number): { line: number, column: number } {
  const before = content.slice(0, offset)
  const lines = before.split('\n')
  return { line: lines.length, column: lines.at(-1)!.length + 1 }
}

function jsonPointer(path: PropertyKey[]): string {
  if (!path.length)
    return '/'
  return `/${path.map(part => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`
}

function parseProjectConfig(content: string): ProjectConfig {
  const errors: ParseError[] = []
  const parsed = parseJsonc(content, errors, { allowTrailingComma: true }) as unknown
  if (errors.length) {
    throw new ProjectConfigValidationError(errors.map(error => ({
      path: '/',
      ...offsetPosition(content, error.offset),
      message: printParseErrorCode(error.error),
    })))
  }
  const result = projectConfigSchema.safeParse(parsed)
  if (result.success)
    return result.data

  const tree = parseTree(content, [], { allowTrailingComma: true })
  throw new ProjectConfigValidationError(result.error.issues.flatMap((issue) => {
    const issuePath = issue.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
    const paths = issue.code === 'unrecognized_keys'
      ? issue.keys.map(key => [...issuePath, key])
      : [issuePath]
    return paths.map((path) => {
      const node = tree ? findNodeAtLocation(tree, path) : undefined
      return {
        path: jsonPointer(path),
        ...offsetPosition(content, node?.offset ?? 0),
        message: issue.code === 'unrecognized_keys' ? `Unrecognized key: "${String(path.at(-1))}"` : issue.message,
      }
    })
  }))
}

async function assertInsideProject(projectPath: string, targetPath: string, label: string): Promise<void> {
  const root = await realpath(projectPath)
  const target = await realpath(targetPath)
  const relativePath = relative(root, target)
  if (relativePath.startsWith('..') || isAbsolute(relativePath))
    throw new Error(`${label} must stay inside the project directory`)
}

import type { ZodError } from 'zod'
import { Buffer } from 'node:buffer'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { parseProjectConfig, ProjectConfigValidationError } from './config'
import { parseSoftwareConfig } from './software-config'
import { readWorkspaceSource } from './workspace-source'

/** A bounded field diagnostic; source values and configuration contents are omitted. */
export interface RepositoryValidationIssue {
  code: string
  path: string
  message: string
  line?: number
  column?: number
}

/** A pure content validator's result, independent of repository bindings or trust. */
export interface RepositoryContentValidation {
  status: 'valid' | 'invalid' | 'unsupported'
  issues: RepositoryValidationIssue[]
}

/** A validator explicitly supplied by a trusted host; it receives content, never a path. */
export interface RepositoryValidationProvider {
  id: string
  format: string
  files: readonly string[]
  validate: (content: string) => Promise<RepositoryContentValidation>
}

/** One repository-relative declaration checked by its existing format parser. */
export interface RepositoryValidationFile extends RepositoryContentValidation {
  file: string
  format: string
  validator: string
}

/** Versioned read-only report suitable for agent output and CI exit-code decisions. */
export interface RepositoryValidationReport {
  version: 1
  valid: boolean
  files: RepositoryValidationFile[]
  issues: RepositoryValidationIssue[]
  summary: { checked: number, errors: number, unsupported: number }
}

function text(limit: number): z.ZodString {
  return z.string().min(1).max(limit).refine(value => !/\p{Cc}/u.test(value))
}
const issueSchema = z.object({
  code: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,79}$/),
  path: text(512),
  message: text(1024),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
})
const contentResultSchema = z.object({ status: z.enum(['valid', 'invalid', 'unsupported']), issues: z.array(issueSchema).max(100) })
  .refine(result => (result.status === 'valid') === (result.issues.length === 0))
const maxFiles = 200
const maxBytes = 256 * 1024
const projectFile = '.craft-hub/project.jsonc'
const softwareFile = 'software.config.ts'
const projectManifestFiles = ['projects.yaml', 'projects.yml', 'projects.example.yaml']
const sourceDirectories = ['.craft-hub', 'craft-hub']
const reservedSourceFiles = new Set(['project', 'projects', 'catalog', 'dotfiles', 'config', 'user-config', 'owner-scopes', 'settings'].flatMap(name => [`${name}.json`, `${name}.jsonc`]))

function issue(code: string, message: string, path = '/'): RepositoryValidationIssue {
  return { code, path, message }
}

function fieldPath(value: string): string {
  return value.length <= 512 && /^[\w/.[\]~$-]+$/.test(value) ? value : '/'
}

function pointer(path: PropertyKey[]): string {
  return fieldPath(`/${path.map(part => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`)
}

function zodIssues(error: ZodError): RepositoryValidationIssue[] {
  return error.issues.slice(0, 100).map(item => ({
    code: 'invalid-field',
    path: pointer(item.path),
    message: item.code === 'unrecognized_keys' ? 'Unrecognized configuration field.' : item.message.slice(0, 1024).replace(/\p{Cc}/gu, ' '),
  }))
}

function invalid(error: unknown, format: 'project' | 'workspace-source' | 'software'): RepositoryContentValidation {
  if (error instanceof ProjectConfigValidationError) {
    return { status: 'invalid', issues: error.diagnostics.slice(0, 100).map(diagnostic => ({
      code: 'invalid-field',
      path: fieldPath(diagnostic.path),
      message: diagnostic.message.startsWith('Unrecognized key:') ? 'Unrecognized configuration field.' : diagnostic.message.slice(0, 1024).replace(/\p{Cc}/gu, ' '),
      line: diagnostic.line,
      column: diagnostic.column,
    })) }
  }
  if (error instanceof z.ZodError)
    return { status: 'invalid', issues: zodIssues(error) }
  const messages: Record<string, string> = {
    'Invalid configuration JSONC': 'Invalid JSONC syntax.',
    'Publish only one source manifest': 'Publish either source.jsonc or source.json in this directory.',
    'Expected export const softwareGroups with a literal array': 'Export one constant named softwareGroups containing a literal array.',
    'Software config does not support spreads': 'Software groups must use literal data without spreads.',
    'Software config only supports literal object properties': 'Software groups must use literal object properties.',
    'Software config contains an unsafe or duplicate key': 'Software groups contain an unsafe or duplicate field.',
    'Software config only supports literal data, without references, calls or spreads': 'Software groups must use literal data without references, calls or spreads.',
    'Software config must contain bounded literal data': 'Software groups exceed the supported nesting limit or contain missing values.',
  }
  const message = error instanceof Error ? messages[error.message] : undefined
  return { status: 'invalid', issues: [issue('invalid-format', message ?? `Invalid ${format} declaration. Check its syntax and format.`)] }
}

/** Validate and strip a trusted provider's external response, rejecting inconsistent success. */
export function parseRepositoryContentValidation(value: unknown): RepositoryContentValidation {
  return contentResultSchema.parse(value)
}

/** Validate a trusted provider declaration without invoking it or loading repository code. */
export function assertRepositoryValidationProviders(providers: unknown): asserts providers is RepositoryValidationProvider[] {
  if (!Array.isArray(providers) || providers.length > 20)
    throw new TypeError('Repository validation providers must be an array with at most 20 providers')
  const ids = new Set<string>()
  const files = new Set<string>()
  for (const provider of providers) {
    if (!provider || typeof provider.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(provider.id)
      || typeof provider.format !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(provider.format)
      || typeof provider.validate !== 'function' || !Array.isArray(provider.files) || !provider.files.length || provider.files.length > 20) {
      throw new TypeError('Invalid repository validation provider')
    }
    if (ids.has(provider.id))
      throw new TypeError('Duplicate repository validation provider id')
    ids.add(provider.id)
    for (const file of provider.files) {
      if (typeof file !== 'string' || !/^[\w.-]+\.(?:ya?ml|jsonc?|ts)$/.test(file) || file.length > 128 || files.has(file) || file === softwareFile)
        throw new TypeError('Invalid or duplicate repository validation file')
      files.add(file)
    }
  }
}

class ReadFailure extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

/** Read only bounded regular files inside the selected root; symlinks are not followed. */
async function readDeclaration(root: string, file: string): Promise<string | undefined> {
  let path = root
  const parts = file.split('/')
  for (let index = 0; index < parts.length; index++) {
    path = resolve(path, parts[index]!)
    const entry = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT')
        return undefined
      throw new ReadFailure('unreadable-file', 'Configuration could not be read. Check local filesystem permissions.')
    })
    if (!entry)
      return undefined
    if (entry.isSymbolicLink() || (index < parts.length - 1 ? !entry.isDirectory() : !entry.isFile()))
      throw new ReadFailure('non-regular-file', 'Configuration must be a regular file under regular directories inside the repository.')
    if (index === parts.length - 1 && entry.size > maxBytes)
      throw new ReadFailure('file-too-large', 'Configuration exceeds the 256 KiB validation limit.')
  }
  const resolved = await realpath(path)
  const relativePath = relative(root, resolved)
  if (relativePath.startsWith('..') || isAbsolute(relativePath))
    throw new ReadFailure('outside-repository', 'Configuration must stay inside the repository.')
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => {
    throw new ReadFailure('unreadable-file', 'Configuration could not be read. Check local filesystem permissions.')
  })
  try {
    const entry = await handle.stat()
    if (!entry.isFile() || entry.size > maxBytes)
      throw new ReadFailure('file-too-large', 'Configuration must be a regular file no larger than 256 KiB.')
    const bytes = Buffer.alloc(maxBytes + 1)
    let count = 0
    while (count < bytes.length) {
      const { bytesRead } = await handle.read(bytes, count, bytes.length - count, count)
      if (!bytesRead)
        break
      count += bytesRead
    }
    if (count > maxBytes)
      throw new ReadFailure('file-too-large', 'Configuration exceeds the 256 KiB validation limit.')
    return bytes.subarray(0, count).toString('utf8')
  }
  finally { await handle.close() }
}

async function workspaceFiles(root: string, directory: string): Promise<string[]> {
  const files: string[] = []
  for (const suffix of ['', '/workspaces']) {
    const path = resolve(root, directory + suffix)
    const entry = await lstat(path).catch(() => undefined)
    if (!entry)
      continue
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new ReadFailure('non-regular-directory', 'Workspace configuration directories must be regular directories.')
    const entries = await readdir(path)
    for (const file of entries.sort()) {
      if (!/^[\w-]+\.jsonc?$/.test(file) || (suffix === '' && (reservedSourceFiles.has(file) || /^source\.jsonc?$/.test(file))))
        continue
      files.push(`${directory}${suffix}/${file}`)
      if (files.length > maxFiles)
        throw new ReadFailure('too-many-files', 'Workspace source exceeds the 200 file validation limit.')
    }
  }
  return files
}

async function withTimeout(provider: RepositoryValidationProvider, content: string): Promise<RepositoryContentValidation> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return parseRepositoryContentValidation(await Promise.race([
      provider.validate(content),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Validator timed out')), 15000) }),
    ]))
  }
  finally { clearTimeout(timer) }
}

/**
 * Validate repository declarations using existing parsers and explicitly supplied host validators.
 * No registration, trust, Git operation, configuration import, or repository module execution occurs.
 */
export async function validateRepository(directory: string, providers: RepositoryValidationProvider[] = []): Promise<RepositoryValidationReport> {
  const files: RepositoryValidationFile[] = []
  const issues: RepositoryValidationIssue[] = []
  const report = (): RepositoryValidationReport => {
    const errors = issues.length + files.filter(file => file.status === 'invalid').reduce((sum, file) => sum + file.issues.length, 0)
    const unsupported = files.filter(file => file.status === 'unsupported').length
    return { version: 1, valid: files.length > 0 && errors === 0 && unsupported === 0, files, issues, summary: { checked: files.length, errors, unsupported } }
  }
  let root: string
  try {
    assertRepositoryValidationProviders(providers)
    root = await realpath(directory)
    if (!(await lstat(root)).isDirectory())
      throw new Error('Not a directory')
  }
  catch {
    issues.push(issue('invalid-input', 'Select an existing repository directory and valid trusted validators.'))
    return report()
  }
  async function read(file: string, format: string, validator: string): Promise<string | undefined> {
    try {
      const content = await readDeclaration(root, file)
      return content
    }
    catch (error) {
      files.push({ file, format, validator, status: 'invalid', issues: [issue(error instanceof ReadFailure ? error.code : 'unreadable-file', error instanceof ReadFailure ? error.message : 'Configuration could not be read. Check local filesystem permissions.')] })
      return undefined
    }
  }
  const projectContent = await read(projectFile, 'project', 'craft-hub')
  if (projectContent !== undefined) {
    try {
      parseProjectConfig(projectContent)
      files.push({ file: projectFile, format: 'project', validator: 'craft-hub', status: 'valid', issues: [] })
    }
    catch (error) { files.push({ file: projectFile, format: 'project', validator: 'craft-hub', ...invalid(error, 'project') }) }
  }
  for (const directory of sourceDirectories) {
    const bundles = [`${directory}/source.jsonc`, `${directory}/source.json`]
    const source: Record<string, string> = {}
    for (const file of bundles) {
      const content = await read(file, 'workspace-source', 'craft-hub')
      if (content !== undefined)
        source[file.slice(directory.length + 1)] = content
    }
    if (!Object.keys(source).length) {
      try {
        for (const file of await workspaceFiles(root, directory)) {
          const content = await read(file, 'workspace-source', 'craft-hub')
          if (content !== undefined)
            source[file.slice(directory.length + 1)] = content
        }
      }
      catch (error) {
        files.push({ file: directory, format: 'workspace-source', validator: 'craft-hub', status: 'invalid', issues: [issue(error instanceof ReadFailure ? error.code : 'unreadable-directory', error instanceof ReadFailure ? error.message : 'Workspace configuration directory could not be read.')] })
      }
    }
    const names = Object.keys(source)
    if (!names.length)
      continue
    if (!names.some(name => /^source\.jsonc?$/.test(name))) {
      const declarations = names.map((name) => {
        try {
          const workspace = readWorkspaceSource({ [name]: source[name]! }).workspaces[0]!
          return { name, workspaceId: workspace.id, result: { status: 'valid', issues: [] } as RepositoryContentValidation }
        }
        catch (error) {
          const result = invalid(error, 'workspace-source')
          // A directory document is wrapped in a synthetic source for the existing parser.
          result.issues = result.issues.map(item => ({ ...item, path: item.path.replace(/^\/workspaces\/0(?=\/|$)/, '') || '/' }))
          return { name, workspaceId: undefined, result }
        }
      })
      if (declarations.every(declaration => declaration.result.status === 'valid')) {
        try {
          readWorkspaceSource(source)
        }
        catch (error) {
          const result = invalid(error, 'workspace-source')
          const duplicateIds = new Set(declarations.filter((declaration, index, all) => all.some((other, otherIndex) => otherIndex !== index && other.workspaceId === declaration.workspaceId)).map(declaration => declaration.workspaceId))
          const duplicateWorkspaceIds = error instanceof z.ZodError && error.issues.every(item => item.path.length === 0 && item.message === 'Duplicate workspace ids')
          for (const declaration of declarations) {
            if (!duplicateWorkspaceIds || duplicateIds.has(declaration.workspaceId))
              declaration.result = result
          }
        }
      }
      for (const declaration of declarations)
        files.push({ file: `${directory}/${declaration.name}`, format: 'workspace-source', validator: 'craft-hub', ...declaration.result })
      continue
    }
    try {
      readWorkspaceSource(source)
      for (const name of names)
        files.push({ file: `${directory}/${name}`, format: 'workspace-source', validator: 'craft-hub', status: 'valid', issues: [] })
    }
    catch (error) {
      for (const name of names)
        files.push({ file: `${directory}/${name}`, format: 'workspace-source', validator: 'craft-hub', ...invalid(error, 'workspace-source') })
    }
  }
  const softwareContent = await read(softwareFile, 'software', 'craft-hub')
  if (softwareContent !== undefined) {
    try {
      parseSoftwareConfig(softwareContent, { id: 'repository-validation', title: 'Repository validation' })
      files.push({ file: softwareFile, format: 'software', validator: 'craft-hub', status: 'valid', issues: [] })
    }
    catch (error) { files.push({ file: softwareFile, format: 'software', validator: 'craft-hub', ...invalid(error, 'software') }) }
  }
  const providerFiles = new Map(providers.flatMap(provider => provider.files.map(file => [file, provider] as const)))
  for (const file of new Set([...projectManifestFiles, ...providerFiles.keys()])) {
    const provider = providerFiles.get(file)
    const content = await read(file, provider?.format ?? 'projects', provider?.id ?? 'unavailable')
    if (content === undefined)
      continue
    if (!provider) {
      files.push({ file, format: 'projects', validator: 'unavailable', status: 'unsupported', issues: [issue('validator-unavailable', 'Load a trusted Workstation Host Plugin and a CLI supporting repository validation to check this project manifest.')] })
      continue
    }
    try {
      files.push({ file, format: provider.format, validator: provider.id, ...await withTimeout(provider, content) })
    }
    catch { files.push({ file, format: provider.format, validator: provider.id, status: 'invalid', issues: [issue('validator-failed', 'The trusted content validator could not complete. Check its protocol and local CLI version.')] }) }
  }
  if (!files.length)
    issues.push(issue('no-configurations', 'No supported repository declarations were found. Select a repository containing project, workspace source, software, or project manifest configuration.'))
  return report()
}

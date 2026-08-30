import type { ProjectRecord, ProjectReference } from './types'
import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Normalize an HTTPS or SSH Git remote into a credential-free HTTPS identity. */
export function normalizeRepositoryUrl(input: string): string {
  const value = input.trim()
  const scp = value.includes('://') ? null : /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(value)
  const url = scp
    ? new URL(`https://${scp[1]}/${scp[2]}`)
    : new URL(value)
  if (url.protocol !== 'https:' && url.protocol !== 'ssh:')
    throw new Error('Project repository must use HTTPS or SSH')
  if (!url.hostname || url.search || url.hash)
    throw new Error('Project repository URL is invalid')

  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      const decoded = decodeURIComponent(segment)
      if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\'))
        throw new Error('Project repository path is invalid')
      return decoded
    })
  if (!segments.length)
    throw new Error('Project repository path is required')
  segments[segments.length - 1] = segments.at(-1)!.replace(/\.git$/i, '')
  if (!segments.at(-1))
    throw new Error('Project repository path is required')

  const port = url.port ? `:${url.port}` : ''
  return `https://${url.hostname.toLowerCase()}${port}/${segments.map(segment => encodeURIComponent(segment)).join('/')}`
}

/** Validate and normalize an optional repository-relative Project subdirectory. */
export function normalizeProjectSubdir(input: string | undefined): string | undefined {
  if (input === undefined || input === '')
    return undefined
  if (isAbsolute(input) || input.includes('\\') || input.includes('\0'))
    throw new Error('Project subdirectory must be repository-relative')
  const segments = input.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..'))
    throw new Error('Project subdirectory must be repository-relative')
  return segments.join('/')
}

/** Normalize an external Project Reference without consulting the local filesystem. */
export function normalizeProjectReference(reference: ProjectReference): ProjectReference {
  const subdir = normalizeProjectSubdir(reference.subdir)
  return {
    repository: normalizeRepositoryUrl(reference.repository),
    ...(subdir ? { subdir } : {}),
  }
}

/** Derive one Project Reference from local Git facts without changing the checkout. */
export async function identifyProjectReference(inputPath: string): Promise<ProjectReference> {
  const path = await realpath(resolve(inputPath))
  const { stdout: rootOutput } = await execFileAsync('git', ['-C', path, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  const root = await realpath(rootOutput.trim())
  const location = relative(root, path)
  if (location.startsWith('..') || isAbsolute(location))
    throw new Error('Project path is outside its Git repository')
  const { stdout: remoteOutput } = await execFileAsync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8' })
  const subdir = normalizeProjectSubdir(location ? location.split(sep).join('/') : undefined)
  return {
    repository: normalizeRepositoryUrl(remoteOutput),
    ...(subdir ? { subdir } : {}),
  }
}

/** Resolve all registered Projects that exactly match one Project Reference. */
export async function resolveProjectReference(projects: ProjectRecord[], reference: ProjectReference): Promise<ProjectRecord[]> {
  const target = normalizeProjectReference(reference)
  const matches = await Promise.all(projects.map(async (project) => {
    try {
      const current = await identifyProjectReference(project.path)
      return current.repository === target.repository && current.subdir === target.subdir ? project : undefined
    }
    catch {
      return undefined
    }
  }))
  return matches.filter((project): project is ProjectRecord => Boolean(project))
}

/** Verify that a selected local directory exactly represents one Project Reference. */
export async function verifyProjectReference(path: string, reference: ProjectReference): Promise<ProjectReference> {
  const expected = normalizeProjectReference(reference)
  const actual = await identifyProjectReference(path)
  if (actual.repository !== expected.repository || actual.subdir !== expected.subdir)
    throw new Error('Selected directory does not match the requested Project Reference')
  return actual
}

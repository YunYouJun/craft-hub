import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { normalizeRepositoryUrl } from './project-reference'

/** Safe, user-visible subscription failure without transport diagnostics or credentials. */
export class WorkspaceSubscriptionError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

/** Repository metadata read at one immutable commit, with paths relative to its configuration root. */
export interface WorkspaceRepositorySnapshot {
  repository: string
  branch: string
  directory: string
  revision: string
  files: Record<string, string>
}

/** Trusted host adapter; credentials stay inside the adapter and access is checked on every read. */
export interface WorkspaceRepositoryProvider {
  id: string
  name: string
  accepts: (url: string) => boolean
  read: (url: string, context: { readGit: typeof readWorkspaceGitRepository }) => Promise<WorkspaceRepositorySnapshot>
}

/** Parse an HTTPS browser directory URL using an explicit configuration-root delimiter. */
export function parseWorkspaceRepositoryUrl(value: string): { repository: string, branch: string, directory: string } {
  let url: URL
  try {
    url = new URL(value)
  }
  catch { throw new WorkspaceSubscriptionError(400, 'Enter an HTTPS repository directory URL') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new WorkspaceSubscriptionError(400, 'Repository URLs must use HTTPS without credentials, queries or fragments')
  let parts: string[]
  try {
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  }
  catch { throw new WorkspaceSubscriptionError(400, 'Invalid repository URL encoding') }
  if (parts.some(part => !/^[\w.-]+$/.test(part) || part === '.' || part === '..' || part === '.git'))
    throw new WorkspaceSubscriptionError(400, 'Invalid repository directory URL')
  const tree = parts.indexOf('tree')
  const root = parts.findIndex((part, index) => index > tree + 1 && ['.craft-hub', 'craft-hub'].includes(part))
  if (tree < 2 || root < 0)
    throw new WorkspaceSubscriptionError(400, 'Select a branch directory under craft-hub or .craft-hub')
  const repositoryParts = parts.slice(0, parts[tree - 1] === '-' ? tree - 1 : tree)
  if (repositoryParts.length < 2)
    throw new WorkspaceSubscriptionError(400, 'A repository owner and name are required')
  return { repository: `${url.origin}/${repositoryParts.map(encodeURIComponent).join('/')}`, branch: parts.slice(tree + 1, root).join('/'), directory: parts.slice(root).join('/') }
}

const execute = promisify(execFile)

/** Bound a declarative catalog path to a regular TypeScript file inside a repository. */
export function validateRepositoryCatalogPath(path: string): string {
  if (path.length > 256 || !/^[\w./-]+\.ts$/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git'))
    throw new WorkspaceSubscriptionError(400, 'Catalog path must be a repository-relative TypeScript file')
  return path
}

/** Read one public catalog at a fixed remote commit, without a checkout or running repository code. */
export async function readRepositoryCatalogFile(repository: string, branch: string, path: string): Promise<{ content: string, commit: string }> {
  validateRepositoryCatalogPath(path)
  const url = new URL(repository)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new WorkspaceSubscriptionError(400, 'Use an HTTPS repository URL without credentials')
  if (!/^\w[\w./-]{0,199}$/.test(branch) || branch.includes('..') || branch.includes('//'))
    throw new WorkspaceSubscriptionError(400, 'Invalid repository branch')
  const cwd = await mkdtemp(join(tmpdir(), 'craft-hub-catalog-'))
  try {
    await git(cwd, ['init', '--bare', '--quiet'])
    await git(cwd, ['fetch', '--depth=1', '--no-tags', '--quiet', '--', normalizeRepositoryUrl(repository), branch === 'HEAD' ? 'HEAD' : `refs/heads/${branch}`])
    const commit = (await git(cwd, ['rev-parse', 'FETCH_HEAD^{commit}'])).trim()
    const listing = await git(cwd, ['ls-tree', '-z', commit, '--', path])
    const entry = /^(?:100644|100755) blob ([a-f0-9]+)\t([^\0]+)\0$/.exec(listing)
    if (!entry || entry[2] !== path)
      throw new WorkspaceSubscriptionError(404, 'The repository has not published a regular TypeScript catalog at this path')
    const size = Number((await git(cwd, ['cat-file', '-s', entry[1]!])).trim())
    if (!Number.isSafeInteger(size) || size > 2 * 1024 * 1024)
      throw new WorkspaceSubscriptionError(400, 'Catalog exceeds the size limit')
    return { commit, content: await git(cwd, ['cat-file', 'blob', entry[1]!]) }
  }
  finally { await rm(cwd, { recursive: true, force: true }) }
}

/** Identify a local checkout and read its current TypeScript config, including uncommitted changes, without execution. */
export async function readLocalRepositoryCatalogFile(localPath: string, path: string): Promise<{ content: string, localPath: string, repository?: string, commit?: string }> {
  validateRepositoryCatalogPath(path)
  if (!isAbsolute(localPath))
    throw new WorkspaceSubscriptionError(400, 'Select an absolute local repository path')
  const root = await realpath(localPath)
  const gitRoot = await realpath((await git(root, ['rev-parse', '--show-toplevel'])).trim())
  if (root !== gitRoot)
    throw new WorkspaceSubscriptionError(400, 'Select the repository root directory')
  const file = resolve(root, path)
  const resolvedFile = await realpath(file)
  if (relative(root, resolvedFile).startsWith('..') || isAbsolute(relative(root, resolvedFile)) || !(await lstat(file)).isFile())
    throw new WorkspaceSubscriptionError(400, 'Catalog must be a regular file inside the selected repository')
  if ((await lstat(file)).size > 2 * 1024 * 1024)
    throw new WorkspaceSubscriptionError(400, 'Catalog exceeds the size limit')
  const origin = await git(root, ['config', '--get', 'remote.origin.url']).catch(() => '')
  const repository = origin.trim() ? normalizeRepositoryUrl(origin.trim()) : undefined
  const commit = await git(root, ['rev-parse', '--verify', 'HEAD^{commit}']).then(value => value.trim()).catch(() => undefined)
  return { content: await readFile(file, 'utf8'), localPath: root, repository, commit }
}

/** Run read-only Git operations in an isolated repository without checkout, hooks or credential helpers. */
async function git(cwd: string, args: string[], transport?: { origin: string, header: string }): Promise<string> {
  try {
    const result = await execute('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-c', 'http.followRedirects=false', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', ...args], {
      cwd,
      shell: false,
      timeout: 45000,
      maxBuffer: 3 * 1024 * 1024,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: tmpdir(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', ...(transport ? { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `http.${transport.origin}/.extraHeader`, GIT_CONFIG_VALUE_0: transport.header } : {}) },
    })
    return result.stdout
  }
  catch { throw new WorkspaceSubscriptionError(502, 'Repository read failed. Check the URL, branch and access permissions; the last applied snapshot is unchanged.') }
}

/** Read only regular configuration blobs from a local Git object database at an immutable commit. */
export async function readWorkspaceGitTree(cwd: string, revision: string, directory: string): Promise<Record<string, string>> {
  if (!/^[a-f0-9]{40,64}$/.test(revision) || !/^(?:\.craft-hub|craft-hub)(?:\/[\w.-]+)*$/.test(directory) || directory.split('/').some(part => part === '..' || part === '.' || part === '.git'))
    throw new WorkspaceSubscriptionError(400, 'Invalid configuration tree')
  const listing = await git(cwd, ['ls-tree', '-rz', revision, '--', `${directory}/`])
  const files: Record<string, string> = {}
  let size = 0
  for (const line of listing.split('\0').filter(Boolean)) {
    const match = /^(\d+) (\w+) ([a-f0-9]+)\t(.+)$/.exec(line)
    if (!match || !match[4]!.startsWith(`${directory}/`))
      throw new WorkspaceSubscriptionError(400, 'Invalid configuration tree entry')
    const name = match[4]!.slice(directory.length + 1)
    if (!/^(?:project\.ya?ml|(?:workspaces\/)?[\w-]+\.jsonc?)$/.test(name))
      continue
    if (!['100644', '100755'].includes(match[1]!) || match[2] !== 'blob')
      throw new WorkspaceSubscriptionError(400, 'Configuration files must be regular Git blobs')
    if (Object.keys(files).length >= 200)
      throw new WorkspaceSubscriptionError(400, 'Configuration contains too many files')
    const content = await git(cwd, ['cat-file', 'blob', match[3]!])
    size += Buffer.byteLength(content)
    if (Buffer.byteLength(content) > 256 * 1024 || size > 2 * 1024 * 1024)
      throw new WorkspaceSubscriptionError(400, 'Configuration exceeds the size limit')
    files[name] = content
  }
  return files
}

/** Read an HTTPS repository using optional host-owned authentication; headers never reach process arguments or disk. */
export async function readWorkspaceGitRepository(target: { repository: string, branch: string, directory: string }, authorizationHeader?: string): Promise<WorkspaceRepositorySnapshot> {
  const validated = parseWorkspaceRepositoryUrl(`${target.repository}/tree/${target.branch}/${target.directory}`)
  if (authorizationHeader && /[\r\n]/.test(authorizationHeader))
    throw new WorkspaceSubscriptionError(400, 'Invalid repository authentication header')
  const cwd = await mkdtemp(join(tmpdir(), 'craft-hub-source-'))
  try {
    await git(cwd, ['init', '--bare', '--quiet'])
    await git(cwd, ['fetch', '--depth=1', '--no-tags', '--quiet', '--', validated.repository, `refs/heads/${validated.branch}`], authorizationHeader ? { origin: new URL(validated.repository).origin, header: authorizationHeader } : undefined)
    const revision = (await git(cwd, ['rev-parse', 'FETCH_HEAD^{commit}'])).trim()
    return { ...validated, revision, files: await readWorkspaceGitTree(cwd, revision, validated.directory) }
  }
  finally { await rm(cwd, { recursive: true, force: true }) }
}

/** Community reader for public HTTPS repositories; private transports belong to trusted host adapters. */
export const publicWorkspaceRepositoryProvider: WorkspaceRepositoryProvider = {
  id: 'public-git',
  name: 'Public Git',
  accepts: value => value.startsWith('https://'),
  read: value => readWorkspaceGitRepository(parseWorkspaceRepositoryUrl(value)),
}

#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { relative, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function parseArguments(argv) {
  const [view = 'home', ...rest] = argv
  const options = { view }
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index]
    if (argument === '--print') {
      options.print = true
      continue
    }
    if (!argument?.startsWith('--'))
      throw new Error(`Unexpected argument: ${argument}`)
    const value = rest[++index]
    if (!value || value.startsWith('--'))
      throw new Error(`Missing value for ${argument}`)
    options[argument.slice(2)] = value
  }
  return options
}

export async function buildCraftHubUrl(options, runGit = git) {
  if (options.view === 'celebrate') {
    const url = new URL('craft-hub://celebrate')
    url.searchParams.set('v', '1')
    return url.href
  }

  if (options.view === 'home' || options.view === 'marketplace' || options.view === 'settings') {
    const url = new URL('craft-hub://open')
    url.searchParams.set('v', '1')
    if (options.view !== 'home')
      url.searchParams.set('view', options.view)
    return url.href
  }

  if (options.view === 'workspace') {
    if (!options.id)
      throw new Error('workspace requires --id <workspace-id>')
    const url = new URL('craft-hub://workspace')
    url.searchParams.set('v', '1')
    url.searchParams.set('id', options.id)
    if (options.scope && options.scope !== 'personal')
      url.searchParams.set('scope', options.scope)
    return url.href
  }

  if (options.view !== 'project' && options.view !== 'capability')
    throw new Error(`Unsupported view: ${options.view}`)
  if (options.view === 'capability' && !options.id)
    throw new Error('capability requires --id <capability-id>')

  const reference = options.repository
    ? { repository: normalizeRepositoryUrl(options.repository), subdir: options.subdir }
    : await identifyProject(options.path ?? process.cwd(), runGit)
  const url = new URL('craft-hub://project')
  url.searchParams.set('v', '1')
  url.searchParams.set('repo', reference.repository)
  if (reference.subdir)
    url.searchParams.set('subdir', reference.subdir)
  if (options.view === 'capability')
    url.searchParams.set('capability', options.id)
  return url.href
}

async function identifyProject(path, runGit) {
  const projectPath = resolve(path)
  const root = await runGit(projectPath, ['rev-parse', '--show-toplevel'])
  const repository = normalizeRepositoryUrl(await runGit(root, ['remote', 'get-url', 'origin']))
  const subdir = relative(root, projectPath)
  return { repository, subdir: subdir || undefined }
}

export function normalizeRepositoryUrl(input) {
  const value = input.trim()
  const scp = value.includes('://') ? null : /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(value)
  const url = scp ? new URL(`https://${scp[1]}/${scp[2]}`) : new URL(value)
  if (url.protocol !== 'https:' && url.protocol !== 'ssh:')
    throw new Error('Project repository must use HTTPS or SSH')
  const segments = url.pathname.split('/').filter(Boolean)
  if (!url.hostname || !segments.length || url.search || url.hash)
    throw new Error('Project repository URL is invalid')
  segments[segments.length - 1] = segments.at(-1).replace(/\.git$/i, '')
  return `https://${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}/${segments.map(segment => encodeURIComponent(decodeURIComponent(segment))).join('/')}`
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { windowsHide: true })
  return stdout.trim()
}

export async function openCraftHubUrl(url) {
  const invocation = process.platform === 'darwin'
    ? { command: 'open', args: [url] }
    : process.platform === 'win32'
      ? { command: 'explorer.exe', args: [url] }
      : { command: 'xdg-open', args: [url] }
  await execFileAsync(invocation.command, invocation.args, { windowsHide: true })
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const url = await buildCraftHubUrl(options)
  if (options.print)
    process.stdout.write(`${url}\n`)
  else
    await openCraftHubUrl(url)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

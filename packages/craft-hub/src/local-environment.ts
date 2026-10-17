import type { ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { arch, homedir, release, tmpdir } from 'node:os'
import { isAbsolute, join, win32 } from 'node:path'
import process from 'node:process'

/** Fixed tools observed by the workbench; clients cannot supply executable commands. */
export type LocalEnvironmentToolId = 'git' | 'node' | 'npm' | 'pnpm' | 'fnm' | 'homebrew' | 'workstation'

/** One tool observed on the API host, without implying installation or project compatibility. */
export interface LocalEnvironmentTool {
  id: LocalEnvironmentToolId
  name: string
  status: 'available' | 'missing' | 'error' | 'unsupported'
  executablePath?: string
  resolvedPath?: string
  source?: 'path' | 'common-location'
  version?: string
  reason?: 'not-found' | 'platform-unsupported' | 'shell-shim' | 'permission-denied' | 'timeout' | 'output-limit' | 'version-unrecognized' | 'probe-failed' | 'developer-tools-unavailable'
  message?: string
}

/** Read-only observations of the API host, never the device visiting a hosted website. */
export interface LocalEnvironmentSnapshot {
  schemaVersion: 1
  checkedAt: string
  host: { platform: string, arch: string, osRelease: string }
  runtime: { version: string, executablePath: string, arch: string }
  searchDirectories: string[]
  tools: LocalEnvironmentTool[]
}

/** Dependencies for deterministic inspection; production callers use the host defaults. */
export interface LocalEnvironmentInspectionOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  homeDirectory?: string
  commonDirectories?: readonly string[]
  timeoutMs?: number
  probeVersion?: (command: string, args: string[], options: ExecFileOptionsWithStringEncoding) => Promise<string>
}

const tools: Array<{ id: LocalEnvironmentToolId, name: string, command: string, version: RegExp }> = [
  { id: 'git', name: 'Git', command: 'git', version: /^git version (\d+\.\d\S*)/m },
  { id: 'node', name: 'Node.js', command: 'node', version: /^v(\d+\.\d+\.\d\S*)/m },
  { id: 'npm', name: 'npm', command: 'npm', version: /^(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\s*$/m },
  { id: 'pnpm', name: 'pnpm', command: 'pnpm', version: /^(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\s*$/m },
  { id: 'fnm', name: 'fnm', command: 'fnm', version: /^fnm (\d+\.\d\S*)/m },
  { id: 'homebrew', name: 'Homebrew', command: 'brew', version: /^Homebrew (\d+\.\d\S*)/m },
  { id: 'workstation', name: 'Workstation', command: 'workstation', version: /^(?:workstation[ /])?v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)(?=\s|$)/im },
]

function probeVersion(command: string, args: string[], options: ExecFileOptionsWithStringEncoding): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, options, (error, stdout) => error ? reject(error) : resolve(stdout))
    child.stdin?.end()
  })
}

function probeProblem(error: unknown): Pick<LocalEnvironmentTool, 'reason' | 'message'> {
  const detail = error as { code?: string, killed?: boolean }
  if (detail?.killed)
    return { reason: 'timeout', message: 'Version check timed out.' }
  if (detail?.code === 'EACCES' || detail?.code === 'EPERM')
    return { reason: 'permission-denied', message: 'Permission denied while checking this tool.' }
  if (detail?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
    return { reason: 'output-limit', message: 'Version check exceeded the output limit.' }
  return { reason: 'probe-failed', message: 'Version check failed. The executable or its required runtime may be unavailable.' }
}

function commonDirectories(platform: NodeJS.Platform, home: string): string[] {
  if (platform === 'win32')
    return []
  return [
    ...(platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : ['/home/linuxbrew/.linuxbrew/bin', '/usr/local/bin']),
    join(home, '.local', 'bin'),
    join(home, '.local', 'share', 'pnpm'),
    join(home, '.cargo', 'bin'),
    '/usr/bin',
    '/bin',
  ]
}

/**
 * Inspect fixed tool versions using absolute paths, bounded output and no shell.
 * Relative PATH entries, shell startup files and project configuration are not used.
 * A missing result means the bounded search did not find a tool, not that it is uninstalled.
 */
export async function inspectLocalEnvironment(options: LocalEnvironmentInspectionOptions = {}): Promise<LocalEnvironmentSnapshot> {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const pathApi = platform === 'win32' ? win32 : { isAbsolute, join }
  const pathValue = env.PATH ?? (platform === 'win32' ? Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] : '') ?? ''
  const pathDirectories = [...new Set(pathValue.split(platform === 'win32' ? ';' : ':').filter(path => pathApi.isAbsolute(path)))].slice(0, 256)
  const fallbackDirectories = (options.commonDirectories ?? commonDirectories(platform, options.homeDirectory ?? homedir()))
    .filter(path => pathApi.isAbsolute(path) && !pathDirectories.includes(path))
  const searchDirectories = [...pathDirectories, ...new Set(fallbackDirectories)]
  const probeEnv: NodeJS.ProcessEnv = { ...env, PATH: searchDirectories.join(platform === 'win32' ? ';' : ':') }
  delete probeEnv.NODE_OPTIONS
  delete probeEnv.NODE_PATH
  delete probeEnv.BASH_ENV
  delete probeEnv.ENV
  Object.assign(probeEnv, {
    COREPACK_ENABLE_NETWORK: '0',
    COREPACK_ENABLE_AUTO_PIN: '0',
    COREPACK_ENABLE_PROJECT_SPEC: '0',
    COREPACK_DEFAULT_TO_LATEST: '0',
    COREPACK_ENV_FILE: '0',
    HOMEBREW_NO_AUTO_UPDATE: '1',
    npm_config_manage_package_manager_versions: 'false',
  })
  const versionProbe = options.probeVersion ?? probeVersion
  const timeout = Math.min(10_000, Math.max(100, options.timeoutMs ?? 3_000))
  const probeOptions: ExecFileOptionsWithStringEncoding = {
    cwd: tmpdir(),
    env: probeEnv,
    encoding: 'utf8',
    shell: false,
    timeout,
    killSignal: 'SIGKILL',
    maxBuffer: 16 * 1024,
    windowsHide: true,
  }

  const results = await Promise.all(tools.map(async (tool): Promise<LocalEnvironmentTool> => {
    const base = { id: tool.id, name: tool.name }
    if (tool.id === 'homebrew' && platform === 'win32')
      return { ...base, status: 'unsupported', reason: 'platform-unsupported', message: 'Homebrew is not supported on this platform.' }
    // Windows command shims require a shell. Report them without running cmd.exe.
    const extensions = platform === 'win32' ? ['.exe', '.com', '.cmd', '.bat'] : ['']
    let permissionDenied = false
    for (const directory of searchDirectories) {
      for (const extension of extensions) {
        const executablePath = pathApi.join(directory, `${tool.command}${extension}`)
        let resolvedPath: string
        try {
          if (!(await stat(executablePath)).isFile())
            continue
          await access(executablePath, platform === 'win32' ? constants.R_OK : constants.X_OK)
          resolvedPath = await realpath(executablePath)
        }
        catch (error) {
          if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? ''))
            permissionDenied = true
          continue
        }
        const found = { ...base, executablePath, resolvedPath, source: pathDirectories.includes(directory) ? 'path' as const : 'common-location' as const }
        if (platform === 'win32' && ['.cmd', '.bat'].includes(extension))
          return { ...found, status: 'unsupported', reason: 'shell-shim', message: 'Found a Windows shell shim. Its version was not executed.' }
        try {
          let versionCommand = executablePath
          // Apple's Git launcher can show an installation dialog when developer tools are absent.
          // Locate the configured binary without launching that installer-capable wrapper.
          if (platform === 'darwin' && resolvedPath === '/usr/bin/git') {
            try {
              const developerDirectory = (await versionProbe('/usr/bin/xcode-select', ['-p'], probeOptions)).trim()
              if (!isAbsolute(developerDirectory) || developerDirectory.includes('\n'))
                throw new Error('Developer tools are not configured')
              versionCommand = join(developerDirectory, 'usr', 'bin', 'git')
              await access(versionCommand, constants.X_OK)
            }
            catch {
              return { ...found, status: 'error', reason: 'developer-tools-unavailable', message: 'The selected Apple developer tools do not provide a usable Git binary.' }
            }
          }
          const output = await versionProbe(versionCommand, ['--version'], probeOptions)
          const version = output.match(tool.version)?.[1]?.slice(0, 100)
          if (!version)
            return { ...found, status: 'error', reason: 'version-unrecognized', message: 'The tool responded, but its version could not be verified.' }
          return { ...found, status: 'available', version }
        }
        catch (error) {
          return { ...found, status: 'error', ...probeProblem(error) }
        }
      }
    }
    return permissionDenied
      ? { ...base, status: 'error', reason: 'permission-denied', message: 'Permission denied while locating this tool.' }
      : { ...base, status: 'missing', reason: 'not-found', message: 'Not found in the workbench search paths. It may exist in another shell or location.' }
  }))

  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    host: { platform, arch: arch(), osRelease: release() },
    runtime: { version: process.versions.node, executablePath: process.execPath, arch: process.arch },
    searchDirectories,
    tools: results,
  }
}

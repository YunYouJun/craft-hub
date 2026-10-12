import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import process from 'node:process'

/** Host-only inputs for locating a CLI without invoking a shell or a version manager. */
export interface LocalExecutableContext {
  platform?: NodeJS.Platform
  homeDirectory?: string
  env?: NodeJS.ProcessEnv
  readDirectory?: (directory: string) => string[]
  isExecutable?: (candidate: string) => boolean
}

/** Absolute host command and an environment that also supports installed Node shims. */
export interface LocalExecutable {
  command: string
  env: NodeJS.ProcessEnv
}

const unavailable = 'Workstation is unavailable. Configure the versioned local CLI on this host.'

function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile())
      return false
    accessSync(candidate, constants.X_OK)
    return true
  }
  catch { return false }
}

/** Resolve trusted host commands lazily, including pnpm/fnm paths absent from Finder's PATH. */
export function resolveLocalExecutable(command: string, context: LocalExecutableContext = {}): LocalExecutable {
  if (!command || [...command].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    throw new Error(unavailable)
  const platform = context.platform ?? process.platform
  const path = platform === 'win32' ? win32 : posix
  const home = context.homeDirectory ?? homedir()
  const env = { ...(context.env ?? process.env) }
  const pathKeys = Object.keys(env).filter(key => key.toLowerCase() === 'path')
  const pathKey = platform === 'win32' ? pathKeys.includes('Path') ? 'Path' : pathKeys.at(-1) ?? 'PATH' : 'PATH'
  const currentDirectories = (env[pathKey] ?? '').split(path.delimiter)
  const pnpmHome = env.PNPM_HOME && path.isAbsolute(env.PNPM_HOME) ? [env.PNPM_HOME] : []
  const common = platform === 'darwin'
    ? [path.join(home, 'Library/pnpm'), path.join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
    : platform === 'win32' ? [] : [path.join(home, '.local/share/pnpm'), path.join(home, '.local/bin'), '/usr/local/bin', '/usr/bin', '/bin']
  const fnm = platform === 'win32' ? [] : fnmDirectories(platform, home, env, context.readDirectory ?? readdirSync)
  const directories = [...new Set([...currentDirectories, ...pnpmHome, ...common, ...fnm].filter(directory => path.isAbsolute(directory)))]
  if (platform === 'win32') {
    for (const key of pathKeys) {
      if (key !== pathKey)
        delete env[key]
    }
  }
  env[pathKey] = directories.join(path.delimiter)

  // CMD/BAT require a shell; only a native Windows executable is supported here.
  if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(command))
    throw new Error(unavailable)
  const name = platform === 'win32' && !path.extname(command) ? `${command}.exe` : command
  const candidates = path.isAbsolute(name) || name.includes('/') || (platform === 'win32' && name.includes('\\'))
    ? [path.resolve(name)]
    : directories.map(directory => path.join(directory, name))
  const executable = candidates.find(context.isExecutable ?? isExecutableFile)
  if (!executable)
    throw new Error(unavailable)
  return { command: executable, env }
}

function fnmDirectories(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv, readDirectory: (directory: string) => string[]): string[] {
  const configured = env.FNM_DIR && posix.isAbsolute(env.FNM_DIR) ? [env.FNM_DIR] : []
  const roots = [...new Set([...configured, ...(platform === 'darwin' ? [posix.join(home, 'Library/Application Support/fnm')] : []), posix.join(home, '.local/share/fnm'), posix.join(home, '.fnm')])]
  const aliases = roots.map(root => posix.join(root, 'aliases/default/bin'))
  const installed: string[] = []
  for (const root of roots) {
    if (installed.length >= 20)
      break
    try {
      const versions = readDirectory(posix.join(root, 'node-versions'))
        .filter(version => /^v\d+\.\d+\.\d+$/.test(version))
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
        .slice(0, 20 - installed.length)
      installed.push(...versions.map(version => posix.join(root, 'node-versions', version, 'installation/bin')))
    }
    catch {
      // A missing fnm installation does not prevent using another host CLI.
    }
  }
  return [...aliases, ...installed]
}

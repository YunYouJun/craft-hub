import type { CodexOptions } from '@openai/codex-sdk'
import type { DesktopCodexMode } from './build-info.ts'
import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadDesktopBuildInfo } from './build-info.ts'

interface PackagedCodexContext {
  modulePath?: string
  platform?: NodeJS.Platform
  architecture?: string
  env?: NodeJS.ProcessEnv
  resolve?: (specifier: string, fromPath: string) => string
  isFile?: (path: string) => boolean
  isDirectory?: (path: string) => boolean
  isExecutable?: (path: string) => boolean
  readDirectory?: (path: string) => string[]
  homeDirectory?: string
  codexMode?: DesktopCodexMode
}

const targetTriples: Record<string, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
}

function unpackedPath(path: string): string {
  return path.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
}

/** Give subprocesses real filesystem paths when Electron packages the SDK inside ASAR. */
export function packagedCodexOptions(options: CodexOptions = {}, context: PackagedCodexContext = {}): CodexOptions {
  const modulePath = context.modulePath ?? fileURLToPath(import.meta.url)
  if (options.codexPathOverride || unpackedPath(modulePath) === modulePath)
    return options

  const platform = context.platform ?? process.platform
  const architecture = context.architecture ?? process.arch
  const path = platform === 'win32' ? win32 : posix
  const mode = context.codexMode ?? loadDesktopBuildInfo(path.resolve(path.dirname(modulePath), '../desktop-build.json')).codexMode ?? 'bundled'
  if (mode === 'external')
    return externalCodexOptions(options, context, platform)
  const packagePlatform = platform === 'android' ? 'linux' : platform
  const targetTriple = targetTriples[`${packagePlatform}-${architecture}`]
  if (!targetTriple)
    throw new Error(`Unsupported packaged Codex platform: ${platform} (${architecture})`)

  const resolve = context.resolve ?? ((specifier, fromPath) => createRequire(fromPath).resolve(specifier))
  const codexPackage = resolve('@openai/codex/package.json', modulePath)
  const nativePackage = resolve(`@openai/codex-${packagePlatform}-${architecture}/package.json`, codexPackage)
  const root = path.join(path.dirname(unpackedPath(nativePackage)), 'vendor', targetTriple)
  const isFile = context.isFile ?? ((filePath) => {
    try {
      return statSync(filePath).isFile()
    }
    catch {
      return false
    }
  })
  const isDirectory = context.isDirectory ?? ((directory) => {
    try {
      return statSync(directory).isDirectory()
    }
    catch {
      return false
    }
  })
  const executableName = platform === 'win32' ? 'codex.exe' : 'codex'
  const currentExecutable = path.join(root, 'bin', executableName)
  const currentLayout = isFile(currentExecutable) && isFile(path.join(root, 'codex-package.json'))
  const executable = currentLayout ? currentExecutable : path.join(root, 'codex', executableName)
  if (!isFile(executable))
    throw new Error(`Packaged Codex executable is missing: ${executable}`)

  const pathDirectory = path.join(root, currentLayout ? 'codex-path' : 'path')
  const env = { ...Object.fromEntries(Object.entries(context.env ?? process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), ...options.env }
  if (isDirectory(pathDirectory)) {
    const pathKeys = Object.keys(env).filter(key => key.toLowerCase() === 'path')
    const pathKey = platform === 'win32' ? pathKeys.includes('Path') ? 'Path' : pathKeys.at(-1) ?? 'PATH' : 'PATH'
    const overridePathKey = Object.keys(options.env ?? {}).filter(key => key.toLowerCase() === 'path').at(-1)
    const existingPath = platform === 'win32' && overridePathKey ? options.env?.[overridePathKey] : env[pathKey]
    if (platform === 'win32') {
      for (const key of pathKeys) {
        if (key !== pathKey)
          delete env[key]
      }
    }
    env[pathKey] = [pathDirectory, existingPath].filter(Boolean).join(path.delimiter)
  }
  return { ...options, codexPathOverride: executable, env }
}

function externalCodexOptions(options: CodexOptions, context: PackagedCodexContext, platform: NodeJS.Platform): CodexOptions {
  const path = platform === 'win32' ? win32 : posix
  const env = { ...Object.fromEntries(Object.entries(context.env ?? process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), ...options.env }
  const pathKeys = Object.keys(env).filter(key => key.toLowerCase() === 'path')
  const pathKey = platform === 'win32' ? pathKeys.includes('Path') ? 'Path' : pathKeys.at(-1) ?? 'PATH' : 'PATH'
  const overrideKey = Object.keys(options.env ?? {}).filter(key => key.toLowerCase() === 'path').at(-1)
  const currentPath = platform === 'win32' && overrideKey ? options.env?.[overrideKey] : env[pathKey]
  const home = context.homeDirectory ?? homedir()
  const extraDirectories = guiToolDirectories(platform, home, env, context.readDirectory ?? readdirSync)
  const directories = [...new Set([...(currentPath ?? '').split(path.delimiter), ...extraDirectories].filter(directory => path.isAbsolute(directory)))]
  if (platform === 'win32') {
    for (const key of pathKeys) {
      if (key !== pathKey)
        delete env[key]
    }
  }
  env[pathKey] = directories.join(path.delimiter)
  const isExecutable = context.isExecutable ?? ((candidate) => {
    try {
      if (!statSync(candidate).isFile())
        return false
      accessSync(candidate, constants.X_OK)
      return true
    }
    catch {
      return false
    }
  })
  const name = platform === 'win32' ? 'codex.exe' : 'codex'
  const appExecutables = platform === 'darwin' ? macosAppExecutables(home) : []
  const executable = [...directories.map(directory => path.join(directory, name)), ...appExecutables].find(candidate => isExecutable(candidate))
  if (!executable) {
    const detail = platform === 'win32' ? 'Windows .cmd and .bat shims are unsupported; provide a native codex.exe on PATH.' : 'An installed Codex or ChatGPT application with its native CLI is also supported.'
    throw new Error(`No executable Codex CLI was found. Open Software Center and install Codex CLI, then retry this task. ${detail}`)
  }
  if (appExecutables.includes(executable))
    addAppCompanionPath(executable, env, context)
  return { ...options, codexPathOverride: executable, env }
}

function addAppCompanionPath(executable: string, env: Record<string, string>, context: PackagedCodexContext): void {
  const separator = '/Contents/Resources/codex-cli/'
  const offset = executable.indexOf(separator)
  if (offset === -1)
    return
  const directory = posix.join(executable.slice(0, offset + separator.length), 'codex-path')
  try {
    if (context.isDirectory?.(directory) ?? statSync(directory).isDirectory())
      env.PATH = [directory, env.PATH].filter(Boolean).join(posix.delimiter)
  }
  catch {
    // Older app layouts may not ship a companion PATH directory.
  }
}

function guiToolDirectories(platform: NodeJS.Platform, home: string, env: Record<string, string>, readDirectory: (path: string) => string[]): string[] {
  const path = platform === 'win32' ? win32 : posix
  const common = platform === 'darwin'
    ? [path.join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', path.join(home, 'Library/pnpm')]
    : platform === 'win32' ? [] : [path.join(home, '.local/bin'), '/usr/local/bin', '/usr/bin', '/bin', path.join(home, '.local/share/pnpm')]
  const pnpmHome = env.PNPM_HOME && path.isAbsolute(env.PNPM_HOME) ? [env.PNPM_HOME] : []
  if (platform === 'win32')
    return [...pnpmHome, ...common]
  const configuredFnm = env.FNM_DIR && path.isAbsolute(env.FNM_DIR) ? [env.FNM_DIR] : []
  const fnmRoots = [...new Set([...configuredFnm, ...(platform === 'darwin' ? [path.join(home, 'Library/Application Support/fnm')] : []), path.join(home, '.local/share/fnm'), path.join(home, '.fnm')])]
  const fnmDirectories = fnmRoots.flatMap((root) => {
    let versions: string[] = []
    try {
      versions = readDirectory(path.join(root, 'node-versions')).filter(version => /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)).sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    }
    catch {
      // GUI startup does not require fnm or Node to be installed.
    }
    return [path.join(root, 'aliases/default/bin'), ...versions.map(version => path.join(root, 'node-versions', version, 'installation/bin'))]
  })
  return [...pnpmHome, ...common, ...fnmDirectories]
}

function macosAppExecutables(home: string): string[] {
  return ['/Applications', posix.join(home, 'Applications')].flatMap(directory => ['Codex.app', 'ChatGPT.app'].flatMap((application) => {
    const resources = posix.join(directory, application, 'Contents/Resources')
    return [posix.join(resources, 'codex'), posix.join(resources, 'codex-cli/CodexCLI.app/Contents/MacOS/codex'), posix.join(resources, 'codex-cli/bin/codex')]
  }))
}

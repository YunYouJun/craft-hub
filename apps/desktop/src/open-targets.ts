import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import process from 'node:process'

/** Build the URL handled by Visual Studio Code for a local file or folder. */
export function vscodeUrl(path: string, line?: number): string {
  const normalized = path.replaceAll('\\', '/')
  const absolutePath = normalized.startsWith('/') ? normalized : `/${normalized}`
  const encodedPath = absolutePath.split('/').map(encodeURIComponent).join('/')
  const location = typeof line === 'number' && Number.isInteger(line) && line > 0 ? `:${line}` : ''
  return `vscode://file${encodedPath}${location}`
}

/** Validate an untrusted terminal URL before handing it to the operating system. */
export function externalHttpUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error(`Unsupported external URL protocol: ${url.protocol}`)
  return url.href
}

/** Build the documented Codex Desktop deep link for one local thread. */
export function codexThreadUrl(threadId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(threadId))
    throw new Error('Invalid Codex thread id')
  return `codex://threads/${threadId}`
}

/** Resolve the Codex launcher, including the CLI bundled with the macOS app. */
export function codexCommand(
  platform = process.platform,
  exists: (path: string) => boolean = existsSync,
): string {
  if (process.env.CODEX_CLI_PATH)
    return process.env.CODEX_CLI_PATH

  if (platform === 'darwin') {
    const candidates = [
      '/Applications/Codex.app/Contents/Resources/codex',
      '/Applications/ChatGPT.app/Contents/Resources/codex',
    ]
    const bundled = candidates.find(exists)
    if (bundled)
      return bundled
  }

  return platform === 'win32' ? 'codex.exe' : 'codex'
}

/** List installed macOS terminal applications in automatic-selection order. */
export function macTerminalApplications(
  preferred = process.env.CRAFT_HUB_TERMINAL_APP,
  exists: (path: string) => boolean = existsSync,
): string[] {
  const candidates = [
    { name: 'iTerm', paths: ['/Applications/iTerm.app', '/Applications/iTerm2.app', `${homedir()}/Applications/iTerm.app`, `${homedir()}/Applications/iTerm2.app`] },
    { name: 'Ghostty', paths: ['/Applications/Ghostty.app', `${homedir()}/Applications/Ghostty.app`] },
    { name: 'Warp', paths: ['/Applications/Warp.app', `${homedir()}/Applications/Warp.app`] },
    { name: 'Terminal', paths: ['/System/Applications/Utilities/Terminal.app', '/Applications/Utilities/Terminal.app'] },
  ]
  const installed = candidates.filter(candidate => candidate.paths.some(exists)).map(candidate => candidate.name)
  return preferred ? [preferred, ...installed.filter(application => application !== preferred)] : installed
}

/** Resolve the preferred installed macOS terminal application. */
export function macTerminalApplication(
  preferred = process.env.CRAFT_HUB_TERMINAL_APP,
  exists: (path: string) => boolean = existsSync,
): string {
  return macTerminalApplications(preferred, exists)[0] ?? 'Terminal'
}

/** Launch a Codex workspace without routing the project path through a shell. */
export function openCodexProject(
  path: string,
  launch: (command: string, args: string[], options: SpawnOptions) => ChildProcess = spawn,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = launch(codexCommand(), ['app', path], {
      detached: true,
      shell: false,
      stdio: 'ignore',
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

/** Open a project directory in a macOS terminal without invoking a shell. */
export function openMacTerminalProject(
  path: string,
  application = macTerminalApplication(),
  platform = process.platform,
  launch: (command: string, args: string[], options: SpawnOptions) => ChildProcess = spawn,
): Promise<void> {
  if (platform !== 'darwin')
    return Promise.reject(new Error('Opening a project terminal is currently supported on macOS only'))

  return new Promise((resolve, reject) => {
    const child = launch('open', ['-a', application, path], {
      detached: true,
      shell: false,
      stdio: 'ignore',
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

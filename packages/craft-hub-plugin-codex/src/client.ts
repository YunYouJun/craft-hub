import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import process from 'node:process'

/** Query allowlist; an isolated editor session additionally exposes one scoped plugin edit. */
export type CodexReadMethod = 'config/read' | 'plugin/list' | 'plugin/installed'
export interface CodexReader {
  read: (method: CodexReadMethod, params: Record<string, unknown>) => Promise<unknown>
  editPlugin?: (id: string, value: boolean | null) => Promise<unknown>
  close: () => void
}

export class CodexMethodUnavailableError extends Error {}

/** Find the locally installed CLI without relying on a project executable. */
export function codexExecutable(): string {
  if (process.platform === 'darwin') {
    for (const path of ['/Applications/ChatGPT.app/Contents/Resources/codex', '/Applications/Codex.app/Contents/Resources/codex']) {
      if (existsSync(path))
        return path
    }
  }
  return process.platform === 'win32' ? 'codex.exe' : 'codex'
}

/** Open a bounded configuration session; configHome is reserved for isolated TOML editing. */
export async function openCodexReader(executable = codexExecutable(), timeoutMs = 20000, configHome?: string): Promise<CodexReader> {
  const child = spawn(executable, ['app-server', '--stdio'], { cwd: homedir(), ...(configHome ? { env: { ...process.env, CODEX_HOME: configHome } } : {}), shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
  let nextId = 0
  let buffer = ''
  let bytes = 0
  let closed = false
  const pending = new Map<number, { resolve: (result: unknown) => void, reject: (error: Error) => void }>()
  let timer: ReturnType<typeof setTimeout>
  const close = (message = 'Codex configuration reader closed'): void => {
    if (closed)
      return
    closed = true
    clearTimeout(timer)
    for (const request of pending.values())
      request.reject(new Error(message))
    pending.clear()
    child.stdin.end()
    child.kill()
  }
  timer = setTimeout(close, timeoutMs, 'Codex configuration query timed out. Check that the local Codex CLI is available.')
  child.on('error', () => close('Cannot start Codex. Install the Codex CLI or desktop app on this host.'))
  child.on('exit', () => close('Codex configuration reader exited before completing the query.'))
  child.stdin.on('error', () => close('Cannot communicate with the Codex configuration reader.'))
  // Drain diagnostics without exposing credentials or unfiltered configuration to the UI.
  child.stderr.resume()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    bytes += Buffer.byteLength(chunk)
    if (bytes > 16 * 1024 * 1024) {
      close('Codex configuration response exceeded the size limit.')
      return
    }
    buffer += chunk
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n')
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (!line.trim())
        continue
      try {
        const message = JSON.parse(line)
        const request = pending.get(message.id)
        if (!request)
          continue
        pending.delete(message.id)
        if (message.error)
          request.reject(message.error.code === -32601 ? new CodexMethodUnavailableError('Codex method is unavailable.') : new Error('Codex rejected the configuration query. Check CLI compatibility and configuration syntax.'))
        else
          request.resolve(message.result)
      }
      catch {
        close('Codex returned an invalid configuration response.')
        return
      }
    }
  })
  const request = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    if (closed)
      return Promise.reject(new Error('Codex configuration reader is closed.'))
    return new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }
  try {
    await request('initialize', { clientInfo: { name: 'craft_hub_configuration', version: '0.1.0' }, capabilities: { experimentalApi: true } })
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`)
  }
  catch (error) {
    close()
    throw error
  }
  return {
    read: (method, params) => {
      if (method !== 'config/read' && method !== 'plugin/list' && method !== 'plugin/installed')
        return Promise.reject(new Error('Only read-only Codex configuration methods are allowed.'))
      return request(method, params)
    },
    ...(configHome ? { editPlugin: (id: string, value: boolean | null) => request('config/value/write', { keyPath: `plugins.${JSON.stringify(id)}.enabled`, value, mergeStrategy: 'replace' }) } : {}),
    close,
  }
}

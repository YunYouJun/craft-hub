import type { AddressInfo } from 'node:net'
import type { CodexActivityHookReview } from './codex-activity-hooks.ts'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { CodexActivityHooks } from './codex-activity-hooks.ts'

const recentRolloutWindowMs = 30 * 60 * 1000

interface CodexHookEvent {
  hook_event_name?: unknown
  session_id?: unknown
  turn_id?: unknown
}

export interface CodexActivityStatus {
  diagnostic?: string
  hooksPath?: string
  installed: boolean
  ownHookCount?: number
  otherHookCount?: number
  requiresTrustReview?: boolean
  runningSessionIds: string[]
  supported: boolean
}

export interface CodexActivityMonitorOptions {
  codexHome?: string
  dataDir: string
  onStatus?: (status: CodexActivityStatus) => void
  platform?: NodeJS.Platform
}

async function recentRolloutPaths(root: string): Promise<string[]> {
  const found: Array<{ modifiedAt: number, path: string }> = []
  async function visit(path: string): Promise<void> {
    let entries
    try {
      entries = await readdir(path, { withFileTypes: true })
    }
    catch {
      return
    }
    await Promise.all(entries.map(async (entry) => {
      const child = join(path, entry.name)
      if (entry.isDirectory()) {
        await visit(child)
        return
      }
      if (!entry.isFile() || !entry.name.startsWith('rollout-') || !entry.name.endsWith('.jsonl'))
        return
      const details = await stat(child)
      if (Date.now() - details.mtimeMs <= recentRolloutWindowMs)
        found.push({ modifiedAt: details.mtimeMs, path: child })
    }))
  }
  await visit(root)
  return found.sort((left, right) => right.modifiedAt - left.modifiedAt).slice(0, 100).map(item => item.path)
}

async function inspectRollout(path: string): Promise<string | undefined> {
  const file = await open(path, 'r')
  try {
    const details = await file.stat()
    const headSize = Math.min(details.size, 64 * 1024)
    const tailSize = Math.min(details.size, 2 * 1024 * 1024)
    const head = Buffer.alloc(headSize)
    const tail = Buffer.alloc(tailSize)
    await file.read(head, 0, headSize, 0)
    await file.read(tail, 0, tailSize, details.size - tailSize)
    const metadataLine = head.toString('utf8').split('\n').find(Boolean)
    if (!metadataLine)
      return undefined
    const metadata = JSON.parse(metadataLine) as { payload?: { id?: unknown, originator?: unknown, source?: unknown } }
    const originator = typeof metadata.payload?.originator === 'string' ? metadata.payload.originator.toLowerCase() : ''
    if (!originator.includes('desktop'))
      return undefined

    let running = false
    for (const line of tail.toString('utf8').split('\n')) {
      if (!line.trim())
        continue
      try {
        const record = JSON.parse(line) as { type?: unknown, payload?: { type?: unknown } }
        if (record.type !== 'event_msg')
          continue
        if (record.payload?.type === 'task_started')
          running = true
        else if (record.payload?.type === 'task_complete' || record.payload?.type === 'turn_aborted' || record.payload?.type === 'turn_failed')
          running = false
      }
      catch {}
    }
    return running && typeof metadata.payload?.id === 'string' ? metadata.payload.id : undefined
  }
  finally {
    await file.close()
  }
}

async function runningDesktopRollouts(codexHome: string): Promise<string[]> {
  const paths = await recentRolloutPaths(join(codexHome, 'sessions'))
  const inspected = await Promise.all(paths.map(path => inspectRollout(path).catch(() => undefined)))
  return inspected.filter((value): value is string => Boolean(value))
}

/** Tracks Codex Desktop turns through official command hooks without persisting prompt content. */
export class CodexActivityMonitor {
  readonly hooks: CodexActivityHooks
  readonly #codexHome: string
  readonly #endpointPath: string
  readonly #onStatus?: (status: CodexActivityStatus) => void
  readonly #platform: NodeJS.Platform
  readonly #fallbackRunningSessionIds = new Set<string>()
  readonly #hookRunningSessionIds = new Set<string>()
  #diagnostic: string | undefined
  #ownHookCount = 0
  #otherHookCount = 0
  #closed = false
  #installed = false
  #statusGeneration = 0
  #server: ReturnType<typeof createServer> | undefined
  #endpointContent: string | undefined

  constructor(options: CodexActivityMonitorOptions) {
    this.#platform = options.platform ?? process.platform
    this.#codexHome = options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')
    this.hooks = new CodexActivityHooks(this.#codexHome, options.dataDir)
    this.#endpointPath = this.hooks.endpointPath
    this.#onStatus = options.onStatus
  }

  async start(): Promise<void> {
    if (this.#platform !== 'darwin')
      return
    if (this.#server)
      throw new Error('Activity monitor is already started')
    this.#closed = false
    const token = randomUUID()
    this.#server = createServer((request, response) => {
      if (request.method !== 'POST' || request.url !== `/${token}`) {
        response.writeHead(404).end()
        return
      }
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        if (body.length <= 256 * 1024)
          body += chunk
      })
      request.on('end', () => {
        if (body.length <= 256 * 1024) {
          try {
            this.accept(JSON.parse(body) as CodexHookEvent)
          }
          catch {}
        }
        response.writeHead(204).end()
      })
    })
    await new Promise<void>((resolvePromise, reject) => {
      this.#server!.once('error', reject)
      this.#server!.listen(0, '127.0.0.1', () => resolvePromise())
    })
    const address = this.#server.address() as AddressInfo
    await mkdir(dirname(this.#endpointPath), { recursive: true })
    const endpoint = `http://127.0.0.1:${address.port}/${token}\n`
    await writeFile(this.#endpointPath, endpoint, { encoding: 'utf8', mode: 0o600 })
    this.#endpointContent = endpoint
    await this.status()
  }

  async close(): Promise<void> {
    this.#closed = true
    this.#statusGeneration++
    this.hooks.clearReviews()
    if (this.#endpointContent && await readFile(this.#endpointPath, 'utf8').catch(() => undefined) === this.#endpointContent)
      await rm(this.#endpointPath, { force: true })
    this.#endpointContent = undefined
    if (this.#server) {
      this.#server.closeAllConnections()
      await new Promise<void>(resolvePromise => this.#server!.close(() => resolvePromise()))
      this.#server = undefined
    }
  }

  accept(event: CodexHookEvent): void {
    if (this.#closed || !this.#installed)
      return
    const sessionId = typeof event.session_id === 'string' ? event.session_id : undefined
    if (!sessionId || sessionId.length > 256)
      return
    if (event.hook_event_name === 'UserPromptSubmit' && this.#hookRunningSessionIds.size < 1000)
      this.#hookRunningSessionIds.add(sessionId)
    else if (event.hook_event_name === 'Stop' || event.hook_event_name === 'SessionEnd')
      this.#hookRunningSessionIds.delete(sessionId)
    else
      return
    this.#emitStatus()
  }

  async status(): Promise<CodexActivityStatus> {
    const generation = ++this.#statusGeneration
    let installed = false
    let ownHookCount = 0
    let otherHookCount = 0
    let diagnostic: string | undefined
    let fallback: string[] = []
    if (this.#platform === 'darwin') {
      try {
        const state = await this.hooks.status()
        installed = state.installed
        ownHookCount = state.ownHookCount
        otherHookCount = state.otherHookCount
        if (installed)
          fallback = await runningDesktopRollouts(this.#codexHome)
      }
      catch (error) { diagnostic = error instanceof Error ? error.message : String(error) }
    }
    if (generation === this.#statusGeneration && !this.#closed) {
      this.#diagnostic = diagnostic
      this.#installed = installed
      this.#ownHookCount = ownHookCount
      this.#otherHookCount = otherHookCount
      this.#fallbackRunningSessionIds.clear()
      for (const id of fallback)
        this.#fallbackRunningSessionIds.add(id)
    }
    return { ...this.#snapshot(installed), ownHookCount, otherHookCount, diagnostic, runningSessionIds: installed ? [...new Set([...this.#hookRunningSessionIds, ...fallback])] : [] }
  }

  /** Prepare a read-only review for native consent, retaining other profiles' hook commands. */
  async review(action: 'install' | 'uninstall'): Promise<CodexActivityHookReview> {
    if (this.#platform !== 'darwin' || this.#closed)
      throw new Error('Codex activity is unavailable')
    return this.hooks.review(action)
  }

  /** Consume a reviewed operation; configuration or script changes require a new review. */
  async apply(id: string): Promise<CodexActivityStatus> {
    if (this.#platform !== 'darwin' || this.#closed)
      throw new Error('Codex activity is unavailable')
    const action = await this.hooks.apply(id)
    this.#fallbackRunningSessionIds.clear()
    this.#hookRunningSessionIds.clear()
    const status = { ...await this.status(), ...(action === 'install' ? { requiresTrustReview: true } : {}) }
    if (!this.#closed)
      this.#onStatus?.(status)
    return status
  }

  /** Electron's existing explicit enable action; native callers use the separate review/apply flow. */
  async install(): Promise<CodexActivityStatus> {
    if (this.#platform !== 'darwin')
      return this.#snapshot(false)
    return this.apply((await this.review('install')).id)
  }

  /** Remove this profile's commands only, retaining other hosts and unrelated hooks. */
  async uninstall(): Promise<CodexActivityStatus> {
    if (this.#platform !== 'darwin')
      return this.#snapshot(false)
    return this.apply((await this.review('uninstall')).id)
  }

  #emitStatus(): void {
    const pending = this.status()
    const generation = this.#statusGeneration
    void pending.then((status) => {
      if (!this.#closed && generation === this.#statusGeneration)
        this.#onStatus?.(status)
    })
  }

  #snapshot(installed: boolean): CodexActivityStatus {
    return {
      ...(this.#diagnostic ? { diagnostic: this.#diagnostic } : {}),
      hooksPath: this.hooks.hooksPath,
      ownHookCount: this.#ownHookCount,
      otherHookCount: this.#otherHookCount,
      installed,
      runningSessionIds: [...new Set([...this.#hookRunningSessionIds, ...this.#fallbackRunningSessionIds])],
      supported: this.#platform === 'darwin',
    }
  }
}

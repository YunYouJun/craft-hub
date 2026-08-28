import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

const hookMarker = '# craft-hub-codex-activity'
const hookEvents = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop'] as const
const recentRolloutWindowMs = 30 * 60 * 1000

interface HookCommand {
  command?: unknown
  type?: unknown
  [key: string]: unknown
}

interface HookGroup {
  hooks?: HookCommand[]
  [key: string]: unknown
}

interface HooksDocument {
  hooks?: Record<string, HookGroup[]>
  [key: string]: unknown
}

interface CodexHookEvent {
  hook_event_name?: unknown
  session_id?: unknown
  turn_id?: unknown
}

export interface CodexActivityStatus {
  diagnostic?: string
  hooksPath?: string
  installed: boolean
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

function shellQuote(value: string): string {
  const quote = String.fromCharCode(39)
  return `${quote}${value.replaceAll(quote, `${quote}\\${quote}${quote}`)}${quote}`
}

function isCraftHubCommand(command: HookCommand): boolean {
  return command.type === 'command' && typeof command.command === 'string' && command.command.includes(hookMarker)
}

function withoutCraftHubHooks(document: HooksDocument): HooksDocument {
  const hooks = { ...document.hooks }
  for (const event of hookEvents) {
    const groups = hooks[event]
    if (!Array.isArray(groups))
      continue
    const next = groups
      .map(group => ({ ...group, hooks: group.hooks?.filter(command => !isCraftHubCommand(command)) }))
      .filter(group => !Array.isArray(group.hooks) || group.hooks.length > 0)
    if (next.length)
      hooks[event] = next
    else
      delete hooks[event]
  }
  return { ...document, hooks }
}

async function readHooksDocument(path: string): Promise<HooksDocument> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('hooks.json must contain a JSON object')
    return value as HooksDocument
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return {}
    throw error
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryPath, path)
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
  readonly #bridgePath: string
  readonly #codexHome: string
  readonly #endpointPath: string
  readonly #hooksPath: string
  readonly #onStatus?: (status: CodexActivityStatus) => void
  readonly #platform: NodeJS.Platform
  readonly #fallbackRunningSessionIds = new Set<string>()
  readonly #hookRunningSessionIds = new Set<string>()
  #diagnostic: string | undefined
  #server: ReturnType<typeof createServer> | undefined

  constructor(options: CodexActivityMonitorOptions) {
    this.#platform = options.platform ?? process.platform
    this.#codexHome = options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')
    this.#hooksPath = join(this.#codexHome, 'hooks.json')
    this.#bridgePath = resolve(options.dataDir, 'codex-hook-bridge.sh')
    this.#endpointPath = resolve(options.dataDir, 'codex-hook-endpoint')
    this.#onStatus = options.onStatus
  }

  async start(): Promise<void> {
    if (this.#platform !== 'darwin')
      return
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
    await writeFile(this.#endpointPath, `http://127.0.0.1:${address.port}/${token}\n`, { encoding: 'utf8', mode: 0o600 })
  }

  async close(): Promise<void> {
    await rm(this.#endpointPath, { force: true })
    if (this.#server) {
      await new Promise<void>(resolvePromise => this.#server!.close(() => resolvePromise()))
      this.#server = undefined
    }
  }

  accept(event: CodexHookEvent): void {
    const sessionId = typeof event.session_id === 'string' ? event.session_id : undefined
    if (!sessionId)
      return
    if (event.hook_event_name === 'UserPromptSubmit')
      this.#hookRunningSessionIds.add(sessionId)
    else if (event.hook_event_name === 'Stop' || event.hook_event_name === 'SessionEnd')
      this.#hookRunningSessionIds.delete(sessionId)
    else
      return
    this.#emitStatus()
  }

  async status(): Promise<CodexActivityStatus> {
    let installed = false
    this.#diagnostic = undefined
    if (this.#platform === 'darwin') {
      try {
        const document = await readHooksDocument(this.#hooksPath)
        installed = Object.values(document.hooks ?? {}).some(groups => groups.some(group => group.hooks?.some(isCraftHubCommand)))
        this.#fallbackRunningSessionIds.clear()
        if (installed) {
          for (const sessionId of await runningDesktopRollouts(this.#codexHome))
            this.#fallbackRunningSessionIds.add(sessionId)
        }
      }
      catch (error) {
        this.#diagnostic = error instanceof Error ? error.message : String(error)
      }
    }
    return this.#snapshot(installed)
  }

  async install(): Promise<CodexActivityStatus> {
    if (this.#platform !== 'darwin')
      return this.#snapshot(false)
    const script = `#!/bin/sh\nendpoint_file=${shellQuote(this.#endpointPath)}\n[ -r "$endpoint_file" ] || exit 0\nendpoint=$(/bin/cat "$endpoint_file")\n/usr/bin/curl --silent --max-time 1 --header 'content-type: application/json' --data-binary @- "$endpoint" >/dev/null 2>&1 || true\nexit 0\n`
    await mkdir(dirname(this.#bridgePath), { recursive: true })
    await writeFile(this.#bridgePath, script, { encoding: 'utf8', mode: 0o700 })
    await chmod(this.#bridgePath, 0o700)

    const document = withoutCraftHubHooks(await readHooksDocument(this.#hooksPath))
    const hooks = { ...document.hooks }
    const command = `${shellQuote(this.#bridgePath)} ${hookMarker}`
    for (const event of hookEvents) {
      hooks[event] = [
        ...(hooks[event] ?? []),
        { hooks: [{ type: 'command', command, timeout: event === 'SessionEnd' ? 3 : 5 }] },
      ]
    }
    await writeJsonAtomically(this.#hooksPath, { ...document, hooks })
    this.#diagnostic = undefined
    return { ...await this.status(), requiresTrustReview: true }
  }

  async uninstall(): Promise<CodexActivityStatus> {
    if (this.#platform !== 'darwin')
      return this.#snapshot(false)
    const document = withoutCraftHubHooks(await readHooksDocument(this.#hooksPath))
    await writeJsonAtomically(this.#hooksPath, document)
    await rm(this.#bridgePath, { force: true })
    this.#fallbackRunningSessionIds.clear()
    this.#hookRunningSessionIds.clear()
    this.#diagnostic = undefined
    return this.#snapshot(false)
  }

  #emitStatus(): void {
    void this.status().then(status => this.#onStatus?.(status))
  }

  #snapshot(installed: boolean): CodexActivityStatus {
    return {
      ...(this.#diagnostic ? { diagnostic: this.#diagnostic } : {}),
      hooksPath: this.#hooksPath,
      installed,
      runningSessionIds: [...new Set([...this.#hookRunningSessionIds, ...this.#fallbackRunningSessionIds])],
      supported: this.#platform === 'darwin',
    }
  }
}

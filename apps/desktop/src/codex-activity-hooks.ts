import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// Older Electron builds remove every command containing their legacy marker. New profile hooks must not match it.
const marker = '# craft-hub-profile-activity-v1'
const legacyMarker = '# craft-hub-codex-activity'
const events = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop'] as const
interface Hook { command?: unknown, type?: unknown, [key: string]: unknown }
interface Group { hooks?: Hook[], [key: string]: unknown }
interface Document { hooks?: Record<string, Group[]>, [key: string]: unknown }
interface FileSnapshot { content?: string, mode?: number, revision: string }
interface Snapshot { hooks: FileSnapshot, bridge: FileSnapshot, document: Document }

function quote(value: string): string {
  return `'${value.replaceAll('\'', '\'\\\'\'')}'`
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function read(path: string): Promise<FileSnapshot> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT')
      throw error
  })
  if (!file)
    return { revision: 'absent' }
  try {
    const before = await file.stat({ bigint: true })
    if (!before.isFile() || before.nlink !== 1n || before.size > 1024n * 1024n)
      throw new Error('Hook configuration must be a regular file of at most 1 MiB')
    const buffer = Buffer.alloc(1024 * 1024 + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    const after = await file.stat({ bigint: true })
    if (bytesRead > 1024 * 1024 || before.size !== after.size || before.ctimeNs !== after.ctimeNs)
      throw new Error('Hook configuration changed while reading; review it again')
    return { content: buffer.subarray(0, bytesRead).toString('utf8'), mode: Number(before.mode), revision: `${before.dev}:${before.ino}:${before.ctimeNs}:${before.mode}:${createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex')}` }
  }
  finally { await file.close() }
}

async function replace(path: string, content: string, mode: number): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx', mode)
    try {
      await file.writeFile(content)
      await file.sync()
    }
    finally { await file.close() }
    await rename(temporary, path)
  }
  finally { await rm(temporary, { force: true }) }
}

/** Immutable, short-lived native review. Other profiles' hooks are always retained. */
export interface CodexActivityHookReview {
  id: string
  action: 'install' | 'uninstall'
  hooksPath: string
  bridgePath: string
  ownHookCount: number
  otherHookCount: number
  expiresAt: string
}

/** Shared hook-file adapter; ownership is the exact generated command, never a generic marker alone. */
export class CodexActivityHooks {
  readonly hooksPath: string
  readonly bridgePath: string
  readonly endpointPath: string
  readonly #command: string
  readonly #legacyCommand: string
  readonly #script: string
  readonly #reviews = new Map<string, { review: CodexActivityHookReview, snapshot: Snapshot }>()
  #applying = false

  constructor(codexHome: string, dataDir: string) {
    this.hooksPath = resolve(codexHome, 'hooks.json')
    this.bridgePath = resolve(dataDir, 'codex-hook-bridge.sh')
    this.endpointPath = resolve(dataDir, 'codex-hook-endpoint')
    this.#command = `${quote(this.bridgePath)} ${marker}`
    this.#legacyCommand = `${quote(this.bridgePath)} ${legacyMarker}`
    this.#script = `#!/bin/sh\nendpoint_file=${quote(this.endpointPath)}\n[ -r "$endpoint_file" ] || exit 0\nendpoint=$(/bin/cat "$endpoint_file")\n/usr/bin/curl --noproxy '*' --proto '=http' --silent --max-time 1 --header 'content-type: application/json' --data-binary @- "$endpoint" >/dev/null 2>&1 || true\nexit 0\n`
  }

  async #snapshot(): Promise<Snapshot> {
    const [hooks, bridge] = await Promise.all([read(this.hooksPath), read(this.bridgePath)])
    const value: unknown = hooks.content === undefined ? {} : JSON.parse(hooks.content)
    if (!object(value) || (value.hooks !== undefined && (!object(value.hooks)
      || Object.values(value.hooks).some(groups => !Array.isArray(groups) || groups.some(group => !object(group)
        || (group.hooks !== undefined && (!Array.isArray(group.hooks) || group.hooks.some(hook => !object(hook))))))))) {
      throw new Error('hooks.json has an unsupported structure; it was left unchanged')
    }
    return { hooks, bridge, document: value as Document }
  }

  #own(hook: Hook): boolean { return hook.type === 'command' && (hook.command === this.#command || hook.command === this.#legacyCommand) }

  #counts(snapshot: Snapshot): { ownHookCount: number, otherHookCount: number, installed: boolean } {
    const all = Object.values(snapshot.document.hooks ?? {}).flatMap(groups => groups.flatMap(group => group.hooks ?? []))
    return {
      ownHookCount: all.filter(hook => this.#own(hook)).length,
      otherHookCount: all.filter(hook => !this.#own(hook) && hook.type === 'command' && typeof hook.command === 'string' && (hook.command.endsWith(marker) || hook.command.endsWith(legacyMarker))).length,
      installed: snapshot.bridge.content === this.#script && ((snapshot.bridge.mode ?? 0) & 0o100) !== 0 && events.every(event => snapshot.document.hooks?.[event]?.some(group => group.hooks?.some(hook => this.#own(hook)))),
    }
  }

  /** Read-only status; a different host's installation never enables this profile. */
  async status(): Promise<{ installed: boolean, ownHookCount: number, otherHookCount: number }> {
    return this.#counts(await this.#snapshot())
  }

  /** Capture both files before presenting consent; no endpoint, script, hook or lock file is created. */
  async review(action: 'install' | 'uninstall'): Promise<CodexActivityHookReview> {
    for (const [id, item] of this.#reviews) {
      if (Date.parse(item.review.expiresAt) <= Date.now())
        this.#reviews.delete(id)
    }
    if (this.#reviews.size >= 8)
      throw new Error('Close an existing activity review before opening another')
    const snapshot = await this.#snapshot()
    const counts = this.#counts(snapshot)
    const review: CodexActivityHookReview = { id: randomUUID(), action, hooksPath: this.hooksPath, bridgePath: this.bridgePath, ownHookCount: counts.ownHookCount, otherHookCount: counts.otherHookCount, expiresAt: new Date(Date.now() + 300_000).toISOString() }
    this.#reviews.set(review.id, { review, snapshot })
    return { ...review }
  }

  /** Consume a cancelled review without mutating user configuration. */
  cancel(id: string): void { this.#reviews.delete(id) }

  /** Release all in-memory approvals when the owning host closes. */
  clearReviews(): void { this.#reviews.clear() }

  /** Apply once after re-reading both files under a kernel-held lock shared by upgraded hosts. */
  async apply(id: string): Promise<'install' | 'uninstall'> {
    const pending = this.#reviews.get(id)
    this.#reviews.delete(id)
    if (!pending || Date.parse(pending.review.expiresAt) <= Date.now())
      throw new Error('Activity review expired; review the current files again')
    if (this.#applying)
      throw new Error('Another activity change is in progress; review again after it finishes')
    this.#applying = true
    let lock: DatabaseSync | undefined
    try {
      await mkdir(dirname(this.hooksPath), { recursive: true, mode: 0o700 })
      // A SQLite write transaction survives neither exit nor crash. The empty database contains no configuration.
      const lockPath = join(dirname(this.hooksPath), '.craft-hub-hooks-lock.sqlite')
      const file = await open(lockPath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)
      try {
        const info = await file.stat()
        if (!info.isFile() || info.nlink !== 1)
          throw new Error('The activity lock must be a regular file')
      }
      finally { await file.close() }
      lock = new DatabaseSync(lockPath)
      lock.exec('BEGIN IMMEDIATE')
      const snapshot = await this.#snapshot()
      if (snapshot.hooks.revision !== pending.snapshot.hooks.revision || snapshot.bridge.revision !== pending.snapshot.bridge.revision)
        throw new Error('Activity files changed since review; review them again')
      const hooks = { ...snapshot.document.hooks }
      for (const [event, groups] of Object.entries(hooks)) {
        const next = groups.map(group => ({ ...group, ...(group.hooks ? { hooks: group.hooks.filter(hook => !this.#own(hook)) } : {}) })).filter(group => !group.hooks || group.hooks.length)
        if (next.length)
          hooks[event] = next
        else
          delete hooks[event]
      }
      if (pending.review.action === 'install') {
        await mkdir(dirname(this.bridgePath), { recursive: true, mode: 0o700 })
        await replace(this.bridgePath, this.#script, 0o700)
        await chmod(this.bridgePath, 0o700)
        for (const event of events)
          hooks[event] = [...(hooks[event] ?? []), { hooks: [{ type: 'command', command: this.#command, timeout: event === 'SessionEnd' ? 3 : 5 }] }]
      }
      // Recheck the hook document immediately before replacement, including non-cooperating editor changes.
      if ((await read(this.hooksPath)).revision !== snapshot.hooks.revision)
        throw new Error('Hook configuration changed during the operation; review again')
      if (pending.review.action === 'install' || pending.review.ownHookCount > 0)
        await replace(this.hooksPath, `${JSON.stringify({ ...snapshot.document, hooks }, null, 2)}\n`, 0o600)
      // Retain the inert bridge on disable: an older Codex process may still have cached its command.
      return pending.review.action
    }
    finally {
      lock?.close()
      this.#applying = false
    }
  }
}

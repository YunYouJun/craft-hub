import { Buffer } from 'node:buffer'

/** Only reviewed Xiaomi Cloud regions may receive the user's cloud session. */
export const cloudOrigins: readonly string[] = ['https://i.mi.com', 'https://us.i.mi.com', 'https://sg.i.mi.com', 'https://de.i.mi.com']

/** Private local connection; never return this object through an integration action. */
export interface CloudSession { origin: string, accountId: string, cookie: string }
/** Metadata obtained from the cloud's full, paginated inventory. */
export interface NoteSummary { id: string, title: string, folderId: string, modifiedAt: number, createdAt: number }
/** A text backup retains original markup and attachment references alongside readable Markdown. */
export interface CloudNote extends NoteSummary { content: string, markdown: string, attachments: Array<{ id: string, mimeType: string }> }
/** One inventory page; the cursor is an opaque string, never a URL. */
export interface CloudNotePage { notes: NoteSummary[], folders: Array<{ id: string, title: string }>, lastPage: boolean, cursor?: string, skipped: number }
/** Injectable read-only transport. No remote mutation is exposed. */
export interface XiaomiCloudTransport {
  page: (session: CloudSession, cursor: string, signal: AbortSignal) => Promise<CloudNotePage>
  note: (session: CloudSession, id: string, signal: AbortSignal) => Promise<CloudNote>
}

/** Display-safe failures intentionally discard provider bodies, URLs and credentials. */
export class XiaomiCloudError extends Error {
  constructor(readonly kind: 'authorization' | 'unavailable' | 'response' | 'throttled' | 'credentials') {
    super({
      authorization: 'Xiaomi Cloud sign-in expired. Reconnect your account.',
      unavailable: 'Xiaomi Cloud is unavailable. Check your connection and retry.',
      response: 'Xiaomi Cloud returned an unsupported response. The previous backup was kept.',
      throttled: 'Xiaomi Cloud is rate limiting requests. Wait before syncing again.',
      credentials: 'The system credential store is unavailable. No plaintext credentials were saved.',
    }[kind])
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new XiaomiCloudError('response')
  return value as Record<string, unknown>
}

function identifier(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[\w.-]{1,200}$/.test(String(value)))
    throw new XiaomiCloudError('response')
  return String(value)
}

/** Accept only the cloud session cookies, discarding account-wide passToken and unrelated cookies. */
export function cloudSession(cookie: unknown, origin: unknown): CloudSession {
  if (typeof cookie !== 'string' || cookie.length > 16384 || [...cookie].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    || typeof origin !== 'string' || !cloudOrigins.includes(origin)) {
    throw new XiaomiCloudError('authorization')
  }
  const fields = new Map<string, string>()
  for (const part of cookie.replace(/^cookie:\s*/i, '').split(';')) {
    const match = /^\s*(userId|serviceToken|i\.mi\.com_serviceToken)=([^;\s]+)\s*$/.exec(part)
    if (match) {
      if (fields.has(match[1]!))
        throw new XiaomiCloudError('authorization')
      fields.set(match[1]!, match[2]!)
    }
  }
  const accountId = fields.get('userId')
  if (!accountId || !/^\d{1,30}$/.test(accountId) || !(fields.get('serviceToken') || fields.get('i.mi.com_serviceToken')))
    throw new XiaomiCloudError('authorization')
  return { accountId, origin, cookie: [...fields].map(([key, value]) => `${key}=${value}`).join('; ') }
}

function extra(entry: Record<string, unknown>): Record<string, unknown> {
  if (entry.extraInfo == null || entry.extraInfo === '')
    return {}
  try {
    return object(typeof entry.extraInfo === 'string' ? JSON.parse(entry.extraInfo) : entry.extraInfo)
  }
  catch { throw new XiaomiCloudError('response') }
}

function summary(entry: Record<string, unknown>): NoteSummary {
  const info = extra(entry)
  const title = info.title || entry.subject || entry.snippet || 'Untitled'
  if (typeof title !== 'string' || typeof entry.modifyDate !== 'number' || !Number.isFinite(entry.modifyDate)
    || typeof entry.createDate !== 'number' || !Number.isFinite(entry.createDate)
    || Math.abs(entry.modifyDate) > 8.64e15 || Math.abs(entry.createDate) > 8.64e15) {
    throw new XiaomiCloudError('response')
  }
  return { id: identifier(entry.id), title: title.split('\n')[0]!.slice(0, 300), folderId: identifier(entry.folderId ?? '0'), modifiedAt: entry.modifyDate, createdAt: entry.createDate }
}

/** Convert common cloud note markup to inert text; original markup remains in the JSON backup. */
export function noteMarkdown(content: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' }
  return content
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '')
    .replace(/<(?:img|sound|video)\b[^>]*>/gi, '[Attachment: see Xiaomi Cloud]')
    .replace(/<input\b[^>]*>/gi, tag => /checked=["']true["']/i.test(tag) ? '- [x] ' : '- [ ] ')
    .replace(/<(?:bullet|order)\b[^>]*\/>/gi, '- ')
    .replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<(?:delete|s)>([\s\S]*?)<\/(?:delete|s)>/gi, '~~$1~~')
    .replace(/<br\s*\/?>|<\/(?:p|div|text|li|quote)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, name: string) => {
      if (!name.startsWith('#'))
        return entities[name.toLowerCase()] ?? whole
      const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
      return code > 0 && code <= 0x10FFFF && !(code >= 0xD800 && code <= 0xDFFF) ? String.fromCodePoint(code) : whole
    })
    // Escaped HTML stays inert even when downloaded Markdown is opened in another renderer.
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Use Xiaomi's private web read endpoints, with bounded responses and no credential-bearing redirects. */
export function createXiaomiCloudTransport(options: { fetch?: typeof fetch, now?: () => number } = {}): XiaomiCloudTransport {
  const request = options.fetch ?? globalThis.fetch
  const now = options.now ?? Date.now
  async function get(session: CloudSession, path: string, params: Record<string, string>, signal: AbortSignal): Promise<Record<string, unknown>> {
    const safe = cloudSession(session.cookie, session.origin)
    const url = new URL(path, safe.origin)
    url.search = new URLSearchParams({ ts: String(now()), ...params }).toString()
    try {
      const response = await request(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        headers: { 'cookie': safe.cookie, 'accept': 'application/json', 'referer': `${safe.origin}/note/h5`, 'user-agent': 'Mozilla/5.0 CraftHub/1.0' },
      })
      if ([401, 403].includes(response.status) || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel()
        throw new XiaomiCloudError('authorization')
      }
      if (response.status === 429) {
        await response.body?.cancel()
        throw new XiaomiCloudError('throttled')
      }
      if (!response.ok) {
        await response.body?.cancel()
        throw new XiaomiCloudError('unavailable')
      }
      // Both the declared size and streamed body are bounded; never buffer an unbounded provider response.
      if (Number(response.headers.get('content-length')) > 8_000_000) {
        await response.body?.cancel()
        throw new XiaomiCloudError('response')
      }
      const reader = response.body?.getReader()
      if (!reader)
        throw new XiaomiCloudError('response')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done)
            break
          size += chunk.value.byteLength
          if (size > 8_000_000)
            throw new XiaomiCloudError('response')
          chunks.push(chunk.value)
        }
      }
      finally { await reader.cancel() }
      let value: Record<string, unknown>
      try {
        value = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      }
      catch { throw new XiaomiCloudError('response') }
      if (value.result !== 'ok' || (value.code !== undefined && value.code !== 0)) {
        if (value.code === 401 || value.code === 403 || /login|登录|登陆|认证|expired|unauthori/i.test(String(value.description ?? '')))
          throw new XiaomiCloudError('authorization')
        throw new XiaomiCloudError('response')
      }
      return object(value.data)
    }
    catch (error) {
      if (error instanceof XiaomiCloudError)
        throw error
      throw new XiaomiCloudError('unavailable')
    }
  }
  return {
    async page(session, cursor, signal) {
      const data = await get(session, '/note/full/page/', { limit: '200', syncTag: cursor }, signal)
      if (!Array.isArray(data.entries) || !Array.isArray(data.folders) || typeof data.lastPage !== 'boolean'
        || (!data.lastPage && (typeof data.syncTag !== 'string' || !data.syncTag || data.syncTag.length > 4096))) {
        throw new XiaomiCloudError('response')
      }
      const notes: NoteSummary[] = []
      let skipped = 0
      for (const raw of data.entries) {
        const entry = object(raw)
        if (entry.type !== 'note' || (entry.status !== undefined && entry.status !== 'normal') || Number(entry.deleteTime) > 0
          || !['', 'note', 'common', 'text'].includes(String(extra(entry).note_content_type ?? ''))) {
          skipped++
          continue
        }
        notes.push(summary(entry))
      }
      const folders = data.folders.map((raw) => {
        const folder = object(raw)
        if (typeof folder.subject !== 'string')
          throw new XiaomiCloudError('response')
        return { id: identifier(folder.id), title: folder.subject.slice(0, 300) }
      })
      return { notes, folders, lastPage: data.lastPage, cursor: typeof data.syncTag === 'string' ? data.syncTag : undefined, skipped }
    },
    async note(session, id, signal) {
      const data = await get(session, `/note/note/${encodeURIComponent(identifier(id))}/`, {}, signal)
      const entry = object(data.entry)
      if (identifier(entry.id) !== id || typeof entry.content !== 'string' || entry.content.length > 2_000_000)
        throw new XiaomiCloudError('response')
      const setting = entry.setting == null ? {} : object(entry.setting)
      const files = setting.data ?? []
      if (!Array.isArray(files))
        throw new XiaomiCloudError('response')
      const attachments = files.map((raw) => {
        const file = object(raw)
        if (typeof file.mimeType !== 'string')
          throw new XiaomiCloudError('response')
        return { id: identifier(file.fileId), mimeType: file.mimeType.slice(0, 200) }
      })
      return { ...summary(entry), content: entry.content, markdown: noteMarkdown(entry.content), attachments }
    },
  }
}

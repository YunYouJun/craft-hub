import type { CraftHubPlugin, IntegrationConnectionStatus, IntegrationProviderContext, ResourcePage } from 'craft-hub'
import type { NoteSnapshot, XiaomiCredentialStore } from './storage'
import type { CloudNote, CloudSession, NoteSummary, XiaomiCloudTransport } from './transport'
import { Buffer } from 'node:buffer'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { getCraftHubDataDir } from 'craft-hub'
import { xiaomiCloudIcon } from './icon'
import { createXiaomiCredentialStore, storageKey, XiaomiSnapshotStore } from './storage'
import { cloudSession, createXiaomiCloudTransport, XiaomiCloudError } from './transport'

export { createXiaomiCredentialStore } from './storage'
export type { NoteSnapshot, XiaomiCredentialStore } from './storage'
export { cloudOrigins, createXiaomiCloudTransport, XiaomiCloudError } from './transport'
export type { CloudNote, CloudNotePage, CloudSession, NoteSummary, XiaomiCloudTransport } from './transport'

/** Local host dependencies, with explicit injection for isolated tests and alternative system vaults. */
export interface XiaomiCloudPluginOptions {
  dataDir?: string
  credentialStore?: XiaomiCredentialStore
  transport?: XiaomiCloudTransport
  now?: () => number
  requestDelayMs?: number
}
/** Embedding hosts must call close on shutdown to cancel and join any active backup job. */
export interface XiaomiCloudPlugin extends CraftHubPlugin { close: () => Promise<void> }

const id = 'xiaomi-cloud'
const copy = (context: IntegrationProviderContext, zh: string, en: string): string => context.locale === 'zh-CN' ? zh : en

function local(context: IntegrationProviderContext): void {
  if (context.hostEnvironment === 'hosted')
    throw new Error('Xiaomi Cloud notes are available only on the local host.')
}

/** Create a local-only notes reader and confirmed, one-way text backup using the private web API. */
export function createXiaomiCloudPlugin(options: XiaomiCloudPluginOptions = {}): XiaomiCloudPlugin {
  const dataDir = options.dataDir ?? getCraftHubDataDir()
  const directory = join(dataDir, 'integrations', id)
  const credentials = options.credentialStore ?? createXiaomiCredentialStore(dataDir)
  const transport = options.transport ?? createXiaomiCloudTransport()
  const snapshots = new XiaomiSnapshotStore(directory)
  const now = options.now ?? Date.now
  const delay = options.requestDelayMs ?? 500
  let session: CloudSession | null | undefined
  let generation = 0
  let closed = false
  let mutations = Promise.resolve()
  let loading: Promise<CloudSession | null> | undefined
  let connectionController: AbortController | undefined
  let job: { running: boolean, completed: number, total: number, error?: string, controller: AbortController, done: Promise<void> } | undefined
  let expired = false

  function current(version: number): void {
    if (closed || version !== generation)
      throw new XiaomiCloudError('authorization')
  }
  async function connection(): Promise<CloudSession | null> {
    const version = generation
    current(version)
    if (session === undefined) {
      loading ??= credentials.read()
      const value = await loading
      current(version)
      session = value ? cloudSession(value.cookie, value.origin) : null
    }
    return session
  }
  async function stop(): Promise<void> {
    job?.controller.abort()
    await job?.done
    job = undefined
  }
  function message(error: unknown, context: IntegrationProviderContext): string {
    const kind = error instanceof XiaomiCloudError ? error.kind : 'unavailable'
    const zh = {
      authorization: '小米云登录已失效，请重新连接账号。',
      unavailable: '暂时无法同步小米云，请检查网络后重试；上次完整备份已保留。',
      response: '小米云返回了不支持的数据格式；上次完整备份已保留。',
      throttled: '小米云暂时限制了请求频率，请稍后重新同步。',
      credentials: '系统凭据库暂不可用，未保存明文登录信息。',
    }
    return copy(context, zh[kind], new XiaomiCloudError(kind).message)
  }
  async function status(context: IntegrationProviderContext): Promise<IntegrationConnectionStatus> {
    if (context.hostEnvironment === 'hosted')
      return { connected: false, message: copy(context, '请在本机 Craft Hub 连接小米云。', 'Connect Xiaomi Cloud from your local Craft Hub.') }
    const saved = await connection()
    const origin = saved?.origin ?? 'https://i.mi.com'
    const connect = {
      id: 'cookie',
      title: copy(context, '连接小米云笔记', 'Connect Xiaomi Cloud notes'),
      submitLabel: copy(context, '保存并验证连接', 'Save and verify connection'),
      browserAuthorization: {
        title: copy(context, '登录并连接小米云', 'Sign in and connect Xiaomi Cloud'),
        url: `${origin}/note/h5`,
        allowedOrigins: [origin, 'https://account.xiaomi.com'],
        cookieOrigin: origin,
        cookieNames: ['userId', 'serviceToken', 'i.mi.com_serviceToken'],
        requiredCookieGroups: [['userId'], ['serviceToken', 'i.mi.com_serviceToken']],
        cookieField: 'cookie',
        originField: 'origin',
      },
      description: copy(context, '在小米云网页版登录后，从笔记请求复制 Cookie。登录信息只保存在本机系统凭据库。', 'Sign in on the Xiaomi Cloud website and copy the Cookie header from a notes request. Credentials stay in the local system vault.'),
      fields: [
        { id: 'origin', type: 'text' as const, label: copy(context, '云服务地址', 'Cloud region URL'), required: true, value: saved?.origin ?? 'https://i.mi.com' },
        { id: 'cookie', type: 'password' as const, label: 'Cookie', required: true },
      ],
    }
    return {
      connected: Boolean(saved) && !expired,
      ...(saved ? { accountLabel: saved.accountId, session: { cacheKey: storageKey(`${saved.origin}\n${saved.accountId}`), cacheReads: false } } : {}),
      message: expired ? message(new XiaomiCloudError('authorization'), context) : copy(context, '只读接入 · 手动同步普通笔记文字；图片、录音、私密笔记、待办和思维导图暂不备份。', 'Read-only · Manually back up standard note text. Images, recordings, private notes, to-dos and mind maps are not backed up.'),
      links: [{ title: copy(context, '打开小米云笔记', 'Open Xiaomi Cloud notes'), url: `${saved?.origin ?? 'https://i.mi.com'}/note/h5` }],
      forms: [connect, ...(saved ? [{ id: 'disconnect', title: copy(context, '断开连接', 'Disconnect'), description: copy(context, '移除本机保存的登录信息，保留已有备份。', 'Remove saved credentials and keep existing backups.'), submitLabel: copy(context, '断开连接', 'Disconnect'), fields: [] }] : [])],
    }
  }
  function updateConnection(context: IntegrationProviderContext, input: Record<string, unknown>): Promise<IntegrationConnectionStatus> {
    local(context)
    if (!context.confirmed)
      return Promise.reject(new Error('Confirm the Xiaomi Cloud connection change.'))
    if (input.method !== 'cookie' && input.method !== 'disconnect')
      return Promise.reject(new Error('Unsupported Xiaomi Cloud connection method.'))
    const candidate = input.method === 'cookie' ? cloudSession(input.cookie, input.origin) : null
    job?.controller.abort()
    const operation = mutations.then(async () => {
      const version = ++generation
      current(version)
      await stop()
      current(version)
      if (candidate) {
        // Validate read access before replacing the working credential. No note content is persisted here.
        const controller = new AbortController()
        connectionController = controller
        try {
          await transport.page(candidate, '', AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]))
        }
        finally {
          if (connectionController === controller)
            connectionController = undefined
        }
        current(version)
        await credentials.save(candidate)
      }
      else {
        await credentials.clear()
      }
      current(version)
      session = candidate
      loading = undefined
      expired = false
      return status(context)
    })
    mutations = operation.then(() => {}, () => {})
    return operation.catch((error) => {
      throw new Error(message(error, context))
    })
  }

  async function sync(saved: CloudSession, version: number, context: IntegrationProviderContext, active: NonNullable<typeof job>): Promise<void> {
    const check = (): void => {
      current(version)
      active.controller.signal.throwIfAborted()
    }
    async function pause(): Promise<void> {
      check()
      if (delay > 0)
        await setTimeout(delay, undefined, { signal: active.controller.signal })
      check()
    }
    try {
      const inventory = new Map<string, NoteSummary>()
      const folders = new Map<string, string>()
      const seen = new Set<string>()
      let cursor = ''
      let skipped = 0
      for (let page = 0; ; page++) {
        if (page >= 1000 || seen.has(cursor))
          throw new XiaomiCloudError('response')
        seen.add(cursor)
        await pause()
        const result = await transport.page(saved, cursor, active.controller.signal)
        check()
        skipped += result.skipped
        for (const folder of result.folders)
          folders.set(folder.id, folder.title)
        for (const note of result.notes) {
          if (inventory.has(note.id))
            throw new XiaomiCloudError('response')
          inventory.set(note.id, { id: note.id, title: note.title, folderId: note.folderId, modifiedAt: note.modifiedAt, createdAt: note.createdAt })
        }
        if (inventory.size > 10000)
          throw new XiaomiCloudError('response')
        active.total = inventory.size
        if (result.lastPage)
          break
        if (!result.cursor)
          throw new XiaomiCloudError('response')
        cursor = result.cursor
      }
      const previous = await snapshots.read(saved)
      check()
      const existing = new Map(previous?.snapshot.notes.map(note => [note.id, note]))
      const notes: CloudNote[] = []
      let bytes = 0
      for (const entry of inventory.values()) {
        let note = existing.get(entry.id)
        if (!note || note.modifiedAt !== entry.modifiedAt || note.createdAt !== entry.createdAt) {
          await pause()
          note = await transport.note(saved, entry.id, active.controller.signal)
          check()
          if (note.id !== entry.id || note.modifiedAt !== entry.modifiedAt)
            throw new XiaomiCloudError('response')
        }
        bytes += Buffer.byteLength(note.content) + Buffer.byteLength(note.markdown)
        if (bytes > 64_000_000)
          throw new XiaomiCloudError('response')
        notes.push({ ...note, ...entry })
        active.completed++
      }
      const snapshot: NoteSnapshot = { version: 1, accountId: saved.accountId, origin: saved.origin, syncedAt: new Date(now()).toISOString(), skipped, folders: [...folders].map(([id, title]) => ({ id, title })), notes }
      check()
      await snapshots.publish(snapshot, check)
      check()
      expired = false
    }
    catch (error) {
      if (!active.controller.signal.aborted && version === generation) {
        active.error = message(error, context)
        expired = error instanceof XiaomiCloudError && error.kind === 'authorization'
      }
    }
    finally { active.running = false }
  }

  async function read(context: IntegrationProviderContext, input: Record<string, unknown>): Promise<ResourcePage> {
    local(context)
    const version = generation
    const saved = await connection()
    const account = saved ? storageKey(`${saved.origin}\n${saved.accountId}`) : ''
    if (input.account !== undefined && input.account !== account)
      throw new Error('The Xiaomi Cloud account changed. Return to the notes page.')
    const cached = saved ? await snapshots.read(saved) : null
    current(version)
    const snapshot = cached?.snapshot
    const query = typeof input.query === 'string' ? input.query.slice(0, 300) : ''
    const folder = typeof input.folder === 'string' ? input.folder : ''
    const offset = typeof input.offset === 'number' && Number.isSafeInteger(input.offset) && input.offset >= 0 ? input.offset : 0
    const filtered = (snapshot?.notes ?? []).filter(note => (!folder || note.folderId === folder) && (!query || `${note.title}\n${note.markdown}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())))
    const selected = typeof input.noteId === 'string' ? snapshot?.notes.find(note => note.id === input.noteId) : undefined
    if (input.noteId !== undefined && !selected)
      throw new Error('This note is absent from the latest completed backup.')
    const formInput = { account }
    const running = job?.running
    return {
      kind: 'resource-page',
      title: copy(context, '小米云笔记', 'Xiaomi Cloud notes'),
      input: { account, query, folder, offset, ...(selected ? { noteId: selected.id } : {}) },
      description: [
        snapshot ? copy(context, `上次同步：${snapshot.syncedAt} · ${snapshot.notes.length} 条笔记 · 跳过 ${snapshot.skipped} 条不支持的记录。`, `Last sync: ${snapshot.syncedAt} · ${snapshot.notes.length} notes · ${snapshot.skipped} unsupported records skipped.`) : copy(context, '连接账号后，点击「同步笔记到本机」创建第一份文字备份。', 'Connect your account, then choose Sync notes to this device to create a text backup.'),
        running ? copy(context, `正在同步 ${job!.completed}/${job!.total}…`, `Syncing ${job!.completed}/${job!.total}…`) : job?.error ?? '',
        cached ? copy(context, `本地备份：${cached.directory}`, `Local backup: ${cached.directory}`) : '',
        copy(context, '图片和录音仅保留引用，附件文件暂不下载。', 'Only references to images and recordings are retained; attachment files are not downloaded.'),
      ].filter(Boolean).join('\n'),
      ...(running ? { refreshAfterMs: 1500 } : {}),
      ...(!selected ? { entities: filtered.slice(offset, offset + 100).map(note => ({ id: note.id, title: note.title, description: snapshot?.folders.find(folder => folder.id === note.folderId)?.title ?? copy(context, '未分类', 'Unfiled'), updatedAt: new Date(note.modifiedAt).toISOString() })) } : {}),
      links: [
        ...(selected ? [{ title: copy(context, '返回笔记列表', 'Back to notes'), input: { ...formInput, query, folder, offset } }] : filtered.slice(offset, offset + 100).map(note => ({ title: note.title, entityId: note.id, input: { ...formInput, query, folder, offset, noteId: note.id } }))),
        ...(!selected && offset > 0 ? [{ title: copy(context, '上一页', 'Previous'), input: { ...formInput, query, folder, offset: Math.max(0, offset - 100) } }] : []),
        ...(!selected && offset + 100 < filtered.length ? [{ title: copy(context, '下一页', 'Next'), input: { ...formInput, query, folder, offset: offset + 100 } }] : []),
      ],
      ...(selected ? { documents: [{ id: 'note', title: selected.title, filename: `${storageKey(selected.id)}.md`, content: `# ${selected.title.replace(/[\r\n<>]/g, ' ')}\n\n${selected.markdown}\n` }, { id: 'source', title: copy(context, '原始笔记数据', 'Original note data'), filename: `${storageKey(selected.id)}.json`, content: JSON.stringify(selected, null, 2) }] } : {}),
      forms: [
        ...(saved && !running ? [{ id: 'sync', title: copy(context, '同步笔记到本机', 'Sync notes to this device'), description: copy(context, '读取云端普通笔记文字并保存新的本地备份；不修改云端，保留历史备份。', 'Read standard cloud note text and save a new local backup. Cloud data and earlier backups are preserved.'), effect: 'update' as const, input: { ...formInput, operation: 'sync' }, fields: [] }] : []),
        { id: 'filter', title: copy(context, '搜索与筛选', 'Search and filter'), effect: 'read', input: { ...formInput }, fields: [{ id: 'query', type: 'text', label: copy(context, '搜索文字', 'Search text'), value: query }, { id: 'folder', type: 'select', label: copy(context, '文件夹', 'Folder'), value: folder, options: [{ label: copy(context, '全部文件夹', 'All folders'), value: '' }, ...(snapshot?.folders ?? []).map(folder => ({ label: folder.title, value: folder.id }))] }] },
      ],
    }
  }
  async function update(context: IntegrationProviderContext, input: Record<string, unknown>): Promise<ResourcePage> {
    local(context)
    if (!context.confirmed)
      throw new Error('Confirm the local Xiaomi Cloud backup.')
    if (input.operation !== 'sync')
      throw new Error('Unsupported Xiaomi Cloud backup operation.')
    const version = generation
    const saved = await connection()
    if (!saved)
      throw new XiaomiCloudError('authorization')
    if (input.account !== storageKey(`${saved.origin}\n${saved.accountId}`))
      throw new Error('The Xiaomi Cloud account changed. Reload and review the backup.')
    current(version)
    if (!job?.running) {
      const active = { running: true, total: 0, completed: 0, controller: new AbortController(), done: Promise.resolve() }
      job = active
      active.done = sync(saved, version, context, active)
    }
    return read(context, {})
  }
  return {
    id: '@craft-hub/craft-hub-plugin-xiaomi-cloud',
    name: 'Xiaomi Cloud',
    version: '0.1.0',
    async close() {
      closed = true
      generation++
      connectionController?.abort()
      await stop()
      await mutations
      session = null
      loading = undefined
    },
    integrationProviders: [{ id, apiVersion: '1.0.0', connectionStatus: status, connection: { update: updateConnection }, resources: { read, update, async execute() { throw new Error('Xiaomi Cloud remote writes are not supported.') } } }],
    integrations: [{
      id,
      provider: { id, requires: '^1.0.0' },
      actions: [
        { id: 'connection', title: 'Connection', operation: 'connection.status', effect: 'remote-read', confirmation: 'never' },
        { id: 'connect', title: 'Connect account', operation: 'connection.update', effect: 'local-write', confirmation: 'always' },
        { id: 'notes', title: 'Notes', operation: 'resources.read', effect: 'remote-read', confirmation: 'never' },
        { id: 'sync', title: 'Sync notes to this device', operation: 'resources.update', effect: 'local-write', confirmation: 'always' },
      ],
      views: [{ id: 'notes', title: 'Xiaomi Cloud', icon: xiaomiCloudIcon, placement: 'primary-sidebar', scope: 'global', rendering: 'web', blocks: [{ id: 'connection', type: 'connection-status', actionId: 'connection' }, { id: 'notes', type: 'resource-browser', actionId: 'notes' }] }],
      translations: { 'zh-CN': { 'Xiaomi Cloud': '小米云', 'Connection': '账号连接', 'Connect account': '连接账号', 'Notes': '笔记', 'Sync notes to this device': '同步笔记到本机' } },
    }],
  }
}

export default createXiaomiCloudPlugin()

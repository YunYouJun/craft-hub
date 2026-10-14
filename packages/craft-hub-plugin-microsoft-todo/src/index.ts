import type { CraftHubPlugin, IntegrationConnectionStatus, IntegrationEntity, IntegrationEntityPage, IntegrationProviderContext } from 'craft-hub'
import type { MicrosoftTodoTransport } from './transport'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getCraftHubDataDir } from 'craft-hub'
import { createCapturedTodo, todoCapture } from './capture'
import { microsoftTodoIcon } from './icon'
import { createMicrosoftTodoTransport, MicrosoftTodoError } from './transport'

export { createMicrosoftTodoTransport } from './transport'

interface ConnectionSettings { enabled: boolean, account?: string, writeEnabled?: boolean }
interface TodoList { id: string, displayName: string, isOwner: boolean, isShared: boolean }
interface TodoTask { id: string, title: string, status: string, importance?: string, lastModifiedDateTime?: string, dueDateTime?: { dateTime: string, timeZone: string }, isReminderOn?: boolean, reminderDateTime?: { dateTime: string, timeZone: string } }

/** Injectable transport and local preference path for standalone hosts and offline tests. */
export interface MicrosoftTodoPluginOptions { transport?: MicrosoftTodoTransport, writeTransport?: MicrosoftTodoTransport, statePath?: string, now?: () => number }

const providerId = 'microsoft-todo'
const webUrl = 'https://to-do.office.com/tasks/'
const copy = (context: IntegrationProviderContext, zh: string, en: string): string => context.locale === 'zh-CN' ? zh : en

/** Create a read-first To Do adapter with separately authorized capture; authentication caches stay owned by the local connector. */
export function createMicrosoftTodoPlugin(options: MicrosoftTodoPluginOptions = {}): CraftHubPlugin {
  const transport = options.transport ?? createMicrosoftTodoTransport()
  const writeTransport = options.writeTransport ?? createMicrosoftTodoTransport({ writable: true })
  const statePath = options.statePath ?? join(getCraftHubDataDir(), 'integrations', providerId, 'connection.json')
  const now = options.now ?? Date.now
  let settings: ConnectionSettings | undefined
  let loading: Promise<ConnectionSettings> | undefined
  let saving = Promise.resolve()
  let pending: IntegrationConnectionStatus['deviceAuthorization']
  let generation = 0
  const readings = new Map<string, Promise<IntegrationEntityPage>>()

  function requireGeneration(version: number): void {
    if (version !== generation)
      throw new MicrosoftTodoError('authorization')
  }

  async function preferences(): Promise<ConnectionSettings> {
    if (!settings) {
      loading ??= (async () => {
        try {
          const saved = JSON.parse(await readFile(statePath, 'utf8')) as ConnectionSettings
          return { ...(saved.writeEnabled === true ? { writeEnabled: true } : {}), enabled: saved.enabled === true, account: typeof saved.account === 'string' ? saved.account : undefined }
        }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw new Error('Microsoft To Do connection preferences could not be read.')
          return { enabled: false }
        }
      })()
      const loaded = await loading
      if (!settings)
        settings = loaded
    }
    return settings
  }

  function save(value: ConnectionSettings): Promise<void> {
    const operation = saving.then(async () => {
      await mkdir(dirname(statePath), { recursive: true, mode: 0o700 })
      const temporary = `${statePath}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
      await rename(temporary, statePath)
      settings = value
    })
    saving = operation.catch(() => {})
    return operation
  }

  async function account(): Promise<{ email: string, name?: string } | undefined> {
    const version = generation
    const saved = await preferences()
    requireGeneration(version)
    const result = await transport.call('list-accounts')
    requireGeneration(version)
    const accounts = result.accounts as Array<{ email: string, name?: string, isDefault?: boolean }>
    if (!Array.isArray(accounts) || accounts.some(item => !item || typeof item.email !== 'string'))
      throw new MicrosoftTodoError('response')
    if (saved.account)
      return accounts.find(item => item.email.toLowerCase() === saved.account!.toLowerCase())
    const selected = accounts.find(item => item.isDefault) ?? (accounts.length === 1 ? accounts[0] : undefined)
    if (selected)
      await save({ ...saved, account: selected.email })
    requireGeneration(version)
    return selected
  }

  async function canCreate(email: string): Promise<boolean> {
    if (!(await preferences()).writeEnabled)
      return false
    try {
      await writeTransport.call('list-todo-task-lists', { account: email, top: 1 })
      return true
    }
    catch { return false }
  }

  async function status(context: IntegrationProviderContext): Promise<IntegrationConnectionStatus> {
    if (context.hostEnvironment === 'hosted')
      return { connected: false, message: copy(context, '请在本机 Craft Hub 连接 Microsoft To Do。', 'Connect Microsoft To Do from your local Craft Hub.') }
    const version = generation
    const saved = await preferences()
    const base: IntegrationConnectionStatus = {
      connected: false,
      accountLabel: saved.account,
      message: copy(context, '连接微软账号后读取你的列表和未完成待办。', 'Connect your Microsoft account to read lists and unfinished tasks.'),
      links: [{ title: copy(context, '打开 Microsoft To Do', 'Open Microsoft To Do'), url: webUrl }],
      forms: [{ id: 'device-code', title: copy(context, '连接 Microsoft To Do', 'Connect Microsoft To Do'), submitLabel: copy(context, '连接账号', 'Connect account'), fields: [{ id: 'account', type: 'text', label: copy(context, '微软账号（可选）', 'Microsoft account (optional)'), value: saved.account ?? '' }] }],
    }
    if (!saved.enabled)
      return base
    if (pending && Date.parse(pending.expiresAt) <= now())
      pending = undefined
    try {
      const selected = await account()
      if (selected) {
        // Probe the permission actually used by To Do, never the unrelated /me profile API.
        const result = await transport.call('list-todo-task-lists', { account: selected.email, top: 1 })
        if (!Array.isArray(result.value))
          throw new MicrosoftTodoError('response')
        const writable = await canCreate(selected.email)
        requireGeneration(version)
        if (writable || !saved.writeEnabled)
          pending = undefined
        return { ...base, connected: true, capabilities: { create: writable }, ...(pending ? { deviceAuthorization: pending } : {}), accountLabel: selected.email, message: writable ? copy(context, '已连接 · 可读取和新增待办。', 'Connected · Read and create tasks.') : copy(context, '已连接 · 只读；快速记录需要新增待办权限。', 'Connected · Read-only; enable task creation to capture.'), forms: [...(writable ? [] : [{ id: 'enable-write', title: copy(context, '启用快速记录', 'Enable quick capture'), description: copy(context, '授权 Microsoft To Do 新增待办权限（Tasks.ReadWrite）。', 'Grant task creation permission (Tasks.ReadWrite).'), submitLabel: copy(context, '授权新增待办', 'Authorize task creation'), fields: [] }]), { id: 'disconnect', title: copy(context, '断开 Craft Hub 连接', 'Disconnect Craft Hub'), description: copy(context, '保留本机其他应用的微软登录。', 'Keep the Microsoft login used by other local applications.'), submitLabel: copy(context, '断开连接', 'Disconnect'), fields: [] }] }
      }
    }
    catch (error) {
      if (!(error instanceof MicrosoftTodoError) || error.kind !== 'authorization')
        throw error
      base.message = copy(context, '微软授权已失效或缺少读取权限，请重新连接账号。', 'Microsoft authorization expired or lacks read permission. Reconnect your account.')
    }
    return { ...base, ...(pending ? { deviceAuthorization: pending, message: copy(context, '在微软授权页面输入登录码，完成后状态会自动更新。', 'Enter the code on the Microsoft authorization page. The status updates automatically.') } : {}) }
  }

  async function connect(context: IntegrationProviderContext, input: Record<string, unknown>): Promise<IntegrationConnectionStatus> {
    if (context.hostEnvironment === 'hosted' || !context.confirmed)
      throw new Error('Confirm the Microsoft To Do connection on the local host.')
    if (input.method === 'disconnect') {
      generation++
      pending = undefined
      readings.clear()
      await save({ enabled: false })
      await Promise.all([transport.close(), writeTransport.close()])
      return status(context)
    }
    if (input.method !== 'device-code' && input.method !== 'enable-write')
      throw new Error('Unsupported Microsoft To Do connection method.')
    if (pending && Date.parse(pending.expiresAt) > now())
      return status(context)
    generation++
    readings.clear()
    const version = generation
    const enablingWrite = input.method === 'enable-write'
    const previous = await preferences()
    requireGeneration(version)
    const requestedAccount = typeof input.account === 'string' ? input.account.trim() : ''
    await save({ ...previous, enabled: true, ...(enablingWrite ? { writeEnabled: true } : {}), ...(requestedAccount ? { account: requestedAccount } : {}) })
    requireGeneration(version)
    const current = await status(context)
    requireGeneration(version)
    if (current.connected && (!enablingWrite || current.capabilities?.create))
      return current
    const response = await (enablingWrite ? writeTransport : transport).call('login', { force: true })
    requireGeneration(version)
    if (response.error !== 'device_code_required')
      return status(context)
    const message = typeof response.message === 'string' ? response.message : ''
    const userCode = /enter the code ([A-Z0-9-]{4,32})\b/i.exec(message)?.[1]
    const verificationUrl = /https:\/\/(?:www\.)?microsoft\.com\/(?:link|devicelogin)\b/.exec(message)?.[0]
    if (!userCode || !verificationUrl)
      throw new MicrosoftTodoError('response')
    pending = { userCode, verificationUrl, expiresAt: new Date(now() + 15 * 60_000).toISOString() }
    return { ...current, deviceAuthorization: pending }
  }

  async function pages<T>(tool: 'list-todo-task-lists' | 'list-todo-tasks', accountId: string, version: number, listId?: string): Promise<T[]> {
    const values: T[] = []
    const seen = new Set<number>()
    let skip = 0
    for (let page = 0; page < 1000; page++) {
      requireGeneration(version)
      if (seen.has(skip))
        throw new MicrosoftTodoError('response')
      seen.add(skip)
      const result = await transport.call(tool, { account: accountId, top: 50, ...(skip ? { skip } : {}), ...(listId ? { todoTaskListId: listId, filter: 'status ne \'completed\'' } : {}) })
      if (!Array.isArray(result.value))
        throw new MicrosoftTodoError('response')
      values.push(...result.value as T[])
      if (!result['@odata.nextLink'])
        return values
      // The pinned connector accepts skip, not arbitrary URLs. Reject unfamiliar cursors instead of truncating.
      const next = new URL(String(result['@odata.nextLink']))
      const expectedPath = `/v1.0/me/todo/lists${listId ? `/${listId}/tasks` : ''}`
      if (next.origin !== 'https://graph.microsoft.com' || decodeURIComponent(next.pathname) !== expectedPath || next.username || next.password)
        throw new MicrosoftTodoError('response')
      const value = next.searchParams.get('$skip')
      if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
        throw new MicrosoftTodoError('response')
      skip = Number(value)
    }
    throw new MicrosoftTodoError('response')
  }

  async function read(context: IntegrationProviderContext): Promise<IntegrationEntityPage> {
    const version = generation
    if (context.hostEnvironment === 'hosted' || !(await preferences()).enabled)
      throw new MicrosoftTodoError('authorization')
    requireGeneration(version)
    const selected = await account()
    if (!selected)
      throw new MicrosoftTodoError('authorization')
    const lists = (await pages<TodoList>('list-todo-task-lists', selected.email, version)).filter(list => list.isOwner === true && list.isShared === false)
    if (lists.some(list => typeof list.id !== 'string' || !list.id || typeof list.displayName !== 'string'))
      throw new MicrosoftTodoError('response')
    const groups: IntegrationEntity[][] = Array.from({ length: lists.length }, () => [])
    let index = 0
    await Promise.all(Array.from({ length: Math.min(4, lists.length) }, async () => {
      while (index < lists.length) {
        const currentIndex = index++
        const list = lists[currentIndex]!
        const tasks = await pages<TodoTask>('list-todo-tasks', selected.email, version, list.id)
        groups[currentIndex] = tasks.filter(task => task.status !== 'completed').map((task) => {
          if (!task.id || typeof task.title !== 'string')
            throw new MicrosoftTodoError('response')
          const states: Record<string, [string, string]> = { notStarted: ['未开始', 'Not started'], inProgress: ['进行中', 'In progress'], waitingOnOthers: ['等待他人', 'Waiting on others'], deferred: ['暂缓', 'Deferred'] }
          const labels = states[task.status]
          return {
            id: task.id,
            title: task.title,
            sourceRef: { providerId, instanceId: context.integrationId ?? providerId, accountId: selected.email, containerId: list.id, kind: 'task', itemId: task.id },
            personalMembership: { accountId: selected.email, relation: 'owned' },
            status: task.status,
            statusCategory: task.status === 'inProgress' ? 'active' : 'open',
            statusLabel: labels ? copy(context, labels[0], labels[1]) : task.status,
            important: task.importance === 'high',
            metadata: { listTitle: list.displayName },
            description: list.displayName,
            url: webUrl,
            ...(task.dueDateTime ? { dueDate: { ...task.dueDateTime, precision: 'date' as const } } : {}),
            ...(task.isReminderOn === true && task.reminderDateTime ? { reminderDate: { ...task.reminderDateTime, precision: 'datetime' as const } } : {}),
            ...(task.lastModifiedDateTime ? { updatedAt: task.lastModifiedDateTime } : {}),
            ...(task.importance === 'high' ? { priority: { label: copy(context, '重要', 'Important'), tone: 'warning' as const } } : {}),
          }
        })
      }
    }))
    requireGeneration(version)
    return { currentUser: { id: selected.email, label: selected.email }, collections: lists.map(list => ({ id: list.id, title: list.displayName })), items: groups.flat(), coverage: 'complete', fetchedAt: new Date(now()).toISOString() }
  }

  async function create(context: IntegrationProviderContext, input: Record<string, unknown>): Promise<IntegrationEntity> {
    if (context.hostEnvironment === 'hosted' || !context.confirmed)
      throw new Error('Confirm task creation on the local host.')
    const version = generation
    const saved = await preferences()
    requireGeneration(version)
    if (!saved.enabled || !saved.writeEnabled)
      throw new MicrosoftTodoError('authorization')
    const draft = todoCapture(input)
    const selected = await account()
    if (!selected || selected.email !== draft.accountId)
      throw new Error('The Microsoft account changed. Reload and review your task.')
    const lists = await pages<TodoList>('list-todo-task-lists', selected.email, version)
    const target = lists.find(list => list.id === draft.listId && list.isOwner && !list.isShared)
    if (!target)
      throw new Error('Select an owned, private Microsoft To Do list.')
    return createCapturedTodo(join(dirname(statePath), 'captures'), draft, async () => {
      requireGeneration(version)
      const result = await writeTransport.call('create-todo-task', {
        account: selected.email,
        todoTaskListId: target.id,
        confirm: true,
        body: { title: draft.title, importance: draft.important ? 'high' : 'normal', ...(draft.notes ? { body: { contentType: 'text', content: draft.notes } } : {}), ...(draft.dueDate ? { dueDateTime: { dateTime: `${draft.dueDate}T00:00:00`, timeZone: 'UTC' } } : {}), ...(draft.reminderAt ? { isReminderOn: true, reminderDateTime: { dateTime: draft.reminderAt.replace('Z', ''), timeZone: 'UTC' } } : {}) },
      })
      if (typeof result.id !== 'string')
        throw new MicrosoftTodoError('response')
      return { id: result.id, title: draft.title, url: webUrl, status: 'notStarted', statusCategory: 'open', important: draft.important, sourceRef: { providerId, instanceId: context.integrationId ?? providerId, accountId: selected.email, containerId: target.id, kind: 'task', itemId: result.id }, personalMembership: { accountId: selected.email, relation: 'owned' }, ...(draft.dueDate ? { dueDate: { dateTime: `${draft.dueDate}T00:00:00`, timeZone: 'UTC', precision: 'date' } } : {}), ...(draft.reminderAt ? { reminderDate: { dateTime: draft.reminderAt.replace('Z', ''), timeZone: 'UTC', precision: 'datetime' } } : {}) }
    })
  }

  const list = (context: IntegrationProviderContext): Promise<IntegrationEntityPage> => {
    if (context.hostEnvironment === 'hosted')
      return Promise.reject(new MicrosoftTodoError('authorization'))
    const key = JSON.stringify([context.integrationId, context.locale])
    let reading = readings.get(key)
    if (!reading) {
      const request = read(context).finally(() => {
        if (readings.get(key) === request)
          readings.delete(key)
      })
      reading = request
      readings.set(key, request)
    }
    return reading
  }
  return {
    id: '@craft-hub/craft-hub-plugin-microsoft-todo',
    name: 'Microsoft To Do',
    version: '0.1.0',
    integrationProviders: [{ id: providerId, apiVersion: '1.0.0', connectionStatus: status, connection: { update: connect }, workItems: { list, search: list, create } }],
    integrations: [{
      id: providerId,
      provider: { id: providerId, requires: '^1.0.0' },
      actions: [
        { id: 'create', title: 'Create task', operation: 'work-items.create', effect: 'remote-write', confirmation: 'always' },
        { id: 'connection', title: 'Connection', operation: 'connection.status', effect: 'remote-read', confirmation: 'never' },
        { id: 'connect', title: 'Connect account', operation: 'connection.update', effect: 'local-write', confirmation: 'always' },
        { id: 'tasks', title: 'Unfinished tasks', operation: 'work-items.list', effect: 'remote-read', confirmation: 'never' },
      ],
      views: [{ id: 'tasks', title: 'Microsoft To Do', icon: microsoftTodoIcon, placement: 'primary-sidebar', scope: 'global', blocks: [{ id: 'connection', type: 'connection-status', actionId: 'connection' }, { id: 'tasks', title: 'Unfinished tasks', type: 'entity-list', actionId: 'tasks', statusFilter: 'active' }] }],
      translations: { 'zh-CN': { 'Connection': '账号连接', 'Connect account': '连接账号', 'Unfinished tasks': '未完成待办', 'Microsoft To Do authorization is required.': '请先授权 Microsoft To Do。', 'Microsoft To Do is unavailable. Check your connection and refresh.': '暂时无法连接 Microsoft To Do，请检查网络并刷新。', 'Microsoft To Do returned an invalid response.': 'Microsoft To Do 返回的数据不完整，请刷新重试。', 'Microsoft To Do could not start. Check any system credential-access prompts, then retry.': '微软连接未能启动，请先处理系统的凭据访问提示（macOS 钥匙串），然后重试。' } },
    }],
  }
}

export default createMicrosoftTodoPlugin()

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IntegrationRegistry } from '../../craft-hub/src/integrations'
import { createMicrosoftTodoPlugin } from '../src/index'
import { MicrosoftTodoError } from '../src/transport'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
const context = { integrationId: 'microsoft-todo', confirmed: true, locale: 'en' as const }

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'craft-hub-todo-test-'))
  directories.push(directory)
  const call = vi.fn(async (name: string, _input: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    if (name === 'list-accounts')
      return { accounts: [{ email: 'reader@example.com', isDefault: true }] }
    return { value: [] }
  })
  const close = vi.fn(async () => {})
  const statePath = join(directory, 'connection.json')
  const plugin = createMicrosoftTodoPlugin({ transport: { call, close }, statePath })
  const provider = plugin.integrationProviders![0]!
  return { plugin, provider, call, close, statePath }
}

describe('microsoft To Do host adapter', () => {
  it('discovers a global read-only source and requires confirmation before connecting', async () => {
    const { plugin, provider, call, statePath } = await setup()
    expect(await provider.connectionStatus(context)).toMatchObject({ connected: false })
    expect(call).not.toHaveBeenCalled()
    const registry = new IntegrationRegistry(plugin.integrationProviders)
    const declaration = { ...plugin.integrations![0]!, pluginId: plugin.id, source: 'host:test' }
    const resolved = registry.resolve([declaration])
    expect(resolved.diagnostics).toEqual([])
    expect(resolved.integrations[0]?.views[0]).toMatchObject({ scope: 'global' })
    expect(resolved.integrations[0]?.actions.find(action => action.id === 'tasks')).toMatchObject({ effect: 'remote-read', effectiveConfirmation: 'never' })
    await expect(provider.connection!.update({ ...context, confirmed: false }, { method: 'device-code' })).rejects.toThrow(/Confirm/)
    expect(call).not.toHaveBeenCalled()
    expect(await provider.connection!.update(context, { method: 'device-code' })).toMatchObject({ connected: true, accountLabel: 'reader@example.com' })
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({ enabled: true, account: 'reader@example.com' })
    expect(call.mock.calls.every(([name]) => ['list-accounts', 'list-todo-task-lists'].includes(name))).toBe(true)
  })

  it('reads every list and task page, retains empty lists and separates equal task IDs by list', async () => {
    const { provider, call } = await setup()
    await provider.connection!.update(context, { method: 'device-code' })
    call.mockImplementation(async (name, input = {}) => {
      if (name === 'list-accounts')
        return { accounts: [{ email: 'reader@example.com', isDefault: true }] }
      expect(input.account).toBe('reader@example.com')
      if (name === 'list-todo-task-lists') {
        return input.skip
          ? { value: [{ id: 'empty', displayName: 'Empty', isOwner: true, isShared: false }] }
          : { 'value': [{ id: 'one', displayName: 'One', isOwner: true, isShared: false }, { id: 'two', displayName: 'Two', isOwner: true, isShared: false }, { id: 'shared', displayName: 'Shared', isOwner: true, isShared: true }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/todo/lists?$skip=3&$top=50' }
      }
      expect(input.filter).toBe('status ne \'completed\'')
      if (input.todoTaskListId === 'empty')
        return { value: [] }
      if (input.todoTaskListId === 'one' && !input.skip)
        return { 'value': [{ id: 'same', title: 'First task', status: 'notStarted', dueDateTime: { dateTime: '2026-10-13T16:00:00.0000000', timeZone: 'UTC' } }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/todo/lists/one/tasks?$skip=1' }
      if (input.skip)
        return { value: [{ id: 'next', title: 'Next page', status: 'inProgress' }, { id: 'done', title: 'Completed', status: 'completed' }] }
      return { value: [{ id: 'same', title: 'Other list', status: 'deferred', importance: 'high' }] }
    })
    const page = await provider.workItems!.list(context, {})
    expect(page).toMatchObject({ coverage: 'complete', currentUser: { id: 'reader@example.com' }, collections: [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }, { id: 'empty', title: 'Empty' }] })
    expect(page.items.map(item => item.title)).toEqual(['First task', 'Next page', 'Other list'])
    expect(page.items[0]).toMatchObject({ important: false, sourceRef: { accountId: 'reader@example.com', containerId: 'one', kind: 'task', itemId: 'same' }, personalMembership: { relation: 'owned' }, dueDate: { timeZone: 'UTC', precision: 'date' } })
    expect(page.items[2]).toMatchObject({ sourceRef: { containerId: 'two', itemId: 'same' }, important: true, priority: { label: 'Important' } })
    expect(call.mock.calls.some(([, input]) => input?.todoTaskListId === 'shared')).toBe(false)
  })

  it('rejects cross-origin and repeated pagination instead of reporting incomplete results as complete', async () => {
    const { provider, call } = await setup()
    await provider.connection!.update(context, { method: 'device-code' })
    for (const link of ['https://example.com/steal?$skip=50', 'https://graph.microsoft.com/v1.0/me/todo/lists?$skip=0']) {
      call.mockImplementation(async name => name === 'list-accounts' ? { accounts: [{ email: 'reader@example.com' }] } : { 'value': [], '@odata.nextLink': link })
      await expect(provider.workItems!.list(context, {})).rejects.toThrow(/invalid response/)
    }
  })

  it('retains only enabled reminders on unfinished owned private tasks, including reminder-only tasks', async () => {
    const { provider, call } = await setup()
    await provider.connection!.update(context, { method: 'device-code' })
    const reminderDateTime = { dateTime: '2026-10-15T09:00:00.0000000', timeZone: 'Pacific Standard Time' }
    call.mockImplementation(async (name, input = {}) => {
      if (name === 'list-accounts')
        return { accounts: [{ email: 'reader@example.com', isDefault: true }] }
      if (name === 'list-todo-task-lists')
        return { value: [{ id: 'owned', displayName: 'Owned', isOwner: true, isShared: false }, { id: 'unowned', displayName: 'Unowned', isOwner: false, isShared: false }, { id: 'shared', displayName: 'Shared', isOwner: true, isShared: true }] }
      expect(input.todoTaskListId).toBe('owned')
      return { value: [
        { id: 'reminder-only', title: 'Reminder only', status: 'notStarted', isReminderOn: true, reminderDateTime },
        { id: 'disabled', title: 'Disabled reminder', status: 'notStarted', isReminderOn: false, reminderDateTime },
        { id: 'unspecified', title: 'Unspecified reminder', status: 'inProgress', reminderDateTime },
        { id: 'missing-date', title: 'Missing reminder date', status: 'deferred', isReminderOn: true },
        { id: 'done', title: 'Completed reminder', status: 'completed', isReminderOn: true, reminderDateTime },
      ] }
    })
    const page = await provider.workItems!.list(context, {})
    expect(page.items.map(item => item.id)).toEqual(['reminder-only', 'disabled', 'unspecified', 'missing-date'])
    expect(page.items[0]).toMatchObject({ reminderDate: { ...reminderDateTime, precision: 'datetime' }, sourceRef: { accountId: 'reader@example.com', containerId: 'owned' }, personalMembership: { relation: 'owned' } })
    expect(page.items[0]).not.toHaveProperty('dueDate')
    for (const item of page.items.slice(1))
      expect(item).not.toHaveProperty('reminderDate')
    expect(page.collections).toEqual([{ id: 'owned', title: 'Owned' }])
  })

  it('offers a device code on expired authorization, reconnects, and disconnects only Craft Hub', async () => {
    const { provider, call, close, statePath } = await setup()
    let authorized = false
    call.mockImplementation(async (name) => {
      if (name === 'list-accounts')
        return { accounts: [{ email: 'reader@example.com', isDefault: true }] }
      if (name === 'login')
        return { error: 'device_code_required', message: 'Open https://www.microsoft.com/link and enter the code ABCD1234 to authenticate.' }
      if (!authorized)
        throw new MicrosoftTodoError('authorization')
      return { value: [] }
    })
    const pending = await provider.connection!.update(context, { method: 'device-code' })
    expect(pending).toMatchObject({ connected: false, deviceAuthorization: { userCode: 'ABCD1234', verificationUrl: 'https://www.microsoft.com/link' } })
    expect(await readFile(statePath, 'utf8')).not.toContain('ABCD1234')
    authorized = true
    expect(await provider.connectionStatus(context)).toMatchObject({ connected: true })
    await provider.connection!.update(context, { method: 'disconnect' })
    expect(close).toHaveBeenCalledOnce()
    await expect(provider.workItems!.list(context, {})).rejects.toThrow(/authorization/)
    expect(call.mock.calls.some(([name]) => name === 'logout' || name === 'remove-account')).toBe(false)
  })

  it('does not access local accounts from a hosted context or mislabel network failure as missing authorization', async () => {
    const { provider, call } = await setup()
    expect(await provider.connectionStatus({ hostEnvironment: 'hosted' })).toMatchObject({ connected: false })
    expect(call).not.toHaveBeenCalled()
    await provider.connection!.update(context, { method: 'device-code' })
    call.mockRejectedValue(new MicrosoftTodoError('unavailable'))
    await expect(provider.connectionStatus(context)).rejects.toThrow(/unavailable/)
  })

  it('isolates in-flight snapshots by host, integration instance and locale', async () => {
    const { provider, call } = await setup()
    await provider.connection!.update(context, { method: 'device-code' })
    let release!: () => void
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    call.mockImplementation(async (name) => {
      if (name === 'list-accounts') {
        await wait
        return { accounts: [{ email: 'reader@example.com' }] }
      }
      if (name === 'list-todo-task-lists')
        return { value: [{ id: 'one', displayName: 'Work', isOwner: true, isShared: false }] }
      return { value: [{ id: 'task', title: 'Review', status: 'notStarted' }] }
    })
    const english = provider.workItems!.list(context, {})
    const chinese = provider.workItems!.list({ ...context, locale: 'zh-CN', integrationId: 'another-todo' }, {})
    await expect(provider.workItems!.list({ ...context, hostEnvironment: 'hosted' }, {})).rejects.toThrow('authorization')
    release()
    expect((await english).items[0]).toMatchObject({ statusLabel: 'Not started', sourceRef: { instanceId: 'microsoft-todo' } })
    expect((await chinese).items[0]).toMatchObject({ statusLabel: '未开始', sourceRef: { instanceId: 'another-todo' } })
  })

  it('does not restore enabled preferences when disconnect interrupts account discovery', async () => {
    const { provider, call, statePath } = await setup()
    let started!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    call.mockImplementation(async (name) => {
      if (name === 'list-accounts') {
        started()
        await wait
        return { accounts: [{ email: 'reader@example.com', isDefault: true }] }
      }
      return { value: [] }
    })
    const connecting = provider.connection!.update(context, { method: 'device-code' })
    const rejected = expect(connecting).rejects.toThrow('authorization')
    await entered
    await provider.connection!.update(context, { method: 'disconnect' })
    release()
    await rejected
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual({ enabled: false })
    expect(await provider.connectionStatus(context)).toMatchObject({ connected: false })
  })
})

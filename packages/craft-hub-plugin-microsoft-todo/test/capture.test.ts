import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createCapturedTodo, todoCapture } from '../src/capture'
import { createMicrosoftTodoPlugin } from '../src/index'
import { MicrosoftTodoError } from '../src/transport'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'capture-test-'))
  directories.push(path)
  return path
}
const context = { hostEnvironment: 'local' as const, integrationId: 'microsoft-todo', confirmed: true }
const input = () => ({ requestId: randomUUID(), accountId: 'owner@example.com', listId: 'one', title: 'Ship release', notes: '', important: true })
it('creates only in the reviewed account and owned list after explicit write consent', async () => {
  const call = vi.fn(async (name: string) => {
    if (name === 'list-accounts')
      return { accounts: [{ email: 'owner@example.com', isDefault: true }] }
    return { value: [{ id: 'one', displayName: 'Work', isOwner: true, isShared: false }, { id: 'shared', isOwner: true, isShared: true }] }
  })
  const write = vi.fn(async (name: string, _input?: Record<string, unknown>) => name === 'create-todo-task' ? { id: 'created' } : { value: [] })
  const plugin = createMicrosoftTodoPlugin({ statePath: join(await directory(), 'connection.json'), transport: { call, close: async () => {} }, writeTransport: { call: write, close: async () => {} } })
  const provider = plugin.integrationProviders![0]!
  const draft = { ...input(), dueDate: '2026-10-14', reminderAt: '2026-10-13T23:00:00.000Z' }
  await provider.connection!.update(context, { method: 'device-code' })
  await expect(provider.workItems!.create!(context, draft)).rejects.toThrow('authorization')
  await provider.connection!.update(context, { method: 'enable-write' })
  await expect(provider.workItems!.create!({ ...context, confirmed: false }, draft)).rejects.toThrow('Confirm')
  await expect(provider.workItems!.create!({ ...context, hostEnvironment: 'hosted' }, draft)).rejects.toThrow('Confirm')
  await expect(provider.workItems!.create!(context, { ...draft, accountId: 'other@example.com' })).rejects.toThrow('account changed')
  await expect(provider.workItems!.create!(context, { ...draft, listId: 'shared' })).rejects.toThrow('private')
  const first = await provider.workItems!.create!(context, draft)
  expect(first).toMatchObject({ reminderDate: { dateTime: '2026-10-13T23:00:00.000', timeZone: 'UTC', precision: 'datetime' } })
  const second = await provider.workItems!.create!(context, draft)
  expect(second).toEqual(first)
  expect(write.mock.calls.filter(([name]) => name === 'create-todo-task')).toHaveLength(1)
  expect(write.mock.calls.find(([name]) => name === 'create-todo-task')?.[1]).toMatchObject({ body: { dueDateTime: { dateTime: '2026-10-14T00:00:00', timeZone: 'UTC' }, isReminderOn: true, reminderDateTime: { dateTime: '2026-10-13T23:00:00.000', timeZone: 'UTC' } } })
})
it('does not retry an uncertain remote write, even after restarting the capture service', async () => {
  const path = await directory()
  const draft = todoCapture(input())
  const create = vi.fn().mockRejectedValue(new Error('Timeout after write'))
  await expect(createCapturedTodo(path, draft, create)).rejects.toThrow('could not be confirmed')
  await expect(createCapturedTodo(path, draft, create)).rejects.toThrow('could not be confirmed')
  expect(create).toHaveBeenCalledOnce()
  await expect(createCapturedTodo(path, { ...draft, title: 'Changed' }, create)).rejects.toThrow('different task')
})
it('allows retry after an explicit authorization failure and rejects invalid payloads', async () => {
  const path = await directory()
  const draft = todoCapture(input())
  const create = vi.fn().mockRejectedValueOnce(new MicrosoftTodoError('authorization')).mockResolvedValue({ id: 'one', title: draft.title })
  await expect(createCapturedTodo(path, draft, create)).rejects.toThrow('authorization')
  await expect(createCapturedTodo(path, draft, create)).resolves.toMatchObject({ id: 'one' })
  expect(() => todoCapture({ ...input(), dueDate: 'tomorrow' })).toThrow('Invalid')
  expect(() => todoCapture({ ...input(), dueDate: '2026-02-30' })).toThrow('Invalid')
  expect(() => todoCapture({ ...input(), reminderAt: '2026-10-14T07:00:00.000Z' })).toThrow('Invalid')
})

it('cancels a reviewed capture when disconnect interrupts its remote preflight', async () => {
  const call = vi.fn(async (name: string): Promise<Record<string, unknown>> => name === 'list-accounts'
    ? { accounts: [{ email: 'owner@example.com', isDefault: true }] }
    : { value: [{ id: 'one', displayName: 'Work', isOwner: true, isShared: false }] })
  const write = vi.fn(async (_name: string): Promise<Record<string, unknown>> => ({ value: [] }))
  const provider = createMicrosoftTodoPlugin({ statePath: join(await directory(), 'connection.json'), transport: { call, close: async () => {} }, writeTransport: { call: write, close: async () => {} } }).integrationProviders![0]!
  await provider.connection!.update(context, { method: 'device-code' })
  await provider.connection!.update(context, { method: 'enable-write' })
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  call.mockImplementation(async (name) => {
    if (name === 'list-accounts')
      return { accounts: [{ email: 'owner@example.com', isDefault: true }] }
    entered()
    await wait
    return { value: [{ id: 'one', displayName: 'Work', isOwner: true, isShared: false }] }
  })
  const creating = provider.workItems!.create!(context, input())
  const rejected = expect(creating).rejects.toThrow('authorization')
  await started
  await provider.connection!.update(context, { method: 'disconnect' })
  release()
  await rejected
  expect(write.mock.calls.filter(([name]) => name === 'create-todo-task')).toHaveLength(0)
})

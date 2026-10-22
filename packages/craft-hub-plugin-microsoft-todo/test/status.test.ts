import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { IntegrationConfirmationRequiredError, IntegrationRegistry } from '../../craft-hub/src/integrations'
import { createMicrosoftTodoPlugin } from '../src/index'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
const context = { hostEnvironment: 'local' as const, integrationId: 'microsoft-todo', confirmed: true, locale: 'en' as const }
const sourceRef = { providerId: 'microsoft-todo', instanceId: 'microsoft-todo', accountId: 'owner@example.com', containerId: 'one', kind: 'task', itemId: 'task-1' }
const lists = [{ id: 'one', displayName: 'Work', isOwner: true, isShared: false }, { id: 'shared', displayName: 'Team', isOwner: true, isShared: true }]

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'craft-hub-todo-status-'))
  directories.push(directory)
  const call = vi.fn(async (name: string, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    if (name === 'list-accounts')
      return { accounts: [{ email: 'owner@example.com', isDefault: true }] }
    if (name === 'list-todo-tasks')
      return { value: input.todoTaskListId === 'one' ? [{ id: 'task-1', title: 'Take medicine', status: 'inProgress' }] : [] }
    return { value: lists }
  })
  const write = vi.fn(async (name: string, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> => name === 'update-todo-task'
    ? { id: input.todoTaskId, title: 'Take medicine', status: (input.body as { status: string }).status }
    : { value: lists })
  const plugin = createMicrosoftTodoPlugin({ statePath: join(directory, 'connection.json'), transport: { call, close: async () => {} }, writeTransport: { call: write, close: async () => {} } })
  return { plugin, provider: plugin.integrationProviders![0]!, call, write }
}

it('completes and reopens an owned task only after write consent and explicit confirmation', async () => {
  const { provider, write } = await setup()
  await provider.connection!.update(context, { method: 'device-code' })
  expect((await provider.workItems!.list(context, {})).items[0]).toMatchObject({ status: 'inProgress', statusUpdateAvailable: false })
  await expect(provider.workItems!.updateStatus!(context, { sourceRef, statusCategory: 'done' })).rejects.toThrow('authorization')
  await provider.connection!.update(context, { method: 'enable-write' })
  expect((await provider.workItems!.list(context, {})).items[0]).toMatchObject({ statusUpdateAvailable: true })
  await expect(provider.workItems!.updateStatus!({ ...context, confirmed: false }, { sourceRef, statusCategory: 'done' })).rejects.toThrow('Confirm')
  await expect(provider.workItems!.updateStatus!({ ...context, hostEnvironment: 'hosted' }, { sourceRef, statusCategory: 'done' })).rejects.toThrow('Confirm')
  await expect(provider.workItems!.updateStatus!(context, { sourceRef: { ...sourceRef, accountId: 'other@example.com' }, statusCategory: 'done' })).rejects.toThrow('account changed')
  await expect(provider.workItems!.updateStatus!(context, { sourceRef: { ...sourceRef, containerId: 'shared' }, statusCategory: 'done' })).rejects.toThrow('private')
  await expect(provider.workItems!.updateStatus!(context, { sourceRef: { ...sourceRef, instanceId: 'other' }, statusCategory: 'done' })).rejects.toThrow('Invalid')
  await expect(provider.workItems!.updateStatus!(context, { sourceRef, statusCategory: 'cancelled' })).rejects.toThrow('Invalid')
  expect(write.mock.calls.filter(([name]) => name === 'update-todo-task')).toHaveLength(0)

  expect(await provider.workItems!.updateStatus!(context, { sourceRef, statusCategory: 'done' })).toMatchObject({ id: 'task-1', sourceRef, status: 'completed', statusCategory: 'done', statusLabel: 'Completed' })
  expect(write).toHaveBeenLastCalledWith('update-todo-task', { account: 'owner@example.com', todoTaskListId: 'one', todoTaskId: 'task-1', confirm: true, body: { status: 'completed' } })
  expect(await provider.workItems!.updateStatus!(context, { sourceRef, statusCategory: 'open', status: 'inProgress' })).toMatchObject({ status: 'inProgress', statusCategory: 'active' })
  await provider.workItems!.updateStatus!(context, { sourceRef, statusCategory: 'open', status: 'completed' })
  expect(write).toHaveBeenLastCalledWith('update-todo-task', expect.objectContaining({ body: { status: 'notStarted' } }))
})

it('rejects a write response for another task or status', async () => {
  const { provider, write } = await setup()
  await provider.connection!.update(context, { method: 'device-code' })
  await provider.connection!.update(context, { method: 'enable-write' })
  write.mockImplementation(async name => name === 'update-todo-task' ? { id: 'other', title: 'Other', status: 'completed' } : { value: lists })
  await expect(provider.workItems!.updateStatus!(context, { sourceRef, statusCategory: 'done' })).rejects.toThrow('invalid response')
})

it('declares completion as an always-confirmed remote write', async () => {
  const { plugin } = await setup()
  const registry = new IntegrationRegistry(plugin.integrationProviders)
  const { integrations, diagnostics } = registry.resolve([{ ...plugin.integrations![0]!, pluginId: plugin.id, source: 'host:test' }])
  expect(diagnostics).toEqual([])
  expect(integrations[0]!.actions.find(action => action.id === 'status')).toMatchObject({ operation: 'work-items.update-status', effect: 'remote-write', effectiveConfirmation: 'always' })
  await expect(registry.invoke({ contribution: integrations[0]!, actionId: 'status', input: { sourceRef, statusCategory: 'done' } })).rejects.toBeInstanceOf(IntegrationConfirmationRequiredError)
})

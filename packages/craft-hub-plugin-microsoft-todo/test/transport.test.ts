import { createRequire } from 'node:module'
import process from 'node:process'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMicrosoftTodoTransport } from '../src/transport'

const mocks = vi.hoisted(() => ({
  clients: [] as Array<{ onclose?: () => void, connect: ReturnType<typeof vi.fn>, close: ReturnType<typeof vi.fn>, callTool: ReturnType<typeof vi.fn> }>,
  transports: [] as Array<{ close: ReturnType<typeof vi.fn> }>,
  parameters: [] as Array<{ command: string, args?: string[], env?: Record<string, string> }>,
}))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    onclose?: () => void
    connect = vi.fn().mockResolvedValue(undefined)
    callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"accounts":[]}' }] })
    close = vi.fn(async () => { this.onclose?.() })
    constructor() { mocks.clients.push(this) }
  },
}))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    close = vi.fn().mockResolvedValue(undefined)
    constructor(parameters: { command: string, args?: string[], env?: Record<string, string> }) {
      mocks.transports.push(this)
      mocks.parameters.push(parameters)
    }
  },
}))
beforeEach(() => {
  vi.useFakeTimers()
  mocks.clients.length = 0
  mocks.transports.length = 0
  mocks.parameters.length = 0
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it.each([false, true])('preloads only the host bootstrap and preserves connector boundaries with writable=%s', async (writable) => {
  const networkBootstrap = 'file:///Application%20Support/Craft%20Hub/node-network-bootstrap.mjs'
  vi.stubEnv('NODE_OPTIONS', '--import=file:///untrusted.mjs')
  vi.stubEnv('NODE_PATH', '/untrusted-modules')
  vi.stubEnv('CRAFT_HUB_SECRET', 'fixture-value')
  const transport = createMicrosoftTodoTransport({ networkBootstrap, writable })
  try {
    await transport.call('list-accounts')
    expect(mocks.parameters).toHaveLength(1)
    expect(mocks.parameters[0]).toMatchObject({
      command: process.execPath,
      args: ['--import', networkBootstrap, createRequire(import.meta.url).resolve('@softeria/ms-365-mcp-server'), ...(writable ? [] : ['--read-only']), '--enabled-tools', writable ? '^(list-todo-(task-lists|tasks)|(create|update)-todo-task)$' : '^list-todo-(task-lists|tasks)$', '--allowed-scopes', writable ? 'Tasks.ReadWrite' : 'Tasks.Read'],
      env: { ELECTRON_RUN_AS_NODE: '1', LOG_LEVEL: 'error' },
    })
    expect(mocks.parameters[0]!.env).not.toHaveProperty('NODE_OPTIONS')
    expect(mocks.parameters[0]!.env).not.toHaveProperty('NODE_PATH')
    expect(mocks.parameters[0]!.env).not.toHaveProperty('CRAFT_HUB_SECRET')
  }
  finally {
    await transport.close()
  }
})

it('reuses the authorized desktop process after idle refreshes instead of reopening the keychain', async () => {
  const transport = createMicrosoftTodoTransport({ keepAlive: true })
  await Promise.all([transport.call('list-accounts'), transport.call('list-accounts')])
  await vi.advanceTimersByTimeAsync(31_000)
  await transport.call('list-accounts')
  await vi.advanceTimersByTimeAsync(60 * 60_000)
  await transport.call('list-accounts')
  expect(mocks.clients).toHaveLength(1)
  expect(mocks.clients[0]!.close).not.toHaveBeenCalled()
  await transport.close()
  expect(mocks.clients[0]!.close).toHaveBeenCalledOnce()
})

it('releases an idle command-line connector and reconnects after explicit disconnect', async () => {
  const transport = createMicrosoftTodoTransport()
  await transport.call('list-accounts')
  await vi.advanceTimersByTimeAsync(31_000)
  expect(mocks.clients[0]!.close).toHaveBeenCalledOnce()
  await transport.call('list-accounts')
  await transport.close()
  await transport.call('list-accounts')
  expect(mocks.clients).toHaveLength(3)
  await transport.close()
})

it('keeps an on-demand connector for its idle period, then releases it', async () => {
  const transport = createMicrosoftTodoTransport({ idleTimeoutMs: 10 * 60_000 })
  await transport.call('list-accounts')
  await vi.advanceTimersByTimeAsync(9 * 60_000)
  await transport.call('list-accounts')
  await vi.advanceTimersByTimeAsync(9 * 60_000)
  expect(mocks.clients).toHaveLength(1)
  expect(mocks.clients[0]!.close).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(60_001)
  expect(mocks.clients[0]!.close).toHaveBeenCalledOnce()
})

it('recovers a stopped desktop connector on the next read without retrying writes', async () => {
  const transport = createMicrosoftTodoTransport({ keepAlive: true })
  await transport.call('list-accounts')
  mocks.clients[0]!.onclose?.()
  await transport.call('list-accounts')
  expect(mocks.clients).toHaveLength(2)
  await expect(transport.call('delete-todo-task')).rejects.toThrow('invalid response')
  expect(mocks.clients[1]!.callTool).toHaveBeenCalledOnce()
  await transport.close()
})

it('requires the write transport and explicit confirmation for task creation and status updates', async () => {
  const reader = createMicrosoftTodoTransport()
  await expect(reader.call('create-todo-task', { confirm: true })).rejects.toThrow('invalid response')
  await expect(reader.call('update-todo-task', { confirm: true })).rejects.toThrow('invalid response')
  const writer = createMicrosoftTodoTransport({ writable: true, keepAlive: true })
  await expect(writer.call('create-todo-task')).rejects.toThrow('invalid response')
  await expect(writer.call('update-todo-task')).rejects.toThrow('invalid response')
  await expect(writer.call('delete-todo-task', { confirm: true })).rejects.toThrow('invalid response')
  await writer.call('create-todo-task', { confirm: true, body: { title: 'Reviewed task' } })
  await writer.call('update-todo-task', { confirm: true, body: { status: 'completed' } })
  expect(mocks.clients).toHaveLength(1)
  expect(mocks.clients[0]!.callTool).toHaveBeenCalledTimes(2)
  await writer.close()
})

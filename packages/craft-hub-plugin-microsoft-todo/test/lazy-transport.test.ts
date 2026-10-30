import { expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ clientLoads: 0, transportLoads: 0, clients: 0, closes: 0 }))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  state.clientLoads++
  return {
    Client: class {
      onclose?: () => void
      constructor() { state.clients++ }
      async connect() {}
      async callTool() { return { content: [{ type: 'text', text: '{"accounts":[]}' }] } }
      async close() {
        state.closes++
        this.onclose?.()
      }
    },
  }
})
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
  state.transportLoads++
  return { StdioClientTransport: class { async close() {} } }
})

it('loads the connector SDK only for allowed first use and cannot reopen during an in-flight close', async () => {
  const { createMicrosoftTodoTransport } = await import('../src/transport')
  const reader = createMicrosoftTodoTransport()
  const writer = createMicrosoftTodoTransport({ writable: true })
  try {
    await reader.close()
    await writer.close()
    await expect(reader.call('create-todo-task', { confirm: true })).rejects.toMatchObject({ kind: 'response' })
    await expect(writer.call('update-todo-task')).rejects.toMatchObject({ kind: 'response' })
    expect(state.clientLoads).toBe(0)
    expect(state.transportLoads).toBe(0)
    expect(state.clients).toBe(0)
    await Promise.all([reader.call('list-accounts'), reader.call('list-accounts')])
    expect(state.clientLoads).toBe(1)
    expect(state.transportLoads).toBe(1)
    expect(state.clients).toBe(1)
    await reader.close()
    const reopening = reader.call('list-accounts')
    await reader.close()
    await expect(reopening).rejects.toMatchObject({ kind: 'startup' })
    expect(state.clients).toBe(1)
    await reader.call('list-accounts')
    expect(state.clients).toBe(2)
  }
  finally {
    await Promise.all([reader.close(), writer.close()])
  }
})

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, expect, it, vi } from 'vitest'
import { createMicrosoftTodoTransport } from '../src/transport'

const connector = dirname(createRequire(import.meta.url).resolve('@softeria/ms-365-mcp-server'))
const upstream = (path: string) => import(pathToFileURL(join(connector, path)).href)
afterEach(() => vi.unstubAllEnvs())

it.each([false, true])('preserves real To Do input schemas, scope filtering and confirmation with writable=%s', async (writable) => {
  vi.stubEnv('LOG_LEVEL', 'error')
  const { registerGraphTools } = await upstream('graph-tools.js')
  const server = new McpServer({ name: 'offline-connector-test', version: '1.0.0' })
  const client = new Client({ name: 'offline-client-test', version: '1.0.0' })
  const graphRequest = vi.fn(async () => ({ content: [{ type: 'text', text: '{"value":[]}' }] }))
  registerGraphTools(server, { graphRequest }, {
    readOnly: !writable,
    enabledTools: '^(list-todo-(task-lists|tasks)|(create|update)-todo-task)$',
    allowedScopes: writable ? 'Tasks.ReadWrite' : 'Tasks.Read',
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const { tools } = await client.listTools()
    expect(tools.map(tool => tool.name).sort()).toEqual(writable
      ? ['create-todo-task', 'list-todo-task-lists', 'list-todo-tasks', 'update-todo-task']
      : ['list-todo-task-lists', 'list-todo-tasks'])
    const tasks = tools.find(tool => tool.name === 'list-todo-tasks')!
    expect(tasks.inputSchema.required).toContain('todoTaskListId')
    expect(tasks.inputSchema.properties?.todoTaskListId).toMatchObject({ type: 'string' })
    const invalid = await client.callTool({ name: 'list-todo-tasks', arguments: { todoTaskListId: 123 } })
    expect(invalid.isError).toBe(true)
    expect(graphRequest).not.toHaveBeenCalled()
    const result = await client.callTool({ name: 'list-todo-tasks', arguments: { todoTaskListId: 'fixture-list' } })
    expect(result.isError).not.toBe(true)
    expect(graphRequest).toHaveBeenCalledOnce()
    if (writable) {
      const create = tools.find(tool => tool.name === 'create-todo-task')!
      expect(create.inputSchema.properties?.body).toMatchObject({ type: 'object', properties: { title: { anyOf: expect.arrayContaining([{ type: 'null' }, expect.objectContaining({ type: 'string' })]) } } })
      graphRequest.mockClear()
      // Creation is not destructive upstream; Craft Hub requires confirmation for every write before spawning it.
      const transport = createMicrosoftTodoTransport({ writable: true })
      await expect(transport.call('create-todo-task', { todoTaskListId: 'fixture-list', body: { title: 'Fixture' } })).rejects.toMatchObject({ kind: 'response' })
      await transport.close()
      expect(graphRequest).not.toHaveBeenCalled()
      const confirmed = await client.callTool({ name: 'create-todo-task', arguments: { todoTaskListId: 'fixture-list', body: { title: 'Fixture' }, confirm: true } })
      expect(confirmed.isError).not.toBe(true)
      expect(graphRequest).toHaveBeenCalledOnce()
    }
  }
  finally {
    await client.close()
    await server.close()
  }
})

it('describes Zod 4 optional, record and bounded schemas without losing their constraints', async () => {
  const { z } = createRequire(pathToFileURL(join(connector, 'index.js')))('zod')
  const { describeUtilityToolSchema } = await upstream('lib/tool-schema.js')
  const schema = describeUtilityToolSchema({
    name: 'fixture',
    method: 'GET',
    path: '/fixture',
    description: 'Offline schema fixture',
    buildSchema: () => ({
      id: z.string(),
      limit: z.number().int().max(100).optional(),
      fields: z.record(z.string(), z.string()).optional(),
    }),
  }, {})
  expect(schema.parameters).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'id', required: true, schema: { type: 'string' } }),
    expect.objectContaining({ name: 'limit', required: false, schema: expect.objectContaining({ type: 'integer', maximum: 100 }) }),
    expect.objectContaining({ name: 'fields', required: false, schema: expect.objectContaining({ type: 'object', additionalProperties: { type: 'string' } }) }),
  ]))
})

it('loads and clears the real MSAL cache using only in-memory fixture storage', async () => {
  vi.stubEnv('LOG_LEVEL', 'error')
  vi.stubEnv('MS365_MCP_USE_KEYTAR', '0')
  vi.stubEnv('MS365_MCP_OAUTH_TOKEN', undefined)
  const { default: AuthManager, wrapCache } = await upstream('auth.js')
  const values = new Map<string, string>([['token-cache', wrapCache(JSON.stringify({ Account: {}, IdToken: {}, AccessToken: {}, RefreshToken: {}, AppMetadata: {} }))]])
  const network = vi.fn(async () => {
    throw new Error('Offline compatibility test must not access the network')
  })
  const storage = {
    failClosed: true,
    load: vi.fn(async (key: string) => values.get(key)),
    save: vi.fn(async (key: string, value: string) => { values.set(key, value) }),
    delete: vi.fn(async (key: string) => { values.delete(key) }),
  }
  const auth = new AuthManager({
    auth: { clientId: '00000000-0000-4000-8000-000000000001', authority: 'https://login.microsoftonline.com/consumers' },
    system: { networkClient: { sendGetRequestAsync: network, sendPostRequestAsync: network } },
  }, ['Tasks.Read'], undefined, storage)
  await auth.loadTokenCache()
  expect(await auth.listAccounts()).toEqual([])
  await auth.logout()
  expect(storage.delete).toHaveBeenCalledWith('token-cache')
  expect(storage.delete).toHaveBeenCalledWith('selected-account')
  expect(values.size).toBe(0)
  expect(network).not.toHaveBeenCalled()
})

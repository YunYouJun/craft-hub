import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import process from 'node:process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const allowedTools = new Set(['list-accounts', 'list-todo-task-lists', 'list-todo-tasks', 'login'])

/** A narrow read/authentication boundary; only explicitly enabled task creation is exposed. */
export interface MicrosoftTodoTransport {
  call: (name: string, input?: Record<string, unknown>) => Promise<Record<string, unknown>>
  close: () => Promise<void>
}

/** Desktop hosts keep one authorized process alive and close it during host shutdown. */
export interface MicrosoftTodoTransportOptions { keepAlive?: boolean, writable?: boolean }

/** Sanitized failure without credential-bearing upstream diagnostics. */
export class MicrosoftTodoError extends Error {
  constructor(readonly kind: 'authorization' | 'unavailable' | 'response' | 'startup') {
    super(kind === 'authorization' ? 'Microsoft To Do authorization is required.' : kind === 'response' ? 'Microsoft To Do returned an invalid response.' : kind === 'startup' ? 'Microsoft To Do could not start. Check any system credential-access prompts, then retry.' : 'Microsoft To Do is unavailable. Check your connection and refresh.')
  }
}

/** Run the pinned local connector with a narrow task allowlist and optional Tasks.ReadWrite permission. */
export function createMicrosoftTodoTransport(options: MicrosoftTodoTransportOptions = {}): MicrosoftTodoTransport {
  let opening: Promise<Client> | undefined
  let connection: { client: Client, transport: StdioClientTransport } | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let active = 0
  let authorizingUntil = 0
  const close = async (): Promise<void> => {
    clearTimeout(idleTimer)
    const previous = connection
    connection = undefined
    opening = undefined
    await previous?.client.close()
  }
  const open = (): Promise<Client> => {
    opening ??= (async () => {
      const env: Record<string, string> = {}
      for (const name of ['HOME', 'PATH', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'SYSTEMROOT', 'TEMP', 'TMP']) {
        if (process.env[name])
          env[name] = process.env[name]!
      }
      env.ELECTRON_RUN_AS_NODE = '1'
      env.MS365_MCP_TENANT_ID = process.env.CRAFT_HUB_MICROSOFT_TODO_TENANT_ID ?? 'consumers'
      env.LOG_LEVEL = 'error'
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [createRequire(import.meta.url).resolve('@softeria/ms-365-mcp-server'), ...(options.writable ? [] : ['--read-only']), '--enabled-tools', options.writable ? '^(list-todo-(task-lists|tasks)|create-todo-task)$' : '^list-todo-(task-lists|tasks)$', '--allowed-scopes', options.writable ? 'Tasks.ReadWrite' : 'Tasks.Read'],
        cwd: homedir(),
        env,
        stderr: 'pipe',
      })
      const client = new Client({ name: 'craft-hub-microsoft-todo', version: '0.1.0' })
      const current = { client, transport }
      connection = current
      client.onclose = () => {
        if (connection === current) {
          connection = undefined
          opening = undefined
        }
      }
      transport.stderr?.on('data', () => {})
      try {
        // First use can wait for the operating system's credential-access dialog.
        await client.connect(transport, { timeout: 90_000 })
        return client
      }
      catch {
        await transport.close().catch(() => {})
        if (connection === current) {
          connection = undefined
          opening = undefined
        }
        throw new MicrosoftTodoError('startup')
      }
    })()
    return opening
  }
  return {
    close,
    async call(name, input = {}) {
      if (!allowedTools.has(name) && !(options.writable && name === 'create-todo-task' && input.confirm === true))
        throw new MicrosoftTodoError('response')
      clearTimeout(idleTimer)
      active++
      try {
        const client = await open()
        const result = await client.callTool({ name, arguments: input }, undefined, { timeout: 60_000 })
        const content = result.content as Array<{ type: string, text?: string }>
        const text = content.filter(item => item.type === 'text').map(item => item.text ?? '').join('\n')
        if (text.length > 4 * 1024 * 1024)
          throw new MicrosoftTodoError('response')
        const body = JSON.parse(text) as Record<string, unknown>
        if (body.error === 'device_code_required' && name === 'login') {
          authorizingUntil = Date.now() + 15 * 60_000
          return body
        }
        if (body.error || result.isError) {
          const diagnostic = JSON.stringify(body.error ?? '')
          throw new MicrosoftTodoError(/token|login|log.in|unauthor|401|403|consent|access.denied/i.test(diagnostic) ? 'authorization' : 'unavailable')
        }
        return body
      }
      catch (error) {
        throw error instanceof MicrosoftTodoError ? error : new MicrosoftTodoError('unavailable')
      }
      finally {
        active--
        if (!active && !options.keepAlive) {
          idleTimer = setTimeout(() => {
            void close().catch(() => {})
          }, Math.max(30_000, authorizingUntil - Date.now()))
          idleTimer.unref()
        }
      }
    },
  }
}

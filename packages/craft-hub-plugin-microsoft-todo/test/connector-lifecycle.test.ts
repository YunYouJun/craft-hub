import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ entry: '', transports: [] as Array<{ pid: number | null }> }))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@modelcontextprotocol/sdk/client/stdio.js')>()
  return {
    ...actual,
    StdioClientTransport: class extends actual.StdioClientTransport {
      constructor(options: ConstructorParameters<typeof actual.StdioClientTransport>[0]) {
        // Only replace the credential-bearing upstream executable. Exercise the real SDK and process lifecycle.
        super({ ...options, args: [state.entry] })
        state.transports.push(this)
      }
    },
  }
})

it('reaps a real idle connector process and starts a new one only on its next allowed call', async () => {
  const require = createRequire(import.meta.url)
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-connector-lifecycle-'))
  state.entry = join(root, 'connector.mjs')
  const serverModule = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/mcp.js')).href
  const transportModule = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/stdio.js')).href
  await writeFile(state.entry, `
import { McpServer } from ${JSON.stringify(serverModule)}
import { StdioServerTransport } from ${JSON.stringify(transportModule)}
const server = new McpServer({name:'fixture',version:'1.0.0'})
server.registerTool('list-accounts',{inputSchema:{}},async()=>({content:[{type:'text',text:'{"accounts":[]}'}]}))
await server.connect(new StdioServerTransport())
process.stdin.once('end',()=>process.exit(0))
`)
  const { createMicrosoftTodoTransport } = await import('../src/transport')
  const transport = createMicrosoftTodoTransport({ idleTimeoutMs: 100 })
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    }
    catch { return false }
  }
  try {
    expect(state.transports).toHaveLength(0)
    await Promise.all([transport.call('list-accounts'), transport.call('list-accounts')])
    expect(state.transports).toHaveLength(1)
    const first = state.transports[0]!.pid!
    expect(first).toBeGreaterThan(0)
    const deadline = Date.now() + 5000
    while (alive(first) && Date.now() < deadline)
      await delay(25)
    expect(alive(first)).toBe(false)
    await transport.call('list-accounts')
    expect(state.transports).toHaveLength(2)
    const second = state.transports[1]!.pid!
    expect(second).not.toBe(first)
    await transport.close()
    expect(alive(second)).toBe(false)
  }
  finally {
    await transport.close()
    await rm(root, { recursive: true, force: true })
  }
})

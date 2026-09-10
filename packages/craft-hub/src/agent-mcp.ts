import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { readFile } from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { agentReadTools } from './agent-connection'
import { craftHubVersion } from './version'

/** Connection options contain a local credential path, never a bearer token. */
export interface AgentMcpOptions { url: string, credentialFile: string }

/** Call only the dedicated read endpoint on an explicitly selected loopback host. */
export async function callAgentHost(options: AgentMcpOptions, name: string, args: unknown = {}): Promise<unknown> {
  const url = new URL(options.url)
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Agent connection requires an HTTP loopback origin')
  const credential = JSON.parse(await readFile(options.credentialFile, 'utf8')) as { token?: unknown }
  if (typeof credential.token !== 'string' || !/^[a-f\d]{64}$/.test(credential.token))
    throw new Error('Invalid or revoked local credential')
  const response = await fetch(new URL('/api/agent-access', url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${credential.token}` },
    body: JSON.stringify({ name, arguments: args }),
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  })
  const result = await response.json() as { error?: string }
  if (!response.ok)
    throw new Error(result.error ?? `Craft Hub returned HTTP ${response.status}`)
  return result
}

/** Serve read-only MCP tools over stdio while reusing the running host and its plugins. */
export async function startAgentMcp(options: AgentMcpOptions): Promise<McpServer> {
  await callAgentHost(options, 'check')
  const server = new McpServer({ name: 'craft-hub', version: craftHubVersion })
  for (const [name, tool] of Object.entries(agentReadTools)) {
    server.registerTool(name, { description: tool.description, inputSchema: tool.schema.shape, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } }, async (args: Record<string, unknown>): Promise<CallToolResult> => {
      try {
        const result = await callAgentHost(options, name, args)
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      }
      catch (error) {
        return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }
      }
    })
  }
  await server.connect(new StdioServerTransport())
  return server
}

import process from 'node:process'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createCraftHubMcpServer } from './create-server'

async function main(): Promise<void> {
  await createCraftHubMcpServer().connect(new StdioServerTransport())
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

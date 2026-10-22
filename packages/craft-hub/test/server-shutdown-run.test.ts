import type { IncomingMessage } from 'node:http'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

async function completesWithin(pending: Promise<unknown>, timeout: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pending.then(() => true),
      new Promise<false>(resolve => timer = setTimeout(resolve, timeout, false)),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

it('cancels a long-running HTTP command and finishes shutdown instead of draining its entire run as a mutation', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-shutdown-run-')))
  await writeFile(join(root, 'package.json'), '{}')
  const capabilityId = 'shutdown:long-running'
  const runtime = new CraftHubRuntime({
    dataDir: join(root, 'data'),
    configDir: join(root, 'config'),
    capabilityProviders: [{
      id: 'shutdown-fixture',
      discover: async ({ project }) => [{
        id: capabilityId,
        kind: 'command',
        name: 'Long-running command',
        source: 'package.json',
        invocation: {
          command: process.execPath,
          args: ['-e', 'console.log("shutdown-run-ready"); setInterval(() => {}, 1000)'],
          cwd: project.path,
          requiredEnv: [],
        },
      }],
    }],
  })
  const settingsWatch = vi.spyOn(runtime.settings, 'startWatching').mockResolvedValue()
  const configWatch = vi.spyOn(runtime.userConfig, 'startWatching').mockResolvedValue()
  const cancelRuns = vi.spyOn(runtime, 'cancelAllRuns')
  // Add the fixture after server startup so this test does not create native project watchers.
  const app = await startCraftHubServer({ port: 0, runtime })
  const project = await runtime.addProject(root)
  await runtime.projects.setTrust(project.id, 'trusted')
  const running = Promise.withResolvers<void>()
  let response: IncomingMessage | undefined
  let output = ''
  let closing: Promise<void> | undefined
  const request = httpRequest(`${app.url}/api/projects/${project.id}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  }, (incoming) => {
    response = incoming
    incoming.setEncoding('utf8')
    incoming.on('data', (chunk: string) => {
      output += chunk
      if (output.includes('"type":"start"') && output.includes('shutdown-run-ready'))
        running.resolve()
    })
    incoming.on('error', () => {})
  })
  request.on('error', () => {})
  request.end(JSON.stringify({ capabilityId }))
  try {
    expect(await completesWithin(running.promise, 3000), 'The real command must start and keep its HTTP stream open').toBe(true)
    expect(response?.statusCode).toBe(200)
    expect(response?.headers['content-type']).toContain('application/x-ndjson')
    expect(response?.complete).toBe(false)
    expect(runtime.projectRunSummaries().some(summary => summary.running > 0)).toBe(true)

    closing = app.close({ processExiting: true })
    expect(await completesWithin(closing, 3000), 'Shutdown must reach runtime cancellation without waiting for the long-running POST stream to finish first').toBe(true)
    expect(cancelRuns).toHaveBeenCalledOnce()
    expect(app.server.listening).toBe(false)
    expect(await runtime.store.listRuns()).toEqual([expect.objectContaining({ capabilityId, status: 'cancelled' })])
  }
  finally {
    request.destroy()
    response?.destroy()
    // The failing implementation waits for this run before it can call runtime.close().
    await runtime.cancelAllRuns()
    app.server.closeAllConnections()
    await (closing ?? app.close({ processExiting: true }))
    cancelRuns.mockRestore()
    settingsWatch.mockRestore()
    configWatch.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})

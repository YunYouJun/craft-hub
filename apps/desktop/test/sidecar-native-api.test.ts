import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { CraftHubRuntime } from '../../../packages/craft-hub/src/runtime'
import { startCraftHubServer } from '../../../packages/craft-hub/src/server'
import { createSessionGuard } from '../src/sidecar-host'

it('serves native discovery through the public API while preserving the project trust boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-native-api-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'native-fixture', scripts: { check: 'node --version' } }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  const guard = createSessionGuard('a'.repeat(64), 'b'.repeat(64))
  const server = await startCraftHubServer({ host: '127.0.0.1', port: 0, runtime, authorizeRequest: guard.authorize })
  guard.setOrigin(server.url)
  const headers = { 'authorization': `Bearer ${'b'.repeat(64)}`, 'content-type': 'application/json', 'origin': server.url }
  try {
    const project = await runtime.addProject(root)
    expect(project.trust).toBe('untrusted')
    const capabilities = await runtime.capabilities(project.id)
    const command = capabilities.find(item => item.kind === 'command')!
    expect(command).toBeDefined()
    expect((await fetch(`${server.url}/api/software`)).status).toBe(403)
    const catalog = await fetch(`${server.url}/api/software`, { headers })
    expect(catalog.status).toBe(200)
    expect(await catalog.json()).toMatchObject({ version: 1, sources: expect.any(Array) })
    const preview = await fetch(`${server.url}/api/projects/${project.id}/preview-command`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ capabilityId: command.id }),
    })
    expect(preview.status).toBe(200)
    const denied = await fetch(`${server.url}/api/projects/${project.id}/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ capabilityId: command.id }),
    })
    expect(denied.ok).toBe(false)
    expect(await denied.json()).toMatchObject({ error: expect.stringMatching(/trust/i) })
    expect(await runtime.runs()).toEqual([])
    expect((await runtime.projects.get(project.id))?.trust).toBe('untrusted')
  }
  finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

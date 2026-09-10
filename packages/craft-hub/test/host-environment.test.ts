import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { describeHostEnvironment } from '../src/host-environment'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

it('keeps local and hosted directory capabilities explicit', () => {
  expect(describeHostEnvironment()).toEqual({ kind: 'local', capabilities: { localProjectDirectories: true, localGitSync: true } })
  expect(describeHostEnvironment('hosted').capabilities).toEqual({ localProjectDirectories: false, localGitSync: false })
})

it('advertises hosted capabilities and rejects local directory mutations without changing user state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-host-environment-'))
  const runtime = new CraftHubRuntime({ hostEnvironment: 'hosted', dataDir: join(root, 'data'), configDir: join(root, 'config') })
  const server = await startCraftHubServer({ runtime, port: 0 })
  try {
    const health = await (await fetch(`${server.url}/api/health`)).json()
    expect(health.hostEnvironment).toEqual(describeHostEnvironment('hosted'))
    for (const [method, path] of [
      ['POST', '/api/projects'],
      ['POST', '/api/workspaces/register-member'],
      ['PUT', '/api/personal-git-sync'],
      ['POST', '/api/personal-git-sync/synchronize'],
      ['PUT', '/api/owner-scopes/example/git-sync'],
      ['POST', '/api/owner-scopes/example/git-sync/synchronize'],
      ['POST', '/api/dotfiles-manager/trust'],
    ]) {
      const response = await fetch(`${server.url}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repositoryPath: root, path: root }) })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'LOCAL_DIRECTORY_UNAVAILABLE' })
    }
    expect(await runtime.projects.list()).toEqual([])
    expect((await runtime.personalGitSync.status()).state).toBe('unconfigured')
    expect((await fetch(`${server.url}/api/settings`)).status).toBe(200)
    expect((await fetch(`${server.url}/api/workspaces`)).status).toBe(200)
  }
  finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

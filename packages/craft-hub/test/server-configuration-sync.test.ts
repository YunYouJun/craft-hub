import type { ServerResponse } from 'node:http'
import type { AccountSyncProvider } from '../src/account-sync'
import type { CraftHubOptions } from '../src/extensions'
import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { get as httpGet } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

async function runtimeFixture(options: CraftHubOptions = {}): Promise<{ root: string, runtime: CraftHubRuntime }> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-sync-events-'))
  return { root, runtime: new CraftHubRuntime({ ...options, dataDir: join(root, 'data'), configDir: join(root, 'config') }) }
}

async function observeSync(runtime: CraftHubRuntime) {
  let eventResponse: ServerResponse | undefined
  const app = await startCraftHubServer({ port: 0, runtime, handleHostRequest: (request, response) => {
    if (request.url === '/api/events')
      eventResponse = response
    return false
  } })
  let received = ''
  let barrier = ''
  let finishBarrier: (() => void) | undefined
  const ready = Promise.withResolvers<void>()
  const stream = httpGet(`${app.url}/api/events`, (response) => {
    response.setEncoding('utf8')
    response.on('data', (chunk: string) => {
      received += chunk
      if (received.includes('retry: 1000'))
        ready.resolve()
      if (barrier && received.includes(barrier)) {
        finishBarrier?.()
        finishBarrier = undefined
      }
    })
    response.on('error', ready.reject)
  })
  stream.on('error', ready.reject)
  await ready.promise
  let sequence = 0
  return {
    async count(): Promise<number> {
      barrier = `sync-test-barrier-${++sequence}`
      const arrived = new Promise<void>((resolve) => {
        finishBarrier = resolve
      })
      eventResponse!.write(`: ${barrier}\n\n`)
      await arrived
      return [...received.matchAll(/^event: configuration-sync$/gm)].length
    },
    async sync(resolution?: 'use-local' | 'use-cloud'): Promise<Record<string, unknown>> {
      const response = await fetch(`${app.url}/api/config-sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolution }) })
      expect(response.status).toBe(200)
      return response.json()
    },
    async close() {
      stream.destroy()
      await app.close()
    },
  }
}

it('does not publish unchanged disabled sync checks or execute discovered project commands', async () => {
  const { root, runtime } = await runtimeFixture()
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { inspect: 'node --version' } }))
  const project = await runtime.addProject(root)
  const observed = await observeSync(runtime)
  try {
    expect((await runtime.capabilityDiscovery(project.id)).capabilities.some(item => item.name === 'inspect' && item.source === 'package.json')).toBe(true)
    expect(await observed.sync()).toMatchObject({ state: 'disabled', teams: [] })
    await observed.sync()
    expect(await observed.count()).toBe(0)
    expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
    expect(await runtime.runs()).toEqual([])
    await expect(access(join(root, '.craft-hub', 'project.jsonc'))).rejects.toThrow()
  }
  finally { await observed.close() }
})

it('publishes followed content and status transitions once while retaining team errors', async () => {
  let revision = 'first'
  let denied = false
  const { runtime } = await runtimeFixture({ workspaceRepositoryProviders: [{
    id: 'fixture',
    name: 'Fixture',
    accepts: () => true,
    read: async (url) => {
      if (denied)
        throw new Error('Repository temporarily unavailable')
      return { repository: url, branch: 'main', directory: '.craft-hub', revision, files: { 'source.json': JSON.stringify({ schemaVersion: 1, id: 'source', name: 'Shared Team', workspaces: [{ schemaVersion: 1, id: 'app', name: revision, members: [] }] }) } }
    },
  }] })
  const team = await runtime.workspaceSubscriptions.joinTeam('https://example.com/team')
  const observed = await observeSync(runtime)
  try {
    await observed.sync()
    expect(await observed.count()).toBe(1)
    await observed.sync()
    expect(await observed.count()).toBe(1)
    revision = 'second'
    await observed.sync()
    expect(await observed.count()).toBe(2)
    expect((await runtime.workspaces.list(team.id))[0]?.name).toBe('second')
    denied = true
    expect(await observed.sync()).toMatchObject({ teams: [{ error: 'Repository temporarily unavailable' }] })
    expect(await observed.count()).toBe(3)
    await observed.sync()
    expect(await observed.count()).toBe(3)
    expect((await runtime.workspaces.list(team.id))[0]?.name).toBe('second')
    denied = false
    await observed.sync()
    expect(await observed.count()).toBe(4)
    await observed.sync()
    expect(await observed.count()).toBe(4)
  }
  finally { await observed.close() }
})

it('publishes cloud changes and error recovery without treating successful timestamps as invalidations', async () => {
  const { runtime: cloud } = await runtimeFixture()
  let failure = false
  const provider: AccountSyncProvider = {
    read: () => {
      if (failure)
        throw new Error('Cloud temporarily unavailable')
      return cloud.accountSync.envelope('fixture-account')
    },
    write: (configuration, revision) => cloud.accountSync.accept('fixture-account', configuration, revision),
  }
  const { runtime } = await runtimeFixture({ plugins: [{ id: 'account', accountProvider: { id: 'fixture', displayName: 'Fixture', mode: 'local', required: false, status: async () => undefined, sync: provider } }] })
  const observed = await observeSync(runtime)
  try {
    expect(await observed.sync()).toMatchObject({ state: 'synced' })
    expect(await observed.count()).toBe(1)
    runtime.accountSync.status.lastSyncedAt = '2000-01-01T00:00:00.000Z'
    const unchanged = await observed.sync()
    expect(unchanged.lastSyncedAt).not.toBe('2000-01-01T00:00:00.000Z')
    expect(await observed.count()).toBe(1)
    await cloud.workspaces.create('Cloud change')
    await observed.sync()
    expect(await observed.count()).toBe(2)
    expect((await runtime.workspaces.list()).map(item => item.name)).toEqual(['Cloud change'])
    failure = true
    expect(await observed.sync()).toMatchObject({ state: 'error', error: 'Cloud temporarily unavailable' })
    expect(await observed.count()).toBe(3)
    await observed.sync()
    expect(await observed.count()).toBe(3)
    failure = false
    expect(await observed.sync()).toMatchObject({ state: 'synced' })
    expect(await observed.count()).toBe(4)
    await observed.sync()
    expect(await observed.count()).toBe(4)
    await runtime.workspaces.create('Local edit')
    await cloud.workspaces.create('Cloud edit')
    expect(await observed.sync()).toMatchObject({ state: 'conflict' })
    expect(await observed.count()).toBe(5)
    await observed.sync()
    expect(await observed.count()).toBe(5)
    expect(await observed.sync('use-cloud')).toMatchObject({ state: 'synced' })
    expect(await observed.count()).toBe(6)
  }
  finally {
    await observed.close()
    await cloud.close()
  }
})

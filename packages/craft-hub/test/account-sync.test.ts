import type { AccountSyncProvider } from '../src/account-sync'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'

const runtimes: CraftHubRuntime[] = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.close()))
})
async function fixture(provider?: AccountSyncProvider): Promise<CraftHubRuntime> {
  const root = await mkdtemp(join(tmpdir(), 'account-sync-'))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), plugins: provider ? [{ id: 'account', accountProvider: { id: 'test', displayName: 'Test', mode: 'local', required: false, status: async () => undefined, sync: provider } }] : [] })
  runtimes.push(runtime)
  return runtime
}
function transport(cloud: CraftHubRuntime): AccountSyncProvider {
  return { read: () => cloud.accountSync.envelope('alice'), write: (configuration, revision) => cloud.accountSync.accept('alice', configuration, revision) }
}

describe('portable account synchronization', () => {
  it('automatically uploads, downloads and preserves a second device edit with CAS', async () => {
    const cloud = await fixture()
    const first = await fixture(transport(cloud))
    const second = await fixture(transport(cloud))
    await first.workspaces.create('Research')
    expect((await first.accountSync.synchronize()).state).toBe('synced')
    expect((await second.accountSync.synchronize()).state).toBe('synced')
    expect((await second.workspaces.list()).map(item => item.name)).toEqual(['Research'])
    const old = await cloud.accountSync.envelope('alice')
    await second.workspaces.create('Design')
    expect((await second.accountSync.synchronize()).state).toBe('synced')
    await expect(cloud.accountSync.accept('alice', old.configuration, old.revision)).rejects.toThrow('Cloud configuration changed')
    expect((await first.accountSync.synchronize()).state).toBe('synced')
    expect(await first.workspaces.list()).toHaveLength(2)
  })

  it('preserves both conflicting versions, offers explicit resolution and does not sync credentials', async () => {
    const cloud = await fixture()
    const first = await fixture(transport(cloud))
    const second = await fixture(transport(cloud))
    await first.workspaces.create('Shared')
    await first.accountSync.synchronize()
    await second.accountSync.synchronize()
    await first.workspaces.create('One')
    await second.workspaces.create('Two')
    await first.accountSync.synchronize()
    expect((await second.accountSync.synchronize()).state).toBe('conflict')
    expect(await second.workspaces.list()).toHaveLength(2)
    expect(await second.accountSync.conflict()).toMatchObject({ local: { schemaVersion: 1 }, cloud: { schemaVersion: 1 } })
    expect((await second.accountSync.synchronize('use-cloud')).state).toBe('synced')
    expect((await second.workspaces.list()).map(item => item.name)).toEqual(['Shared', 'One'])
    const document = await second.accountSync.snapshot()
    const bad = { ...document, credentials: { token: 'forbidden' } }
    await expect(cloud.accountSync.accept('alice', bad, (await cloud.accountSync.envelope('alice')).revision)).rejects.toThrow()
    expect(JSON.stringify(document)).not.toContain('token')
  })

  it('recovers interrupted application and refuses to mix different accounts', async () => {
    const cloud = await fixture()
    let account = 'alice'
    const first = await fixture({ ...transport(cloud), read: () => cloud.accountSync.envelope(account) })
    await first.workspaces.create('Saved')
    await first.accountSync.synchronize()
    const before = await first.accountSync.snapshot()
    await writeFile(join(first.store.dataDir, 'account-sync-recovery.json'), JSON.stringify(before))
    await first.workspaces.create('Interrupted')
    await first.accountSync.recover()
    expect((await first.workspaces.list()).map(item => item.name)).toEqual(['Saved'])
    account = 'bob'
    expect(await first.accountSync.synchronize()).toMatchObject({ state: 'error', error: expect.stringContaining('Account changed') })
    expect(await readFile(join(first.store.dataDir, 'account-sync-state.json'), 'utf8')).toContain('alice')
  })
})

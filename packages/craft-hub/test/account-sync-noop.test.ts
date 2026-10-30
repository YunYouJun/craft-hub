import type { AccountSyncProvider } from '../src/account-sync'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'

it('retains the saved sync file when a successful cycle has the same account and portable base', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-sync-noop-'))
  const cloud = new CraftHubRuntime({ dataDir: join(root, 'cloud-data'), configDir: join(root, 'cloud-config') })
  const sync: AccountSyncProvider = { read: () => cloud.accountSync.envelope('fixture-account'), write: (configuration, revision) => cloud.accountSync.accept('fixture-account', configuration, revision) }
  const local = new CraftHubRuntime({ dataDir: join(root, 'local-data'), configDir: join(root, 'local-config'), plugins: [{ id: 'account', accountProvider: { id: 'fixture', displayName: 'Fixture', mode: 'local', required: false, status: async () => undefined, sync } }] })
  try {
    await local.accountSync.synchronize()
    const saved = join(local.store.dataDir, 'account-sync-state.json')
    const before = await stat(saved, { bigint: true })
    const content = await readFile(saved, 'utf8')
    await local.accountSync.synchronize()
    const after = await stat(saved, { bigint: true })
    expect(await readFile(saved, 'utf8')).toBe(content)
    expect(after.ino).toBe(before.ino)
    expect(after.mtimeNs).toBe(before.mtimeNs)
    await cloud.workspaces.create('Changed')
    await local.accountSync.synchronize()
    expect(await readFile(saved, 'utf8')).not.toBe(content)
  }
  finally {
    await local.close()
    await cloud.close()
  }
})

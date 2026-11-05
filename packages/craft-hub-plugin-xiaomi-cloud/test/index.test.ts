import type { CloudNote, CloudSession, XiaomiCloudPlugin, XiaomiCloudTransport } from '../src/index'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../../craft-hub/src/runtime'
import { createXiaomiCloudPlugin, XiaomiCloudError } from '../src/index'
import { cloudSession } from '../src/transport'

const context = { confirmed: true, locale: 'en' as const, integrationId: 'xiaomi-cloud' }
const plugins: XiaomiCloudPlugin[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(plugins.splice(0).map(plugin => plugin.close()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
const first: CloudNote = { id: 'one', title: '../same title', folderId: 'folder', modifiedAt: 2000, createdAt: 1000, content: '<text>First full note</text>', markdown: 'First full note', attachments: [] }
const second: CloudNote = { ...first, id: 'two', content: '<text>Second full note</text>', markdown: 'Second full note' }
async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-xiaomi-test-'))
  directories.push(dataDir)
  let stored: CloudSession | null = null
  const credentialStore = {
    read: vi.fn(async () => stored),
    save: vi.fn(async (session: CloudSession) => { stored = session }),
    clear: vi.fn(async () => { stored = null }),
  }
  const page = vi.fn<XiaomiCloudTransport['page']>().mockImplementation(async (_session, cursor) => cursor === ''
    ? { notes: [first], folders: [{ id: 'folder', title: 'Folder' }], lastPage: false, cursor: 'next', skipped: 0 }
    : { notes: [second], folders: [], lastPage: true, skipped: 1 })
  const note = vi.fn<XiaomiCloudTransport['note']>().mockImplementation(async (_session, id) => ({ ...(id === 'one' ? first : second) }))
  const plugin = createXiaomiCloudPlugin({ dataDir, transport: { page, note }, credentialStore, requestDelayMs: 0, now: () => 5000 })
  plugins.push(plugin)
  const provider = plugin.integrationProviders![0]!
  const resources = provider.resources!
  const connect = (account = '1001') => provider.connection!.update(context, { method: 'cookie', origin: 'https://i.mi.com', cookie: `userId=${account}; serviceToken=fixture-token-${account}; passToken=discard` })
  const start = async () => {
    const page = await resources.read(context, {})
    return resources.update(context, { operation: 'sync', account: page.input.account })
  }
  const finish = async () => {
    await vi.waitFor(async () => {
      expect((await resources.read(context, {})).refreshAfterMs).toBeUndefined()
    })
    return resources.read(context, {})
  }
  return { dataDir, plugin, provider, resources, connect, start, finish, credentialStore, page, note }
}

describe('xiaomi cloud host plugin', () => {
  it('discovers without network, credentials or project trust changes; requires confirmation for all mutations', async () => {
    const { dataDir, plugin, page, credentialStore } = await setup()
    const runtime = new CraftHubRuntime({ dataDir: join(dataDir, 'runtime'), plugins: [plugin] })
    try {
      const project = await runtime.projects.add(dataDir)
      const integrations = await runtime.integrationContributions()
      expect(integrations.diagnostics).toEqual([])
      expect(integrations.integrations.find(item => item.id === 'xiaomi-cloud')?.views[0]).toMatchObject({ scope: 'global', rendering: 'web' })
      expect(page).not.toHaveBeenCalled()
      expect(credentialStore.read).not.toHaveBeenCalled()
      await expect(runtime.invokeIntegrationAction({ integrationId: 'xiaomi-cloud', actionId: 'connect', input: { method: 'disconnect' } })).rejects.toThrow(/confirmation/i)
      await expect(runtime.invokeIntegrationAction({ integrationId: 'xiaomi-cloud', actionId: 'sync', input: { operation: 'sync' } })).rejects.toThrow(/confirmation/i)
      expect(credentialStore.clear).not.toHaveBeenCalled()
      expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
      expect(await runtime.store.listRuns()).toEqual([])
    }
    finally { await runtime.close() }
  })

  it('validates before saving; status never echoes secrets or starts sync', async () => {
    const { connect, provider, page, credentialStore, dataDir } = await setup()
    expect(await provider.connectionStatus(context)).toMatchObject({ connected: false })
    expect(page).not.toHaveBeenCalled()
    const status = await connect()
    expect(status).toMatchObject({ connected: true, accountLabel: '1001' })
    expect(status.forms?.[0]?.browserAuthorization).toMatchObject({ url: 'https://i.mi.com/note/h5', cookieNames: ['userId', 'serviceToken', 'i.mi.com_serviceToken'] })
    expect(JSON.stringify(status)).not.toMatch(/fixture-token|passToken|discard/)
    expect(credentialStore.save).toHaveBeenCalledExactlyOnceWith(cloudSession('userId=1001; serviceToken=fixture-token-1001', 'https://i.mi.com'))
    expect(await readdir(dataDir)).toEqual([])
    await provider.connectionStatus(context)
    expect(page).toHaveBeenCalledTimes(1)
    page.mockRejectedValueOnce(new XiaomiCloudError('authorization'))
    await expect(connect('2002')).rejects.toThrow(/sign-in expired/)
    expect(credentialStore.save).toHaveBeenCalledTimes(1)
    expect(await provider.connectionStatus(context)).toMatchObject({ accountLabel: '1001' })
  })

  it('paginates, exports full text with safe filenames, filters locally and reuses unchanged content', async () => {
    const { connect, start, finish, resources, page, note, dataDir } = await setup()
    await connect()
    await start()
    const result = await finish()
    expect(result.entities?.map(item => item.id)).toEqual(['one', 'two'])
    expect(result.description).toContain('1 unsupported')
    const selected = await resources.read(context, result.links!.find(link => link.entityId === 'two')!.input)
    expect(selected.documents?.[0]?.content).toContain('Second full note')
    expect(selected.documents?.[0]?.filename).toMatch(/^[\da-f]{64}\.md$/)
    const filtered = await resources.read(context, { query: 'Second', folder: 'folder' })
    expect(filtered.entities?.map(item => item.id)).toEqual(['two'])
    const accountDirectories = await readdir(join(dataDir, 'integrations/xiaomi-cloud/backups'))
    const root = join(dataDir, 'integrations/xiaomi-cloud/backups', accountDirectories[0]!)
    const pointer = JSON.parse(await readFile(join(root, 'current.json'), 'utf8')) as { directory: string }
    const exportDirectory = join(root, pointer.directory, 'notes')
    expect(await readdir(exportDirectory)).toHaveLength(2)
    const filename = (await readdir(exportDirectory))[0]!
    expect((await stat(join(exportDirectory, filename))).mode & 0o777).toBe(0o600)
    expect(await readFile(join(root, pointer.directory, 'snapshot.json'), 'utf8')).not.toContain('fixture-token')
    note.mockClear()
    page.mockClear()
    await start()
    await finish()
    expect(page).toHaveBeenCalledTimes(2)
    expect(note).not.toHaveBeenCalled()
    expect((await readdir(root)).filter(name => name.startsWith('snapshot-'))).toHaveLength(2)
  })

  it('preserves the complete snapshot on failed details and repeated cursors; retries update and delete only in the next generation', async () => {
    const { connect, start, finish, page, note, resources } = await setup()
    await connect()
    await start()
    await finish()
    const changed = { ...first, modifiedAt: 3000 }
    page.mockResolvedValue({ notes: [changed], folders: [], lastPage: true, skipped: 0 })
    note.mockRejectedValueOnce(new Error('secret-in-provider-error'))
    await start()
    const failed = await finish()
    expect(failed.entities).toHaveLength(2)
    expect(failed.description).toContain('unavailable')
    expect(JSON.stringify(failed)).not.toContain('secret-in-provider-error')
    note.mockResolvedValue({ ...changed, markdown: 'Updated content' })
    await start()
    expect((await finish()).entities?.map(item => item.id)).toEqual(['one'])
    expect((await resources.read(context, { noteId: 'one' })).documents?.[0]?.content).toContain('Updated content')
    page.mockResolvedValue({ notes: [], folders: [], lastPage: false, cursor: 'repeated', skipped: 0 })
    await start()
    expect((await finish()).entities).toHaveLength(1)
    expect((await finish()).description).toContain('unsupported response')
  })

  it('isolates accounts and regions, rejects stale actions and removes only credentials on disconnect', async () => {
    const { connect, start, finish, resources, provider, credentialStore } = await setup()
    await connect()
    await start()
    const previous = await finish()
    await connect('2002')
    expect((await resources.read(context, {})).entities).toEqual([])
    await expect(resources.update(context, { operation: 'sync', account: previous.input.account })).rejects.toThrow(/account changed/)
    await expect(resources.read(context, previous.links![0]!.input)).rejects.toThrow(/account changed/)
    await connect()
    expect((await resources.read(context, {})).entities).toHaveLength(2)
    await provider.connection!.update(context, { method: 'disconnect' })
    expect(credentialStore.clear).toHaveBeenCalledOnce()
    expect(await provider.connectionStatus(context)).toMatchObject({ connected: false })
    expect((await resources.read(context, {})).entities).toEqual([])
    await connect()
    expect((await resources.read(context, {})).entities).toHaveLength(2)
  })

  it('rejects hosted access and direct unconfirmed writes without touching the vault or network', async () => {
    const { provider, resources, credentialStore, page } = await setup()
    expect(await provider.connectionStatus({ hostEnvironment: 'hosted' })).toMatchObject({ connected: false })
    await expect(resources.read({ hostEnvironment: 'hosted' }, {})).rejects.toThrow(/local host/)
    await expect(resources.update({ confirmed: false }, { operation: 'sync' })).rejects.toThrow(/Confirm/)
    await expect(provider.connection!.update({ confirmed: false }, { method: 'disconnect' })).rejects.toThrow(/Confirm/)
    expect(credentialStore.read).not.toHaveBeenCalled()
    expect(credentialStore.clear).not.toHaveBeenCalled()
    expect(page).not.toHaveBeenCalled()
  })

  it('deduplicates running syncs and aborts and joins a job before disconnect or host shutdown', async () => {
    const { connect, start, resources, provider, page, plugin } = await setup()
    await connect()
    let activeSignal: AbortSignal | undefined
    page.mockImplementation(async (_session, _cursor, signal) => {
      activeSignal = signal
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
    })
    await start()
    await vi.waitFor(() => expect(activeSignal).toBeDefined())
    const calls = page.mock.calls.length
    await start()
    expect(page).toHaveBeenCalledTimes(calls)
    await provider.connection!.update(context, { method: 'disconnect' })
    expect(activeSignal?.aborted).toBe(true)
    expect((await resources.read(context, {})).entities).toEqual([])
    await plugin.close()
  })

  it('serializes account changes so a rejected later login preserves the last saved connection', async () => {
    const { connect, credentialStore, page, provider } = await setup()
    let release: (() => void) | undefined
    credentialStore.save.mockImplementationOnce(async () => new Promise<void>((resolve) => {
      release = resolve
    }))
    const firstLogin = connect('1001')
    await vi.waitFor(() => expect(release).toBeDefined())
    page.mockRejectedValueOnce(new XiaomiCloudError('authorization'))
    const secondLogin = connect('2002')
    const failed = expect(secondLogin).rejects.toThrow(/sign-in expired/)
    release!()
    expect(await firstLogin).toMatchObject({ accountLabel: '1001' })
    await failed
    expect(credentialStore.save).toHaveBeenCalledTimes(1)
    expect(await provider.connectionStatus(context)).toMatchObject({ accountLabel: '1001' })
  })

  it('host shutdown cancels an in-flight connection probe without persisting a credential', async () => {
    const { connect, credentialStore, page, plugin } = await setup()
    let activeSignal: AbortSignal | undefined
    page.mockImplementation(async (_session, _cursor, signal) => {
      activeSignal = signal
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
    })
    const connecting = connect()
    const rejected = expect(connecting).rejects.toThrow()
    await vi.waitFor(() => expect(activeSignal).toBeDefined())
    await plugin.close()
    await rejected
    expect(activeSignal?.aborted).toBe(true)
    expect(credentialStore.save).not.toHaveBeenCalled()
  })
})

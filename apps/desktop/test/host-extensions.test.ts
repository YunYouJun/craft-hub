import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostExtensionManager } from '../../../packages/craft-hub/src/host-extensions'
import { findLocalHostExtension, prepareDesktopHostExtension, registerHostExtensionHandlers } from '../src/host-extensions'

const { handlers, showMessageBox, showOpenDialog } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<unknown>>(),
  showMessageBox: vi.fn(),
  showOpenDialog: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: (...args: any[]) => Promise<unknown>) => handlers.set(name, handler) },
  dialog: { showMessageBox, showOpenDialog },
}))

const roots: string[] = []
afterEach(async () => {
  handlers.clear()
  vi.resetAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'craft-desktop-host-'))
  roots.push(root)
  const modulePath = join(root, 'host.mjs')
  await writeFile(modulePath, 'throw new Error("must not execute during install")')
  const manifestPath = join(root, 'distribution.json')
  await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, distribution: { id: 'acme', name: 'Acme' }, hostPlugins: ['./host.mjs'], desktop: { protocol: 'acme', artifactName: 'Acme' } }))
  const manager = new HostExtensionManager(join(root, 'data'))
  return { root, manifestPath, modulePath, manager }
}

describe('desktop host extension installation', () => {
  it('finds the parent distribution of a linked plugin without loading executable code', async () => {
    const { root, manager, manifestPath, modulePath } = await fixture()
    const directory = join(root, 'plugins', 'example')
    await mkdir(directory, { recursive: true })
    expect(await findLocalHostExtension(manager, directory)).toEqual({ id: 'acme', name: 'Acme', enabled: true, manifestPath, modules: [modulePath] })
    await expect(access(manager.path)).rejects.toThrow()
    await rm(modulePath)
    await expect(prepareDesktopHostExtension(manager, manifestPath)).rejects.toThrow()
  })

  it('requires native trust before persisting local plugin dependencies and rejects other frames', async () => {
    const { root, manager } = await fixture()
    const webContents = { mainFrame: {} }
    const window = { webContents }
    const event = { sender: webContents, senderFrame: webContents.mainFrame }
    const localPluginPath = vi.fn(async () => root)
    registerHostExtensionHandlers({ manager, window: () => window as never, restart: vi.fn(), localPluginPath })
    const configure = handlers.get('craft-hub:configure-local-plugin-host')!
    showMessageBox.mockResolvedValue({ response: 0 })
    await configure(event, 'acme-ui')
    expect((await manager.status()).extensions).toEqual([])
    showMessageBox.mockResolvedValue({ response: 1 })
    await configure(event, 'acme-ui')
    expect((await manager.status()).extensions).toHaveLength(1)
    expect(localPluginPath).toHaveBeenCalledWith('acme-ui')
    showMessageBox.mockClear()
    await configure(event, 'acme-ui')
    expect(showMessageBox).not.toHaveBeenCalled()
    await expect(configure({ ...event, senderFrame: {} }, 'acme-ui')).rejects.toThrow(/main desktop window/)
    expect((await manager.status()).extensions).toHaveLength(1)
  })

  it('saves optional bundled choices without treating them as installed extensions', async () => {
    const { manager } = await fixture()
    const webContents = { mainFrame: {} }
    const event = { sender: webContents, senderFrame: webContents.mainFrame }
    const optionalBundledExtensions = vi.fn(async () => [{ id: 'microsoft-todo', name: 'Microsoft To Do', version: '0.1.0', optional: true, enabled: await manager.bundledChoice('microsoft-todo') ?? false }])
    registerHostExtensionHandlers({ manager, window: () => ({ webContents }) as never, restart: vi.fn(), localPluginPath: vi.fn(), bundledExtensions: [{ id: 'workstation', name: 'Workstation', version: '1.0.0' }], optionalBundledExtensions })
    const status = await handlers.get('craft-hub:set-host-extension-enabled')!(event, 'microsoft-todo', true) as Awaited<ReturnType<HostExtensionManager['status']>>
    expect(await manager.bundledChoice('microsoft-todo')).toBe(true)
    expect(status.extensions).toEqual([])
    expect(status.bundledExtensions?.map(item => `${item.id}:${item.enabled ?? 'fixed'}`)).toEqual(['workstation:fixed', 'microsoft-todo:true'])
    // An id that is neither installed nor optional still fails instead of creating state.
    await expect(handlers.get('craft-hub:set-host-extension-enabled')!(event, 'unknown', true)).rejects.toThrow(/not installed/)
  })
})

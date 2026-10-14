import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

async function loadUpdateBridge() {
  const invoke = vi.fn(async () => ({ phase: 'downloaded' }))
  const on = vi.fn()
  const removeListener = vi.fn()
  let bridge!: {
    checkForUpdates: () => Promise<unknown>
    installUpdate: () => Promise<unknown>
    onUpdateStatus: (callback: (status: unknown) => void) => () => void
    setAutomaticUpdates: (enabled: boolean) => Promise<unknown>
    updateStatus: () => Promise<unknown>
  }
  runInNewContext(await readFile(new URL('../preload.cjs', import.meta.url), 'utf8'), {
    process: { platform: 'darwin' },
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name: string, value: typeof bridge) => bridge = value },
      ipcRenderer: { invoke, on, removeListener },
    }),
  })
  return { bridge, invoke, on, removeListener }
}

describe('desktop updater preload bridge', () => {
  it('routes update actions to dedicated IPC channels', async () => {
    const { bridge, invoke } = await loadUpdateBridge()
    await bridge.updateStatus()
    await bridge.setAutomaticUpdates(false)
    await bridge.checkForUpdates()
    await bridge.installUpdate()

    expect(invoke.mock.calls).toEqual([
      ['craft-hub:update-status'],
      ['craft-hub:set-automatic-updates', false],
      ['craft-hub:check-for-updates'],
      ['craft-hub:install-update'],
    ])
  })

  it('forwards only update status and removes the same listener on unsubscribe', async () => {
    const { bridge, on, removeListener } = await loadUpdateBridge()
    const callback = vi.fn()
    const unsubscribe = bridge.onUpdateStatus(callback)
    const [channel, listener] = on.mock.calls[0] as unknown as [string, (event: unknown, status: unknown) => void]
    const status = { automaticCheck: false, currentVersion: '0.0.1005', phase: 'downloaded', releaseName: '0.0.1-alpha.6' }
    listener({ sender: 'main' }, status)

    expect(channel).toBe('craft-hub:update-status-changed')
    expect(callback).toHaveBeenCalledExactlyOnceWith(status)
    unsubscribe()
    expect(removeListener).toHaveBeenCalledExactlyOnceWith(channel, listener)
  })
})

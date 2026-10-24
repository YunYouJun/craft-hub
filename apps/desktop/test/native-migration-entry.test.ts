import { afterEach, expect, it, vi } from 'vitest'
import { createNativeMigrationEntry, inspectDesktopMigrationGate, nativeMigrationArgument, selectDesktopHostMode } from '../src/native-migration-entry.ts'

const native = vi.hoisted(() => ({ inspect: vi.fn(), message: vi.fn() }))
vi.mock('craft-hub', () => ({ inspectProfileMigrationGuard: native.inspect }))
vi.mock('electron', () => ({ dialog: { showMessageBox: native.message } }))
vi.mock('../src/identity-source-context.ts', () => ({ identitySourceContext: () => ({ name: 'Fixture', sourceData: '/fixture/data', sourceConfig: '/fixture/config' }) }))
afterEach(() => vi.resetAllMocks())

it('enters normal startup only when both source roots have no migration guard', async () => {
  expect(await selectDesktopHostMode([], 'darwin')).toEqual({ kind: 'desktop' })
  expect(native.inspect.mock.calls.map(([path]) => path)).toEqual(['/fixture/data', '/fixture/config'])
  native.inspect.mockReset().mockImplementation(async root => root.endsWith('config') ? { root, version: 1, transaction: '/fixture/transaction', state: 'pending' } : undefined)
  expect(await selectDesktopHostMode([], 'darwin')).toEqual({ kind: 'migration', gate: { status: 'guarded', transaction: '/fixture/transaction', state: 'pending' } })
})

it('pins a shared recovery transaction and refuses conflicting or unreadable guards', async () => {
  native.inspect.mockImplementation(async root => ({ root, version: 1, transaction: '/fixture/transaction', state: root.endsWith('config') ? 'pending' : 'source-retained' }))
  expect(await inspectDesktopMigrationGate()).toEqual({ status: 'guarded', transaction: '/fixture/transaction', state: 'pending' })
  native.inspect.mockImplementation(async root => ({ root, version: 1, transaction: `${root}/transaction`, state: 'pending' }))
  expect(await selectDesktopHostMode([], 'darwin')).toEqual({ kind: 'migration', gate: { status: 'unavailable' } })
  native.inspect.mockRejectedValue(new Error('malformed guard'))
  expect(await inspectDesktopMigrationGate()).toEqual({ status: 'unavailable' })
})

it('keeps private maintenance available for recovery and rejects conflicting modes', async () => {
  expect(await selectDesktopHostMode(['--craft-hub-native-identity-transfer'], 'darwin')).toEqual({ kind: 'identity-transfer' })
  expect(native.inspect).not.toHaveBeenCalled()
  await expect(selectDesktopHostMode(['--craft-hub-native-identity-transfer', nativeMigrationArgument], 'darwin')).rejects.toThrow('Conflicting')
  expect(native.inspect).not.toHaveBeenCalled()
  expect(await selectDesktopHostMode([nativeMigrationArgument], 'darwin')).toEqual({ kind: 'migration', gate: { status: 'clear' } })
})

it.each(['linux', 'win32'] as const)('preserves ordinary %s startup and refuses the macOS-only wizard', async (platform) => {
  expect(await selectDesktopHostMode([], platform)).toEqual({ kind: 'desktop' })
  await expect(selectDesktopHostMode([nativeMigrationArgument], platform)).rejects.toThrow('macOS')
  expect(native.inspect).not.toHaveBeenCalled()
})

it('requires the native restart choice and a fresh idle state after the dialog', async () => {
  const restart = vi.fn()
  const hasActiveWork = vi.fn().mockResolvedValue(false)
  const entry = createNativeMigrationEntry({ canRestart: () => true, hasActiveWork, restart })
  native.message.mockResolvedValue({ response: 0 })
  await entry()
  expect(restart).not.toHaveBeenCalled()
  expect(native.message).toHaveBeenCalledWith(expect.objectContaining({ defaultId: 0, cancelId: 0 }))
  native.message.mockResolvedValue({ response: 1 })
  hasActiveWork.mockReset().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  await entry()
  expect(restart).not.toHaveBeenCalled()
  hasActiveWork.mockReset().mockResolvedValue(false)
  await entry()
  expect(restart).toHaveBeenCalledOnce()
})

it('refuses active work and coalesces repeated menu requests while a dialog is open', async () => {
  const restart = vi.fn()
  const hasActiveWork = vi.fn().mockResolvedValue(true)
  const entry = createNativeMigrationEntry({ canRestart: () => true, hasActiveWork, restart })
  native.message.mockResolvedValue({ response: 1 })
  await entry()
  expect(restart).not.toHaveBeenCalled()
  native.message.mockReset()
  hasActiveWork.mockResolvedValue(false)
  let finish!: (value: { response: number }) => void
  native.message.mockImplementation(() => new Promise(resolve => finish = resolve))
  const first = entry()
  await vi.waitFor(() => expect(native.message).toHaveBeenCalledOnce())
  await entry()
  expect(native.message).toHaveBeenCalledOnce()
  finish({ response: 0 })
  await first
  expect(restart).not.toHaveBeenCalled()
})

it('does not relaunch after another shutdown begins during review', async () => {
  let ready = true
  const restart = vi.fn()
  native.message.mockImplementation(async () => {
    ready = false
    return { response: 1 }
  })
  await createNativeMigrationEntry({ canRestart: () => ready, hasActiveWork: async () => false, restart })()
  expect(restart).not.toHaveBeenCalled()
})

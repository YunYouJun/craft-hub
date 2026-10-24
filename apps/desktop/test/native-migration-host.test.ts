import { access, stat } from 'node:fs/promises'
import process from 'node:process'
import { afterEach, expect, it, vi } from 'vitest'
import { chooseNativeMigration, prepareNativeMigrationHost } from '../src/native-migration-host.ts'

const native = vi.hoisted(() => ({ message: vi.fn(), open: vi.fn(), inspect: vi.fn(), coordinate: vi.fn(), vault: vi.fn(class {}), setPath: vi.fn(), ready: vi.fn(), exit: vi.fn(), confirm: vi.fn(), result: vi.fn(), chooseData: vi.fn(), coordinateData: vi.fn(), confirmData: vi.fn(), dataResult: vi.fn(), launcher: vi.fn() }))
vi.mock('electron', () => ({
  app: { getPath: () => '/fixture/app-data', setPath: native.setPath, setName: vi.fn(), disableHardwareAcceleration: vi.fn(), isPackaged: true, whenReady: native.ready, focus: vi.fn(), on: vi.fn(), removeListener: vi.fn(), exit: native.exit },
  dialog: { showMessageBox: native.message, showOpenDialog: native.open },
  safeStorage: {},
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
}))
vi.mock('../src/identity-source-context.ts', () => ({ identitySourceContext: () => ({ name: 'Fixture', sourceData: '/fixture/source-data', sourceConfig: '/fixture/source-config' }) }))
vi.mock('../src/identity-migration-review.ts', () => ({ confirmIdentityMigration: native.confirm, showIdentityMigrationResult: native.result }))
vi.mock('../src/identity-transfer-recipient.ts', async original => ({ ...await original<object>(), inspectIdentityRecipient: native.inspect }))
vi.mock('../src/identity-migration.ts', () => ({ coordinateIdentityMigration: native.coordinate }))
vi.mock('../src/device-vault.ts', () => ({ DeviceVault: native.vault }))
vi.mock('../src/identity-launcher.ts', () => ({ identityLauncher: native.launcher }))
vi.mock('../src/data-migration.ts', () => ({ coordinateDataMigration: native.coordinateData }))
vi.mock('../src/data-migration-dialogs.ts', () => ({ chooseDataMigration: native.chooseData, confirmDataMigration: native.confirmData, showDataMigrationResult: native.dataResult }))
afterEach(() => vi.resetAllMocks())
const signal = (): AbortSignal => new AbortController().signal

it('does not select an app or access a vault when cancelled or the startup guard is unreadable', async () => {
  native.message.mockResolvedValue({ response: 0 })
  expect(await chooseNativeMigration({ status: 'clear' }, signal())).toBeUndefined()
  expect(await chooseNativeMigration({ status: 'unavailable' }, signal())).toBeUndefined()
  expect(native.open).not.toHaveBeenCalled()
  expect(native.inspect).not.toHaveBeenCalled()
  expect(native.vault).not.toHaveBeenCalled()
  expect(native.coordinate).not.toHaveBeenCalled()
})

it('offers data-only navigation only when no identity guard pins the source', async () => {
  native.message.mockResolvedValue({ response: 4 })
  const command = { version: 1, action: 'migrate-data', targetProfile: '/fixture/native' }
  native.chooseData.mockResolvedValue(command)
  expect(await chooseNativeMigration({ status: 'clear' }, signal())).toEqual(command)
  expect(native.chooseData).toHaveBeenCalledOnce()
  expect(await chooseNativeMigration({ status: 'guarded', transaction: '/fixture/identity-transaction', state: 'pending' }, signal())).toBeUndefined()
  expect(native.chooseData).toHaveBeenCalledOnce()
  expect(native.inspect).not.toHaveBeenCalled()
  expect(native.vault).not.toHaveBeenCalled()
})

it.skipIf(process.platform !== 'darwin')('runs data-only maintenance with fixed source roots and no identity transport or vault', async () => {
  native.message.mockResolvedValue({ response: 4 })
  const command = { version: 1, action: 'migrate-data', targetProfile: '/fixture/native' }
  native.chooseData.mockResolvedValue(command)
  native.coordinateData.mockResolvedValue({ status: 'cancelled' })
  await (await prepareNativeMigrationHost({ status: 'clear' }))()
  expect(native.coordinateData).toHaveBeenCalledWith(command, expect.objectContaining({ sourceData: '/fixture/source-data', sourceConfig: '/fixture/source-config', confirm: expect.any(Function) }))
  const options = native.coordinateData.mock.calls[0]![1]
  await options.confirm({ kind: 'fixture' })
  expect(native.confirmData).toHaveBeenCalledWith({ kind: 'fixture' }, options.signal)
  expect(native.dataResult).toHaveBeenCalledWith({ status: 'cancelled' }, options.signal)
  expect(native.inspect).not.toHaveBeenCalled()
  expect(native.vault).not.toHaveBeenCalled()
  expect(native.launcher).not.toHaveBeenCalled()
  expect(native.exit).toHaveBeenCalledWith(0)
})

it('checks the selected application before asking for a destination and produces navigation only', async () => {
  native.message.mockResolvedValue({ response: 1 })
  native.open.mockResolvedValueOnce({ canceled: false, filePaths: ['/fixture/Native.app'] }).mockResolvedValueOnce({ canceled: false, filePaths: ['/fixture/native'] })
  const command = await chooseNativeMigration({ status: 'clear' }, signal())
  expect(command).toEqual({ version: 1, action: 'migrate', application: '/fixture/Native.app', targetProfile: '/fixture/native' })
  expect(native.inspect.mock.invocationCallOrder[0]).toBeLessThan(native.open.mock.invocationCallOrder[1]!)
  expect(native.open.mock.calls[1]![0].properties).toEqual(['openDirectory', 'createDirectory'])
  expect(native.vault).not.toHaveBeenCalled()
  expect(native.coordinate).not.toHaveBeenCalled()
})

it('rejects an unsupported signed pair without selecting or creating a destination', async () => {
  native.message.mockResolvedValue({ response: 1 })
  native.open.mockResolvedValue({ canceled: false, filePaths: ['/fixture/Native.app'] })
  native.inspect.mockRejectedValue(new Error('unsupported pair'))
  await expect(chooseNativeMigration({ status: 'clear' }, signal())).rejects.toThrow('unsupported pair')
  expect(native.open).toHaveBeenCalledOnce()
  expect(native.vault).not.toHaveBeenCalled()
})

it.each([{ response: 1, action: 'recover' }, { response: 2, action: 'rollback' }])('pins guarded $action to the source-owned transaction', async ({ response, action }) => {
  native.message.mockResolvedValue({ response })
  native.open.mockResolvedValue({ canceled: false, filePaths: ['/fixture/Native.app'] })
  const command = await chooseNativeMigration({ status: 'guarded', transaction: '/fixture/transaction', state: 'source-retained' }, signal())
  expect(command).toEqual({ version: 1, action, application: '/fixture/Native.app', transaction: '/fixture/transaction' })
  expect(native.open).toHaveBeenCalledOnce()
  expect(native.message).toHaveBeenCalledWith(expect.objectContaining({ defaultId: 0, buttons: ['关闭', '恢复已有迁移…', '回退已有迁移…'] }))
})

it.each([2, 3])('lets an unguarded source select an existing transaction for operation %s', async (response) => {
  native.message.mockResolvedValue({ response })
  native.open.mockResolvedValueOnce({ canceled: false, filePaths: ['/fixture/Native.app'] }).mockResolvedValueOnce({ canceled: false, filePaths: ['/fixture/transaction'] })
  expect(await chooseNativeMigration({ status: 'clear' }, signal())).toEqual({ version: 1, action: response === 2 ? 'recover' : 'rollback', application: '/fixture/Native.app', transaction: '/fixture/transaction' })
})

it('discards a selection returned after cancellation and never turns it into approval', async () => {
  const abort = new AbortController()
  native.message.mockResolvedValue({ response: 1 })
  native.open.mockImplementation(async () => {
    abort.abort()
    return { canceled: false, filePaths: ['/fixture/Native.app'] }
  })
  expect(await chooseNativeMigration({ status: 'clear' }, abort.signal)).toBeUndefined()
  expect(native.inspect).not.toHaveBeenCalled()
  expect(native.coordinate).not.toHaveBeenCalled()
})

it.skipIf(process.platform !== 'darwin')('isolates Chromium before readiness and cleans cancelled maintenance without accessing identity', async () => {
  native.message.mockResolvedValue({ response: 0 })
  const run = await prepareNativeMigrationHost({ status: 'clear' })
  const temporary = native.setPath.mock.calls[0]![1] as string
  expect(native.setPath.mock.calls).toEqual([['userData', temporary], ['sessionData', temporary]])
  expect((await stat(temporary)).mode & 0o777).toBe(0o700)
  expect(native.ready).not.toHaveBeenCalled()
  await run()
  expect(native.exit).toHaveBeenCalledWith(0)
  expect(native.vault).not.toHaveBeenCalled()
  expect(native.coordinate).not.toHaveBeenCalled()
  await expect(access(temporary)).rejects.toThrow()
})

it.skipIf(process.platform !== 'darwin')('hands the native selection to the coordinator with source-owned paths and separate consent', async () => {
  native.message.mockResolvedValue({ response: 1 })
  native.open.mockResolvedValueOnce({ canceled: false, filePaths: ['/fixture/Native.app'] }).mockResolvedValueOnce({ canceled: false, filePaths: ['/fixture/native'] })
  native.coordinate.mockResolvedValue({ status: 'cancelled' })
  const run = await prepareNativeMigrationHost({ status: 'clear' })
  await run()
  expect(native.coordinate).toHaveBeenCalledWith(
    { version: 1, action: 'migrate', application: '/fixture/Native.app', targetProfile: '/fixture/native' },
    expect.objectContaining({ sourceData: '/fixture/source-data', sourceConfig: '/fixture/source-config', confirm: expect.any(Function), signal: expect.any(AbortSignal) }),
  )
  expect(native.vault).toHaveBeenCalledWith('/fixture/source-data', {}, 'darwin')
  const options = native.coordinate.mock.calls[0]![1]
  const metadata = { kind: 'review-fixture' }
  await options.confirm(metadata)
  expect(native.confirm).toHaveBeenCalledWith(metadata, options.signal)
  expect(native.result).toHaveBeenCalledWith({ status: 'cancelled' })
  expect(native.exit).toHaveBeenCalledWith(0)
})

it.skipIf(process.platform !== 'darwin')('shows a bounded failure for an unsupported pair without opening secure storage', async () => {
  native.message.mockResolvedValue({ response: 1 })
  native.open.mockResolvedValue({ canceled: false, filePaths: ['/fixture/Native.app'] })
  native.inspect.mockRejectedValue(new Error('private diagnostic must not reach UI'))
  await (await prepareNativeMigrationHost({ status: 'clear' }))()
  expect(native.exit).toHaveBeenCalledWith(1)
  expect(native.coordinate).not.toHaveBeenCalled()
  expect(native.vault).not.toHaveBeenCalled()
  expect(native.message.mock.calls[1]![0].message).toBe('无法开始或继续迁移')
  expect(JSON.stringify(native.message.mock.calls)).not.toContain('private diagnostic')
})

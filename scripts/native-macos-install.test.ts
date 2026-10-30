import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { installNativeApplication, nativeBundleFingerprint, nativeProductName } from './native-macos-install.ts'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-native-install-'))
  temporary.push(root)
  const source = join(root, 'build', nativeProductName)
  const target = join(root, 'Applications', nativeProductName)
  for (const [bundle, version] of [[source, 'new'], [target, 'old']] as const) {
    for (const file of ['Contents/MacOS/CraftHubMac', 'Contents/_CodeSignature/CodeResources', 'Contents/Resources/app/apps/desktop/dist/sidecar.mjs', 'Contents/Resources/app/apps/web/dist/index.html']) {
      await mkdir(dirname(join(bundle, file)), { recursive: true })
      await writeFile(join(bundle, file), version)
    }
  }
  const profile = join(root, 'profile', 'draft.json')
  await mkdir(dirname(profile))
  await writeFile(profile, 'retained draft')
  const operations = {
    copy: vi.fn(async (from: string, to: string) => cp(from, to, { recursive: true })),
    verify: vi.fn(async (_bundle: string) => {}),
    stop: vi.fn(async (_bundle: string) => true),
    launch: vi.fn(async (bundle: string) => ({ pid: 42, executable: join(bundle, 'Contents/MacOS/CraftHubMac'), startedAt: 123 })),
  }
  return { root, source, target, profile, operations }
}

it('replaces the installed app, launches that exact location and retains the previous bundle and receipt', async () => {
  const { source, target, profile, operations } = await fixture()
  const expected = await nativeBundleFingerprint(source)
  const old = await nativeBundleFingerprint(target)
  const result = await installNativeApplication(source, target, operations)
  expect(await nativeBundleFingerprint(target)).toBe(expected)
  expect(await nativeBundleFingerprint(join(result.backupDirectory, 'previous.app'))).toBe(old)
  expect(operations.launch).toHaveBeenCalledExactlyOnceWith(target)
  expect(operations.verify.mock.invocationCallOrder[1]).toBeLessThan(operations.stop.mock.invocationCallOrder[0]!)
  expect(JSON.parse(await readFile(join(result.backupDirectory, 'installation.json'), 'utf8'))).toMatchObject({ target, fingerprint: expected, process: { pid: 42 } })
  expect(await readFile(profile, 'utf8')).toBe('retained draft')
})

it('leaves the running installation untouched when copying fails or the staged payload differs', async () => {
  for (const corrupt of [false, true]) {
    const { source, target, operations } = await fixture()
    const old = await nativeBundleFingerprint(target)
    operations.copy.mockImplementationOnce(async (from, to) => {
      if (!corrupt)
        throw new Error('copy failed')
      await cp(from, to, { recursive: true })
      await writeFile(join(to, 'Contents/Resources/app/apps/web/dist/index.html'), 'stale UI')
    })
    await expect(installNativeApplication(source, target, operations)).rejects.toThrow(corrupt ? 'differs' : 'copy failed')
    expect(await nativeBundleFingerprint(target)).toBe(old)
    expect(operations.stop).not.toHaveBeenCalled()
    expect(await readdir(dirname(target))).toEqual([nativeProductName])
  }
})

it('restores and restarts the previous installed app when the replacement cannot start its own runtime', async () => {
  const { source, target, profile, operations } = await fixture()
  const old = await nativeBundleFingerprint(target)
  operations.launch.mockRejectedValueOnce(new Error('wrong running copy'))
  await expect(installNativeApplication(source, target, operations)).rejects.toThrow('wrong running copy')
  expect(await nativeBundleFingerprint(target)).toBe(old)
  expect(operations.stop).toHaveBeenCalledTimes(2)
  expect(operations.launch.mock.calls).toEqual([[target], [target]])
  expect(await readFile(profile, 'utf8')).toBe('retained draft')
})

it('preserves both bundles if a failed replacement refuses to quit during recovery', async () => {
  const { source, target, operations } = await fixture()
  const old = await nativeBundleFingerprint(target)
  operations.launch.mockRejectedValueOnce(new Error('startup failed'))
  operations.stop.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('quit refused'))
  await expect(installNativeApplication(source, target, operations)).rejects.toThrow('bundles are preserved')
  const transaction = (await readdir(dirname(target))).find(file => file.startsWith('.craft-hub-native-install-'))!
  expect(await nativeBundleFingerprint(join(dirname(target), transaction, 'previous.app'))).toBe(old)
  expect(await nativeBundleFingerprint(target)).toBe(await nativeBundleFingerprint(source))
})

it('refuses overlapping build and install paths before touching the app', async () => {
  const { target, operations } = await fixture()
  await expect(installNativeApplication(target, target, operations)).rejects.toThrow('separate directories')
  expect(operations.copy).not.toHaveBeenCalled()
})

it('routes the local reinstall aliases and Codex Run wrapper through the same native workflow', async () => {
  const workspace = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  expect(workspace.scripts['reinstall:mac']).toBe('pnpm reinstall:macos')
  expect(workspace.scripts['reinstall:macos']).toBe('tsx scripts/reinstall-native-macos.ts')
  expect(workspace.scripts['reinstall:electron:mac']).toBe('tsx scripts/reinstall-macos.ts')
  const wrapper = await readFile(new URL('../script/build_and_run.sh', import.meta.url), 'utf8')
  expect(wrapper).toContain('exec pnpm reinstall:macos "$@"')
  expect(wrapper).not.toContain('open -n')
})

import { spawn } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, expect, it, vi } from 'vitest'
import { CodexActivityHooks } from '../src/codex-activity-hooks.ts'
import { CodexActivityMonitor } from '../src/codex-activity.ts'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-hook-review-'))
  roots.push(root)
  const codexHome = join(root, 'codex')
  const native = new CodexActivityMonitor({ codexHome, dataDir: join(root, 'native'), platform: 'darwin' })
  const electron = new CodexActivityMonitor({ codexHome, dataDir: join(root, 'electron'), platform: 'darwin' })
  return { root, codexHome, native, electron, path: join(codexHome, 'hooks.json') }
}

it('keeps both profiles active and removes only the exact reviewed profile commands', async () => {
  const { native, electron, path, codexHome } = await fixture()
  await mkdir(codexHome)
  await writeFile(path, JSON.stringify({ custom: 'keep', hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'existing-tool # craft-hub-codex-activity custom' }] }] } }))
  await electron.install()
  expect(await native.status()).toMatchObject({ installed: false, ownHookCount: 0, otherHookCount: 4 })
  await native.install()
  expect(await electron.status()).toMatchObject({ installed: true, ownHookCount: 4, otherHookCount: 4 })
  expect(await native.status()).toMatchObject({ installed: true, ownHookCount: 4, otherHookCount: 4 })
  await native.uninstall()
  expect(await electron.status()).toMatchObject({ installed: true, ownHookCount: 4, otherHookCount: 0 })
  expect(await native.status()).toMatchObject({ installed: false, ownHookCount: 0, otherHookCount: 4 })
  const document = JSON.parse(await readFile(path, 'utf8'))
  expect(document.custom).toBe('keep')
  expect(document.hooks.Stop[0]).toEqual({ matcher: '*', hooks: [{ type: 'command', command: 'existing-tool # craft-hub-codex-activity custom' }] })
  native.accept({ hook_event_name: 'UserPromptSubmit', session_id: 'disabled' })
  expect((await native.status()).runningSessionIds).toEqual([])
})

it('reviews and cancellation are read-only, one-use, bounded and expire', async () => {
  const { native, path, codexHome } = await fixture()
  const review = await native.review('install')
  await expect(access(codexHome)).rejects.toThrow()
  native.hooks.cancel(review.id)
  await expect(native.apply(review.id)).rejects.toThrow(/expired/)
  const expired = await native.review('install')
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 301_000)
  await expect(native.apply(expired.id)).rejects.toThrow(/expired/)
  vi.restoreAllMocks()
  for (let count = 0; count < 8; count++)
    await native.review('install')
  await expect(native.review('install')).rejects.toThrow(/Close/)
  native.hooks.clearReviews()
  const current = await native.review('install')
  expect(await native.apply(current.id)).toMatchObject({ installed: true, requiresTrustReview: true })
  await expect(native.apply(current.id)).rejects.toThrow(/expired/)
  expect((await stat(path)).mode & 0o777).toBe(0o600)
})

it('rejects changed hook and bridge files and preserves edits after stale reviews', async () => {
  const { native, path, codexHome } = await fixture()
  const review = await native.review('install')
  await mkdir(codexHome)
  const changed = '{"custom":"changed"}\n'
  await writeFile(path, changed)
  await expect(native.apply(review.id)).rejects.toThrow(/changed/)
  expect(await readFile(path, 'utf8')).toBe(changed)
  await native.install()
  await chmod(native.hooks.bridgePath, 0o600)
  expect(await native.status()).toMatchObject({ installed: false, ownHookCount: 4 })
  await native.install()
  const uninstall = await native.review('uninstall')
  await writeFile(native.hooks.bridgePath, '# manually changed\n')
  await expect(native.apply(uninstall.id)).rejects.toThrow(/changed/)
  expect(await readFile(native.hooks.bridgePath, 'utf8')).toBe('# manually changed\n')
  expect(await native.status()).toMatchObject({ installed: false, ownHookCount: 4 })
})

it('rejects malformed or linked configuration without overwriting it', async () => {
  const { native, path, codexHome, root } = await fixture()
  await mkdir(codexHome)
  for (const value of ['[]', '{"hooks":[]}', '{"hooks":{"Stop":[{"hooks":[null]}]}}']) {
    await writeFile(path, value)
    await expect(native.review('install')).rejects.toThrow(/structure/)
    expect(await readFile(path, 'utf8')).toBe(value)
  }
  await rm(path)
  const target = join(root, 'linked.json')
  await writeFile(target, '{}')
  await symlink(target, path)
  await expect(native.review('install')).rejects.toThrow()
  expect(await readFile(target, 'utf8')).toBe('{}')
})

it('a competing process blocks writes and exit releases the kernel-held lock', async () => {
  const { native, codexHome } = await fixture()
  await mkdir(codexHome)
  const script = `import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec('BEGIN IMMEDIATE'); console.log('ready'); process.stdin.resume()`
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, join(codexHome, '.craft-hub-hooks-lock.sqlite')], { stdio: ['pipe', 'pipe', 'pipe'], shell: false })
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', () => reject(new Error('Lock fixture exited before readiness')))
      child.stdout.once('data', data => String(data).trim() === 'ready' ? resolve() : reject(new Error('Unexpected lock fixture output')))
    })
    const review = await native.review('install')
    await expect(native.apply(review.id)).rejects.toThrow(/locked/)
    await expect(access(native.hooks.hooksPath)).rejects.toThrow()
  }
  finally {
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill('SIGTERM')
    await exited
  }
  await expect(native.install()).resolves.toMatchObject({ installed: true })
})

it('serializes competing host writes and requires re-review after the winner changes hooks', async () => {
  const { native, electron } = await fixture()
  const [a, b] = await Promise.all([native.review('install'), electron.review('install')])
  const outcomes = await Promise.allSettled([native.apply(a.id), electron.apply(b.id)])
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  await native.install()
  await electron.install()
  expect(await native.status()).toMatchObject({ installed: true, otherHookCount: 4 })
})

it('only exact generated commands are removed, including legacy commands at the same path', async () => {
  const { root, codexHome, path } = await fixture()
  const hooks = new CodexActivityHooks(codexHome, join(root, 'profile\'s data'))
  await hooks.apply((await hooks.review('install')).id)
  const before = await readFile(path, 'utf8')
  expect(before).toContain('profile')
  await writeFile(path, before.replaceAll('# craft-hub-profile-activity-v1', '# craft-hub-codex-activity'))
  expect((await hooks.status()).installed).toBe(true)
  await hooks.apply((await hooks.review('uninstall')).id)
  expect((await hooks.status()).ownHookCount).toBe(0)
  expect(await readFile(hooks.bridgePath, 'utf8')).toContain('endpoint_file=')
})

it('new native hooks survive the shipped legacy Electron marker-removal behavior', async () => {
  const { native, path } = await fixture()
  await native.install()
  const document = JSON.parse(await readFile(path, 'utf8')) as { hooks: Record<string, Array<{ hooks: Array<{ type: string, command: string }> }>> }
  // Match the old host's predicate exactly: its explicit disable operation strips the generic legacy marker.
  for (const groups of Object.values(document.hooks)) {
    for (const group of groups)
      group.hooks = group.hooks.filter(hook => !(hook.type === 'command' && hook.command.includes('# craft-hub-codex-activity')))
  }
  await writeFile(path, JSON.stringify(document))
  expect(await native.status()).toMatchObject({ installed: true, ownHookCount: 4 })
})

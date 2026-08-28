import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CodexActivityMonitor } from '../src/codex-activity.ts'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'craft-hub-codex-activity-'))
  temporaryDirectories.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('codex activity monitor', () => {
  it('merges and removes only the Craft Hub command hooks', async () => {
    const root = await temporaryDirectory()
    const codexHome = join(root, 'codex')
    const hooksPath = join(codexHome, 'hooks.json')
    await mkdir(codexHome, { recursive: true })
    await writeFile(hooksPath, JSON.stringify({
      custom: true,
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: '/usr/bin/existing-hook' }] }],
      },
    }))
    const monitor = new CodexActivityMonitor({ codexHome, dataDir: join(root, 'data'), platform: 'darwin' })

    const installed = await monitor.install()
    const document = JSON.parse(await readFile(hooksPath, 'utf8')) as any
    expect(installed.installed).toBe(true)
    expect(installed.requiresTrustReview).toBe(true)
    expect(document.custom).toBe(true)
    expect(document.hooks.Stop[0].hooks[0].command).toBe('/usr/bin/existing-hook')
    expect(document.hooks.Stop[1].hooks[0].command).toContain('craft-hub-codex-activity')
    expect(document.hooks.UserPromptSubmit[0].hooks[0].type).toBe('command')

    await monitor.uninstall()
    const uninstalled = JSON.parse(await readFile(hooksPath, 'utf8')) as any
    expect(uninstalled.custom).toBe(true)
    expect(uninstalled.hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: '/usr/bin/existing-hook' }] }])
    expect(uninstalled.hooks.UserPromptSubmit).toBeUndefined()
  })

  it('tracks only lifecycle fields from hook events', async () => {
    const root = await temporaryDirectory()
    const monitor = new CodexActivityMonitor({ codexHome: join(root, 'codex'), dataDir: join(root, 'data'), platform: 'darwin' })

    monitor.accept({ hook_event_name: 'UserPromptSubmit', session_id: 'session-1', prompt: 'private' } as any)
    expect((await monitor.status()).runningSessionIds).toEqual(['session-1'])
    monitor.accept({ hook_event_name: 'Stop', session_id: 'session-1' })
    expect((await monitor.status()).runningSessionIds).toEqual([])
  })

  it('uses recent desktop rollout lifecycle markers as a read-only fallback', async () => {
    const root = await temporaryDirectory()
    const codexHome = join(root, 'codex')
    const sessions = join(codexHome, 'sessions', '2026', '08', '27')
    await mkdir(sessions, { recursive: true })
    const rollout = join(sessions, 'rollout-active.jsonl')
    await writeFile(rollout, [
      JSON.stringify({ type: 'session_meta', payload: { id: 'desktop-session', originator: 'Codex Desktop' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }),
      '',
    ].join('\n'))
    const monitor = new CodexActivityMonitor({ codexHome, dataDir: join(root, 'data'), platform: 'darwin' })

    await monitor.install()
    expect((await monitor.status()).runningSessionIds).toEqual(['desktop-session'])
    await writeFile(rollout, [
      JSON.stringify({ type: 'session_meta', payload: { id: 'desktop-session', originator: 'Codex Desktop' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } }),
      '',
    ].join('\n'))
    expect((await monitor.status()).runningSessionIds).toEqual([])
  })

  it('reports unsupported platforms without changing hook configuration', async () => {
    const root = await temporaryDirectory()
    const monitor = new CodexActivityMonitor({ codexHome: join(root, 'codex'), dataDir: join(root, 'data'), platform: 'linux' })
    expect(await monitor.install()).toMatchObject({ installed: false, supported: false })
  })
})

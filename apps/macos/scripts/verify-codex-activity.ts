import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

interface Status { installed: boolean, ownHookCount: number, otherHookCount: number, runningSessionIds: string[] }
interface Review { id: string, bridgePath: string, otherHookCount: number }

/** Exercise the actual bundled activity adapter in the existing management verifier's disposable HOME. */
export async function verifyPackagedCodexActivity(origin: string, cookie: string, nativeHeaders: Record<string, string>, home: string): Promise<void> {
  const directory = join(home, '.codex')
  await mkdir(directory, { recursive: true })
  const hooksPath = join(directory, 'hooks.json')
  const events = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop']
  const other = { custom: 'preserved', hooks: Object.fromEntries(events.map(event => [event, [{ hooks: [{ type: 'command', command: '\'/fixture-electron/bridge.sh\' # craft-hub-codex-activity', timeout: 5 }] }]])) }
  await writeFile(hooksPath, JSON.stringify(other))
  const nativeURL = new URL('/api/native-host/codex-activity', origin)
  const request = async (body?: object) => {
    const response = await fetch(nativeURL, { method: body ? 'POST' : 'GET', headers: nativeHeaders, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) })
    assert.equal(response.status, 200)
    return await response.json() as { version: number, status: Status, review: Review }
  }
  assert.equal((await fetch(nativeURL, { headers: { cookie, origin } })).status, 403)
  assert.equal((await request()).status.installed, false)
  assert.equal((await request()).status.otherHookCount, 4)
  const before = await readFile(hooksPath, 'utf8')
  const cancelled = (await request({ action: 'review', operation: 'install' })).review
  assert.equal(await readFile(hooksPath, 'utf8'), before)
  await expectMissing(cancelled.bridgePath)
  await request({ action: 'cancel', id: cancelled.id })
  assert.equal((await fetch(nativeURL, { method: 'POST', headers: nativeHeaders, body: JSON.stringify({ action: 'apply', id: cancelled.id }) })).status, 400)
  const response = await fetch(new URL('/__craft_hub_host/codex-activity-events', origin), { headers: { cookie }, signal: AbortSignal.timeout(15000) })
  assert.equal(response.status, 200)
  const reader = response.body!.getReader()
  let pending = ''
  const next = async (): Promise<Status> => {
    for (;;) {
      const match = pending.match(/data: ([^\n]+)\n\n/)
      if (match) {
        pending = pending.slice(pending.indexOf(match[0]) + match[0].length)
        assert(!match[1]!.includes('private-fixture-prompt'))
        return JSON.parse(match[1]!) as Status
      }
      const chunk = await reader.read()
      assert(!chunk.done, 'Activity stream ended before the expected status')
      pending += new TextDecoder().decode(chunk.value)
    }
  }
  try {
    assert.equal((await next()).installed, false)
    const review = (await request({ action: 'review', operation: 'install' })).review
    assert.equal(review.otherHookCount, 4)
    assert.equal((await request({ action: 'apply', id: review.id })).status.installed, true)
    assert((await readFile(hooksPath, 'utf8')).includes('# craft-hub-profile-activity-v1'))
    assert.equal((await next()).ownHookCount, 4)
    const script = await readFile(review.bridgePath, 'utf8')
    assert(script.includes('/usr/bin/curl --noproxy \'*\' --proto \'=http\' --silent --max-time 1'))
    // Execute only the just-reviewed generated fixture bridge, with a fixed shell executable and no shell command string.
    async function deliver(hookEvent: string) {
      const bridge = spawn('/bin/sh', [review.bridgePath], { shell: false, stdio: ['pipe', 'ignore', 'ignore'], env: { ...process.env, http_proxy: 'http://127.0.0.1:9', ALL_PROXY: 'http://127.0.0.1:9', NO_PROXY: '', no_proxy: '' } })
      const done = once(bridge, 'exit', { signal: AbortSignal.timeout(5000) })
      bridge.stdin.end(JSON.stringify({ hook_event_name: hookEvent, session_id: 'native-fixture-session', prompt: 'private-fixture-prompt' }))
      assert.equal((await done)[0], 0)
    }
    await deliver('UserPromptSubmit')
    assert.deepEqual((await next()).runningSessionIds, ['native-fixture-session'])
    await deliver('Stop')
    assert.deepEqual((await next()).runningSessionIds, [])
    const remove = (await request({ action: 'review', operation: 'uninstall' })).review
    assert.equal((await request({ action: 'apply', id: remove.id })).status.installed, false)
    assert.deepEqual(JSON.parse(await readFile(hooksPath, 'utf8')), other)
    const disabled = await next()
    assert.equal(disabled.ownHookCount, 0)
    assert.equal(disabled.otherHookCount, 4)
    assert(!(await readFile(hooksPath, 'utf8')).includes('private-fixture-prompt'))
  }
  finally { await reader.cancel() }
}

async function expectMissing(path: string): Promise<void> {
  await assert.rejects(access(path), { code: 'ENOENT' })
}

import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, expect, it } from 'vitest'
import { NativeCodexActivity } from '../src/native-codex-activity.ts'
import { createSessionGuard } from '../src/sidecar-host.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-native-activity-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const dataDir = join(root, 'data')
  const codexHome = join(root, 'codex')
  const activity = new NativeCodexActivity({ dataDir, codexHome, platform: 'darwin' })
  await activity.start()
  const guard = createSessionGuard('browser-fixture', 'native-fixture')
  const server = createServer((request, response) => {
    if (request.url === '/__craft_hub_host/bootstrap?token=browser-fixture' && guard.authorize(request)) {
      guard.bootstrap(response)
      return
    }
    void activity.handle(request, response, guard).then((handled) => {
      if (!handled)
        response.writeHead(404).end()
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('No fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  guard.setOrigin(origin)
  cleanups.push(async () => {
    await activity.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const bootstrap = await fetch(`${origin}/__craft_hub_host/bootstrap?token=browser-fixture`, { redirect: 'manual' })
  const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0]!
  const nativeHeaders = { 'authorization': 'Bearer native-fixture', 'content-type': 'application/json' }
  const browserHeaders = { 'cookie': cookie, 'content-type': 'application/json', 'x-craft-hub-host': '1' }
  const native = (input?: object, extra: Record<string, string> = {}) => fetch(`${origin}/api/native-host/codex-activity`, { method: input ? 'POST' : 'GET', headers: { ...nativeHeaders, ...extra }, ...(input ? { body: JSON.stringify(input) } : {}) })
  return { origin, root, dataDir, codexHome, cookie, native, browserHeaders, activity }
}

it('requires native authority for reviewed writes and preserves read-only browser status', async () => {
  const { origin, codexHome, native, browserHeaders } = await fixture()
  expect((await native()).status).toBe(200)
  const browser = await fetch(`${origin}/__craft_hub_host/codex-activity-status`, { method: 'POST', headers: browserHeaders, body: '{}' })
  expect(await browser.json()).toMatchObject({ value: { installed: false, supported: true } })
  await expect(access(codexHome)).rejects.toThrow()
  const rejectedHeaders: Array<Record<string, string>> = [{}, browserHeaders, { authorization: 'Bearer wrong' }]
  for (const headers of rejectedHeaders) {
    expect((await fetch(`${origin}/api/native-host/codex-activity`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'review', operation: 'install' }) })).status).toBe(403)
  }
  expect((await native({ action: 'review', operation: 'install' }, { origin: 'https://example.com' })).status).toBe(403)
  expect((await fetch(`${origin}/__craft_hub_host/codex-activity-status`, { method: 'POST', headers: browserHeaders, body: '{"action":"install"}' })).status).toBe(400)
  const review = (await (await native({ action: 'review', operation: 'install' })).json()).review
  await expect(access(codexHome)).rejects.toThrow()
  expect((await native({ action: 'apply', id: review.id, operation: 'uninstall' })).status).toBe(400)
  expect((await native({ action: 'cancel', id: review.id })).status).toBe(200)
  expect((await native({ action: 'apply', id: review.id })).status).toBe(400)
  await expect(access(join(codexHome, 'hooks.json'))).rejects.toThrow()
})

it.skipIf(process.platform === 'win32')('streams lifecycle status, never prompt content, and closes the receiver and stream on shutdown', async () => {
  const { origin, native, cookie, dataDir, codexHome, activity } = await fixture()
  const response = await fetch(`${origin}/__craft_hub_host/codex-activity-events`, { headers: { cookie }, signal: AbortSignal.timeout(8000) })
  const reader = response.body!.getReader()
  let pending = ''
  const next = async () => {
    for (;;) {
      const match = pending.match(/data: ([^\n]+)\n\n/)
      if (match) {
        pending = pending.slice(pending.indexOf(match[0]) + match[0].length)
        return JSON.parse(match[1]!)
      }
      const chunk = await reader.read()
      if (chunk.done)
        throw new Error('Activity stream ended before status')
      pending += new TextDecoder().decode(chunk.value)
    }
  }
  expect(await next()).toMatchObject({ installed: false, runningSessionIds: [] })
  const review = (await (await native({ action: 'review', operation: 'install' })).json()).review
  expect(await (await native({ action: 'apply', id: review.id })).json()).toMatchObject({ status: { installed: true, requiresTrustReview: true } })
  expect(await next()).toMatchObject({ installed: true })
  const endpoint = (await readFile(join(dataDir, 'codex-hook-endpoint'), 'utf8')).trim()
  expect((await fetch(endpoint, { method: 'POST', body: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'fixture-session', prompt: 'private-fixture-prompt' }) })).status).toBe(204)
  const status = await next()
  expect(status.runningSessionIds).toEqual(['fixture-session'])
  expect(JSON.stringify(status)).not.toContain('private-fixture-prompt')
  expect(await readFile(join(codexHome, 'hooks.json'), 'utf8')).not.toContain('private-fixture-prompt')
  await fetch(endpoint, { method: 'POST', body: JSON.stringify({ hook_event_name: 'Stop', session_id: 'fixture-session' }) })
  expect((await next()).runningSessionIds).toEqual([])
  await activity.close()
  expect((await reader.read()).done).toBe(true)
  await expect(access(join(dataDir, 'codex-hook-endpoint'))).rejects.toThrow()
  expect((await native()).status).toBe(503)
})

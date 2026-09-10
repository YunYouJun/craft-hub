import type { AccountProvider } from '../src/accounts'
import { createServer, request } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { handleAccountRequest } from '../src/accounts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(close => close()))
})
async function start(provider?: AccountProvider) {
  const server = createServer(async (req, res) => {
    if (await handleAccountRequest(provider, req, res))
      return
    res.end('private runtime data')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve) => {
    server.closeAllConnections()
    server.close(() => resolve())
  }))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('No address')
  return `http://127.0.0.1:${address.port}`
}
const provider: AccountProvider = { id: 'example', displayName: 'Example account', mode: 'local', required: true, status: async () => undefined }

it('preserves the unconfigured community host', async () => {
  const url = await start()
  expect(await (await fetch(`${url}/api/account`)).json()).toEqual({ enabled: false })
  expect(await (await fetch(`${url}/api/projects`)).text()).toBe('private runtime data')
})
it('blocks all private API routes before dispatch when identity is absent', async () => {
  const url = await start(provider)
  for (const route of ['/api/projects', '/api/events', '/api/health', '/api/settings'])
    expect((await fetch(`${url}${route}`)).status).toBe(401)
  expect((await fetch(`${url}/api/account`)).status).toBe(200)
})
it('permits valid identities and rejects expired identities or provider failure', async () => {
  for (const identity of [undefined, { id: '1', name: 'Example', expiresAt: new Date(Date.now() - 1000).toISOString() }]) {
    const url = await start({ ...provider, status: async () => identity })
    expect((await fetch(`${url}/api/projects`)).status).toBe(401)
  }
  const url = await start({ ...provider, status: async () => ({ id: '1', name: 'Example', expiresAt: new Date(Date.now() + 60000).toISOString() }) })
  expect((await fetch(`${url}/api/projects`)).status).toBe(200)
  const broken = await start({ ...provider, status: async () => {
    throw new Error('private provider detail')
  } })
  expect(await (await fetch(`${broken}/api/projects`)).text()).not.toContain('private provider detail')
})
it('rejects cross-origin reads, forged host headers and account actions without Origin', async () => {
  let invoked = false
  const url = await start({ ...provider, signIn: async () => {
    invoked = true
    return { authorizationUrl: 'https://login.example.com' }
  } })
  expect((await fetch(`${url}/api/account`, { headers: { origin: 'https://evil.example' } })).status).toBe(403)
  const forgedHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(`${url}/api/account`, { headers: { host: 'evil.example' } }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('error', reject)
    req.end()
  })
  expect(forgedHostStatus).toBe(403)
  expect((await fetch(`${url}/api/account/sign-in`, { method: 'POST' })).status).toBe(403)
  expect(invoked).toBe(false)
  expect((await fetch(`${url}/api/account/sign-in`, { method: 'POST', headers: { origin: url } })).status).toBe(200)
  expect(invoked).toBe(true)
})

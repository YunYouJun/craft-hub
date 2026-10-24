import type { Server } from 'node:http'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { personalCloudJSON, personalCloudOrigin } from '../src/cloud-http'
import { parseCloudConnectCallback } from '../src/controller'

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Fixture server did not bind')
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

describe('personal-cloud HTTP boundary', () => {
  it.each([
    'http://api.example.com',
    'https://user:fixture@example.com',
    'https://example.com/api',
    'https://example.com/../',
    'https://example.com?',
    'https://example.com#',
    'https://example.com:0',
    'https://example.com\\other',
    ' https://example.com',
    'https://example.com\n',
  ])('rejects non-origin or insecure configuration (%#)', (value) => {
    expect(() => personalCloudOrigin(value)).toThrow('HTTPS')
  })

  it('normalizes supported origins without weakening loopback limits', () => {
    expect(personalCloudOrigin('HTTPS://API.EXAMPLE.COM:443/')).toBe('https://api.example.com')
    expect(personalCloudOrigin('http://127.0.0.1:4000')).toBe('http://127.0.0.1:4000')
    expect(personalCloudOrigin('http://[::1]:4000')).toBe('http://[::1]:4000')
  })

  it('never forwards an adoption body or signed headers through a real HTTP redirect', async () => {
    let forwarded = 0
    const destination = createServer((_request, response) => {
      forwarded++
      response.end('{}')
    })
    const target = await listen(destination)
    const redirect = createServer((_request, response) => {
      response.writeHead(307, { location: `${target}/received` })
      response.end()
    })
    const origin = await listen(redirect)
    try {
      await expect(personalCloudJSON(new URL('/v1/devices/adopt', origin), {
        method: 'POST',
        body: JSON.stringify({ code: 'fixture-code' }),
        headers: { 'X-Craft-Signature': 'fixture-signature' },
      })).rejects.toThrow('request failed')
      expect(forwarded).toBe(0)
    }
    finally { await Promise.all([close(redirect), close(destination)]) }
  })

  it('cancels a real response body that stalls after headers', async () => {
    let headersSent!: () => void
    const ready = new Promise<void>((resolve) => {
      headersSent = resolve
    })
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write('{')
      headersSent()
    })
    const origin = await listen(server)
    const abort = new AbortController()
    try {
      const operation = personalCloudJSON(new URL('/v1/sync', origin), { method: 'POST' }, fetch, abort.signal)
      const cancelled = expect(operation).rejects.toThrow('cancelled')
      await ready
      abort.abort()
      await cancelled
    }
    finally { await close(server) }
  })

  it('bounds response bytes and never reflects remote error bodies or malformed text', async () => {
    let cancelled = false
    const oversized = new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)) },
      cancel() { cancelled = true },
    }))
    const url = new URL('https://api.example.com/v1/sync')
    await expect(personalCloudJSON(url, {}, async () => oversized)).rejects.toThrow('invalid response')
    expect(cancelled).toBe(true)
    await expect(personalCloudJSON(url, {}, async () => new Response('private-fixture-error', { status: 500 }))).rejects.toThrow('request failed')
    await expect(personalCloudJSON(url, {}, async () => new Response('private-fixture-json'))).rejects.toThrow('invalid response')
  })

  it.each([
    'craft-hub-native://user@cloud/connect?code=once&challenge=expected',
    'craft-hub-native://@cloud/connect?code=once&challenge=expected',
    'craft-hub-native://cloud/other/../connect?code=once&challenge=expected',
    'craft-hub-native://cloud:42/connect?code=once&challenge=expected',
    'craft-hub-native://cloud/connect?code=once&challenge=expected#fragment',
    'craft-hub-native://cloud/connect?code=once&challenge=expected&extra=1',
    'craft-hub-native://cloud/connect?code=once&code=other&challenge=expected',
    'craft-hub-native://cloud/connect?code=once&challenge=expected&challenge=expected',
    'craft-hub-native://cloud/connect?code=once%0A&challenge=expected',
  ])('rejects ambiguous or credential-bearing callbacks (%#)', (value) => {
    expect(() => parseCloudConnectCallback(value, 'expected', ['craft-hub-native'])).toThrow('callback')
  })
})

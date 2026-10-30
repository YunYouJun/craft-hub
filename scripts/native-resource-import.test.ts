import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

const script = await readFile(new URL('../apps/macos/Sources/CraftHubMac/Resources/BrowserImport/query.txt', import.meta.url), 'utf8')
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
const execute = new AsyncFunction('spec', 'location', 'window', 'fetch', script)
const spec = { url: 'https://accounts.example.com/list', request: { path: '/api/accounts', operatorGlobal: 'currentUser', operatorParameter: 'operator' }, response: { recordsPath: ['payload', 'accounts'], successField: 'code', successValue: 0 } }
const rows = [{ username: 'sample', password: 'synthetic-only', status: 1 }]

describe('the bundled native browser import request', () => {
  it('accepts ordinary signed-in operators and uses the reviewed same-origin request', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, payload: { accounts: rows } })))
    expect(await execute(spec, new URL(spec.url), { currentUser: 'sample_user' }, fetch)).toEqual(rows)
    expect(fetch).toHaveBeenCalledWith('https://accounts.example.com/api/accounts?operator=sample_user', expect.objectContaining({ method: 'POST', credentials: 'include', redirect: 'error', body: '{}' }))
  })

  it('rejects control characters, failed authentication and account changes before returning records', async () => {
    const denied = vi.fn()
    await expect(execute(spec, new URL(spec.url), { currentUser: 'sample\u0000user' }, denied)).rejects.toThrow('login')
    expect(denied).not.toHaveBeenCalled()
    await expect(execute(spec, new URL(spec.url), { currentUser: 'sample_user' }, async () => new Response('', { status: 403 }))).rejects.toThrow()
    const page = { currentUser: 'sample_user' }
    await expect(execute(spec, new URL(spec.url), page, async () => {
      page.currentUser = 'someone_else'
      return new Response(JSON.stringify({ code: 0, payload: { accounts: rows } }))
    })).rejects.toThrow('invalid')
  })
})

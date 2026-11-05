import { describe, expect, it, vi } from 'vitest'
import { cloudSession, createXiaomiCloudTransport, noteMarkdown } from '../src/transport'

const session = cloudSession('userId=1001; serviceToken=fixture-cloud-token', 'https://i.mi.com')
const signal = new AbortController().signal
const entry = { id: 'one', type: 'note', folderId: 0, createDate: 1000, modifyDate: 2000, subject: 'Title', status: 'normal', extraInfo: '{"title":"A note"}' }
function response(data: unknown): Response {
  return Response.json({ result: 'ok', code: 0, data })
}

describe('xiaomi cloud private read transport', () => {
  it('keeps only cloud cookies and rejects unreviewed origins and header injection before requesting', () => {
    expect(cloudSession('Cookie: passToken=account-secret; userId=1001; serviceToken=cloud; unrelated=value', session.origin)).toEqual({ accountId: '1001', origin: session.origin, cookie: 'userId=1001; serviceToken=cloud' })
    for (const origin of ['http://i.mi.com', 'https://i.mi.com.evil.example', 'https://user@i.mi.com', 'https://i.mi.com/path'])
      expect(() => cloudSession(session.cookie, origin)).toThrow(/sign-in/)
    for (const cookie of ['userId=1001', 'userId=../other; serviceToken=x', 'userId=1001; serviceToken=x\r\nInjected: value', 'userId=1001; userId=2002; serviceToken=x'])
      expect(() => cloudSession(cookie, session.origin)).toThrow(/sign-in/)
  })

  it('reads encoded cursors as parameters and distinguishes full text from list snippets', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ entries: [entry, { ...entry, id: 'private', status: 'private' }, { ...entry, id: 'mind', extraInfo: '{"note_content_type":"mind"}' }, { ...entry, id: 'deleted', deleteTime: 1234 }], folders: [{ id: 0, subject: 'Folder' }], lastPage: false, syncTag: 'next&limit=999' })).mockResolvedValueOnce(response({ entry: { ...entry, content: '<new-format/><text><b>Full</b> &amp; complete</text>', setting: { data: [{ fileId: '1001.attachment', mimeType: 'image/jpeg' }] } } }))
    const transport = createXiaomiCloudTransport({ fetch: request, now: () => 123 })
    expect(await transport.page(session, 'opaque&cursor', signal)).toMatchObject({ notes: [{ id: 'one', title: 'A note', folderId: '0' }], skipped: 3, cursor: 'next&limit=999' })
    const [url, init] = request.mock.calls[0]!
    expect(new URL(String(url)).searchParams.get('syncTag')).toBe('opaque&cursor')
    expect(new URL(String(url)).searchParams.get('limit')).toBe('200')
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', headers: { cookie: session.cookie } })
    expect(await transport.note(session, 'one', signal)).toMatchObject({ markdown: '**Full** & complete', content: '<new-format/><text><b>Full</b> &amp; complete</text>', attachments: [{ id: '1001.attachment', mimeType: 'image/jpeg' }] })
    expect(new URL(String(request.mock.calls[1]![0])).pathname).toBe('/note/note/one/')
  })

  it('blocks credential redirects and returns safe authentication, throttling and network failures', async () => {
    const request = vi.fn<typeof fetch>()
    const transport = createXiaomiCloudTransport({ fetch: request })
    for (const [status, kind] of [[302, 'authorization'], [401, 'authorization'], [403, 'authorization'], [429, 'throttled'], [503, 'unavailable']] as const) {
      request.mockResolvedValueOnce(new Response('provider-secret', { status, headers: { location: 'https://evil.example/steal' } }))
      await expect(transport.page(session, '', signal)).rejects.toMatchObject({ kind })
    }
    request.mockRejectedValueOnce(new Error(`request failed with ${session.cookie}`))
    await expect(transport.page(session, '', signal)).rejects.toMatchObject({ kind: 'unavailable', message: expect.not.stringContaining('fixture-cloud-token') })
    expect(request).toHaveBeenCalledTimes(6)
  })

  it('rejects malformed, truncated and oversized responses instead of backing up partial text', async () => {
    const request = vi.fn<typeof fetch>()
    const transport = createXiaomiCloudTransport({ fetch: request })
    for (const data of [
      { entries: [], folders: [], lastPage: false },
      { entries: [], folders: [], lastPage: 'true' },
      { entries: [{ ...entry, id: '../escape' }], folders: [], lastPage: true },
    ]) {
      request.mockResolvedValueOnce(response(data))
      await expect(transport.page(session, '', signal)).rejects.toMatchObject({ kind: 'response' })
    }
    request.mockResolvedValueOnce(response({ entry: { ...entry, snippet: 'Not the full note' } }))
    await expect(transport.note(session, 'one', signal)).rejects.toMatchObject({ kind: 'response' })
    request.mockResolvedValueOnce(new Response('{}', { headers: { 'content-length': '8000001' } }))
    await expect(transport.page(session, '', signal)).rejects.toMatchObject({ kind: 'response' })
    request.mockResolvedValueOnce(new Response('x'.repeat(8_000_001)))
    await expect(transport.page(session, '', signal)).rejects.toMatchObject({ kind: 'response' })
  })

  it('converts standard text and checklists while keeping decoded markup inert', () => {
    expect(noteMarkdown('<text>First &amp; second</text><input type="checkbox" checked="true" /><text>Done &#x1F600;</text><img fileid="x"/><script>private()</script>&lt;img src=x onerror=alert(1)&gt;')).toBe('First & second\n- [x] Done 😀\n[Attachment: see Xiaomi Cloud]&lt;img src=x onerror=alert(1)&gt;')
  })
})

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { desktopNodeRelease, downloadDesktopNode, packageDesktopNode } from './package-desktop-node.ts'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function destination(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-node-package-test-'))
  roots.push(root)
  return join(root, 'download')
}

it('pins both Mac architectures and rejects unsupported release targets', async () => {
  for (const architecture of ['arm64', 'x64'] as const) {
    const release = await desktopNodeRelease(architecture)
    expect(release.filename).toBe(`node-v${release.version}-darwin-${architecture}.tar.gz`)
    expect(release.sha256).toMatch(/^[a-f0-9]{64}$/)
  }
  // Deliberately exercise the runtime boundary beyond the build script's TypeScript type.
  await expect(desktopNodeRelease('linux' as 'arm64')).rejects.toThrow('pin')
})

it('writes fragmented official bytes only when the pinned checksum matches', async () => {
  const file = await destination()
  const bytes = new TextEncoder().encode('official archive fixture')
  const mock = vi.fn(async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, 5))
    controller.enqueue(bytes.slice(5))
    controller.close()
  } })))
  vi.stubGlobal('fetch', mock)
  const hash = createHash('sha256').update(bytes).digest('hex')
  await downloadDesktopNode(new URL('https://nodejs.org/dist/v24.22.1/fixture.tar.gz'), file, 1024, hash)
  expect(await readFile(file, 'utf8')).toBe('official archive fixture')
  expect(mock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }))
  await expect(downloadDesktopNode(new URL('https://nodejs.org/dist/fixture'), await destination(), 1024, '0'.repeat(64))).rejects.toThrow('checksum')
})

it('refuses alternate origins, error responses, oversized streams and pre-existing files', async () => {
  const mock = vi.fn(async () => new Response('fixture'))
  vi.stubGlobal('fetch', mock)
  for (const url of ['http://nodejs.org/dist/fixture', 'https://mirror.example.com/fixture', 'https://nodejs.org:444/fixture', 'https://user:secret@nodejs.org/fixture'])
    await expect(downloadDesktopNode(new URL(url), await destination(), 32)).rejects.toThrow('official')
  expect(mock).not.toHaveBeenCalled()
  mock.mockImplementationOnce(async () => new Response('denied', { status: 403 }))
  await expect(downloadDesktopNode(new URL('https://nodejs.org/dist/fixture'), await destination(), 32)).rejects.toThrow('unavailable')
  mock.mockImplementationOnce(async () => new Response('large', { headers: { 'content-length': '999' } }))
  await expect(downloadDesktopNode(new URL('https://nodejs.org/dist/fixture'), await destination(), 32)).rejects.toThrow('limit')
  mock.mockImplementationOnce(async () => new Response('too much streamed content'))
  await expect(downloadDesktopNode(new URL('https://nodejs.org/dist/fixture'), await destination(), 5)).rejects.toThrow('limit')
  const file = await destination()
  await writeFile(file, 'keep')
  await expect(downloadDesktopNode(new URL('https://nodejs.org/dist/fixture'), file, 32)).rejects.toMatchObject({ code: 'EEXIST' })
  expect(await readFile(file, 'utf8')).toBe('keep')
  await expect(packageDesktopNode(file, 'arm64')).rejects.toThrow('already exists')
})

it('does not extract or promote a release whose official manifest no longer matches the pin', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(`${'0'.repeat(64)}  ${(await desktopNodeRelease('arm64')).filename}\n`)))
  const target = await destination()
  await expect(packageDesktopNode(target, 'arm64')).rejects.toThrow('manifest')
  await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' })
})

function interrupted(bytes: Uint8Array, length?: number): Response {
  let sent = false
  return new Response(new ReadableStream({ pull(controller) {
    if (sent) {
      controller.error(new Error('fixture connection closed'))
    }
    else {
      sent = true
      controller.enqueue(bytes)
    }
  } }), length === undefined ? undefined : { headers: { 'content-length': String(length) } })
}

it('resumes a pinned archive from persisted bytes and validates the complete checksum', async () => {
  const bytes = new TextEncoder().encode('verified archive')
  const file = await destination()
  const hash = createHash('sha256').update(bytes).digest('hex')
  const mock = vi.fn().mockResolvedValueOnce(interrupted(bytes.slice(0, 5))).mockResolvedValueOnce(new Response(bytes.slice(5), { status: 206, headers: { 'content-range': `bytes 5-${bytes.length - 1}/${bytes.length}` } }))
  vi.stubGlobal('fetch', mock)
  await downloadDesktopNode(new URL('https://nodejs.org/dist/fixture'), file, 1024, hash)
  expect(await readFile(file)).toEqual(Buffer.from(bytes))
  expect(mock.mock.calls[1]![1]).toMatchObject({ redirect: 'error', headers: { Range: 'bytes=5-' } })
  expect(mock.mock.calls[0]![1].signal).toBe(mock.mock.calls[1]![1].signal)
})

it('rejects ignored, shifted or changed resume ranges without retrying or accepting partial data', async () => {
  for (const response of [new Response('tail'), new Response('tail', { status: 206, headers: { 'content-range': 'bytes 2-6/7' } }), new Response('tail', { status: 206, headers: { 'content-range': 'bytes 3-6/9999' } })]) {
    const mock = vi.fn().mockResolvedValueOnce(interrupted(new TextEncoder().encode('abc'))).mockResolvedValueOnce(response)
    vi.stubGlobal('fetch', mock)
    await expect(downloadDesktopNode(new URL('https://nodejs.org/dist/fixture'), await destination(), 1024, 'a'.repeat(64))).rejects.toThrow()
    expect(mock).toHaveBeenCalledTimes(2)
  }
  const mock = vi.fn().mockResolvedValueOnce(interrupted(new TextEncoder().encode('abc'), 8)).mockResolvedValueOnce(new Response('tail', { status: 206, headers: { 'content-range': 'bytes 3-6/7' } }))
  vi.stubGlobal('fetch', mock)
  await expect(downloadDesktopNode(new URL('https://nodejs.org/dist/fixture'), await destination(), 1024, 'a'.repeat(64))).rejects.toThrow('resume range')
  expect(mock).toHaveBeenCalledTimes(2)
})

it('rejects a changed archive after an otherwise valid resume', async () => {
  const original = new TextEncoder().encode('abc-original')
  const hash = createHash('sha256').update(original).digest('hex')
  const mock = vi.fn().mockResolvedValueOnce(interrupted(original.slice(0, 3), original.length)).mockResolvedValueOnce(new Response('-modified', { status: 206, headers: { 'content-range': `bytes 3-${original.length - 1}/${original.length}` } }))
  vi.stubGlobal('fetch', mock)
  await expect(downloadDesktopNode(new URL('https://nodejs.org/dist/fixture'), await destination(), 1024, hash)).rejects.toThrow('checksum')
  expect(mock).toHaveBeenCalledTimes(2)
})

it('bounds transport retries and never resumes an unpinned manifest', async () => {
  const mock = vi.fn(async () => interrupted(new TextEncoder().encode('abc')))
  vi.stubGlobal('fetch', mock)
  await expect(downloadDesktopNode(new URL('https://nodejs.org/dist/fixture'), await destination(), 1024)).rejects.toThrow('connection closed')
  expect(mock).toHaveBeenCalledOnce()
  mock.mockReset().mockRejectedValue(new Error('offline'))
  await expect(downloadDesktopNode(new URL('https://nodejs.org/dist/fixture'), await destination(), 1024, 'a'.repeat(64))).rejects.toThrow('offline')
  expect(mock).toHaveBeenCalledTimes(3)
  mock.mockClear()
  for (const timeout of [0, -1, Infinity, 600_001])
    await expect(downloadDesktopNode(new URL('https://nodejs.org/dist/fixture'), await destination(), 1024, undefined, timeout)).rejects.toThrow('deadline')
  expect(mock).not.toHaveBeenCalled()
})

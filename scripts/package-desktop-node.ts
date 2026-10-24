import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const archiveLimit = 128 * 1024 * 1024
const archiveDownloadTimeout = 10 * 60 * 1000

/** Release-owned runtime inputs; no mutable latest URL, caller download URL or executable override. */
export async function desktopNodeRelease(architecture: 'arm64' | 'x64'): Promise<{ version: string, sha256: string, filename: string, root: string }> {
  const pin = JSON.parse(await readFile(new URL('./desktop-node.lock.json', import.meta.url), 'utf8')) as { version: string, darwin: Record<string, string> }
  const sha256 = pin.darwin?.[architecture]
  if (!/^24\.\d+\.\d+$/.test(pin.version) || !['arm64', 'x64'].includes(architecture) || !/^[a-f0-9]{64}$/.test(sha256 ?? ''))
    throw new Error('Invalid desktop Node release pin')
  const root = `node-v${pin.version}-darwin-${architecture}`
  return { version: pin.version, sha256: sha256!, root, filename: `${root}.tar.gz` }
}

/** Bounded official download; pinned archives may resume at the exact persisted offset after a transport error. */
export async function downloadDesktopNode(url: URL, destination: string, limit: number, expectedHash?: string, timeout = 180_000): Promise<void> {
  if (url.protocol !== 'https:' || url.hostname !== 'nodejs.org' || url.username || url.password || url.port || url.search || url.hash)
    throw new Error('Desktop Node must come from the official release server')
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > archiveDownloadTimeout)
    throw new Error('Invalid desktop Node download deadline')
  const signal = AbortSignal.timeout(timeout)
  let output: Awaited<ReturnType<typeof open>> | undefined
  let bytes = 0
  let total: number | undefined
  const hash = createHash('sha256')
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response
      try {
        response = await fetch(url, { redirect: 'error', signal, ...(bytes ? { headers: { Range: `bytes=${bytes}-` } } : {}) })
      }
      catch (error) {
        if (signal.aborted || attempt === 2)
          throw error
        continue
      }
      try {
        if (response.status !== (bytes ? 206 : 200) || !response.body || Number(response.headers.get('content-length') ?? 0) > limit - bytes)
          throw new Error('Desktop Node download is unavailable or exceeds its limit')
        if (bytes) {
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
          const start = Number(range?.[1])
          const end = Number(range?.[2])
          const length = Number(range?.[3])
          if (!range || start !== bytes || !Number.isSafeInteger(length) || length > limit || end !== length - 1 || end < start
            || (total !== undefined && length !== total)) {
            throw new Error('Desktop Node resume range does not match the persisted archive')
          }
          total = length
        }
        else if (response.headers.has('content-length')) {
          const length = Number(response.headers.get('content-length'))
          if (!Number.isSafeInteger(length) || length < 1 || length > limit)
            throw new Error('Desktop Node download exceeds its limit')
          total = length
        }
        output ??= await open(destination, 'wx', 0o600)
        const reader = response.body.getReader()
        let transportError: unknown
        try {
          for (;;) {
            let chunk: ReadableStreamReadResult<Uint8Array>
            try {
              chunk = await reader.read()
            }
            catch (error) {
              transportError = error
              break
            }
            if (chunk.done)
              break
            if (bytes + chunk.value.byteLength > limit || (total !== undefined && bytes + chunk.value.byteLength > total))
              throw new Error('Desktop Node download exceeds its limit')
            // Persist all bytes before advancing the resume position or the running checksum.
            let offset = 0
            while (offset < chunk.value.byteLength) {
              const { bytesWritten } = await output.write(chunk.value, offset, chunk.value.byteLength - offset)
              if (!bytesWritten)
                throw new Error('Desktop Node archive could not be written')
              offset += bytesWritten
            }
            hash.update(chunk.value)
            bytes += chunk.value.byteLength
          }
        }
        finally { reader.releaseLock() }
        if (transportError) {
          // A checksum pin authenticates a resumed archive even if the server changes between connections.
          // Unpinned manifests never resume, and filesystem, size, status or range errors are never retried.
          if (signal.aborted || attempt === 2 || !expectedHash)
            throw transportError
          continue
        }
        if (!bytes || (total !== undefined && bytes !== total) || (expectedHash && hash.digest('hex') !== expectedHash))
          throw new Error('Desktop Node checksum does not match the release pin')
        await output.sync()
        return
      }
      finally { await response.body?.cancel().catch(() => {}) }
    }
  }
  finally { await output?.close() }
}

/** Package only Node and its license for the legacy Electron backend. Native candidates keep their own bootstrap. */
export async function packageDesktopNode(target: string, architecture: 'arm64' | 'x64'): Promise<void> {
  const release = await desktopNodeRelease(architecture)
  await mkdir(dirname(target), { recursive: true })
  // Build beside the destination and reserve it exclusively before promotion; never replace an existing backend.
  try {
    await lstat(target)
    throw new Error('Desktop Node target already exists')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error
  }
  const scratch = await mkdtemp(join(tmpdir(), 'craft-hub-desktop-node-'))
  const stage = await mkdtemp(join(dirname(target), '.node-'))
  try {
    const base = new URL(`https://nodejs.org/dist/v${release.version}/`)
    const manifest = join(scratch, 'SHASUMS256.txt')
    await downloadDesktopNode(new URL('SHASUMS256.txt', base), manifest, 64 * 1024)
    const matches = (await readFile(manifest, 'utf8')).trim().split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(([, file]) => file === release.filename)
    if (matches.length !== 1 || matches[0]![0] !== release.sha256)
      throw new Error('Official Node manifest differs from the release pin')
    const archive = join(scratch, release.filename)
    await downloadDesktopNode(new URL(release.filename, base), archive, archiveLimit, release.sha256, archiveDownloadTimeout)
    // Only two fixed regular files from an already authenticated release archive are needed; no npm, headers or shims.
    await run('/usr/bin/tar', ['-xzf', archive, '-C', scratch, '--', `${release.root}/bin/node`, `${release.root}/LICENSE`], { timeout: 30_000, maxBuffer: 64 * 1024 })
    for (const name of ['bin/node', 'LICENSE']) {
      const source = join(scratch, release.root, name)
      const info = await lstat(source)
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size === 0 || info.size > archiveLimit)
        throw new Error('Invalid desktop Node release file')
      await mkdir(dirname(join(stage, name)), { recursive: true })
      await copyFile(source, join(stage, name))
    }
    await chmod(join(stage, 'bin/node'), 0o755)
    const binaryArch = (await run('/usr/bin/lipo', ['-archs', join(stage, 'bin/node')], { timeout: 10_000 })).stdout.trim()
    if (binaryArch !== (architecture === 'arm64' ? 'arm64' : 'x86_64'))
      throw new Error('Desktop Node architecture differs from its release pin')
    await writeFile(join(stage, 'runtime.json'), `${JSON.stringify({ version: release.version, architecture, archiveSHA256: release.sha256 })}\n`)
    await mkdir(target)
    try {
      await rename(stage, target)
    }
    catch (error) {
      // This reservation is empty and belongs to this call; the staging tree remains available to cleanup below.
      await rmdir(target).catch(() => {})
      throw error
    }
  }
  finally {
    await rm(scratch, { recursive: true, force: true })
    await rm(stage, { recursive: true, force: true })
  }
}

import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

async function fixture(hostEnvironment: 'local' | 'hosted' = 'local') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-space-server-')))
  const projectPath = join(root, 'project')
  await mkdir(projectPath)
  const manifest = JSON.stringify({ scripts: { clean: 'node --version' } })
  await writeFile(join(projectPath, 'package.json'), manifest)
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), hostEnvironment })
  const project = await runtime.projects.add(projectPath)
  const host = await startCraftHubServer({ runtime, port: 0 })
  const url = `${host.url}/api/projects/${project.id}/space`
  return { root, project, runtime, host, url, manifest, close: async () => {
    await host.close()
    await rm(root, { recursive: true, force: true })
  } }
}

describe('project space route and trust', () => {
  it('allows explicit untrusted inspection while preserving command discovery and execution trust', async () => {
    const f = await fixture()
    try {
      const response = await fetch(f.url)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toMatchObject({ projectId: f.project.id, status: 'complete', totalBytes: f.manifest.length, fileCount: 1 })
      const commands = await f.runtime.capabilities(f.project.id)
      const clean = commands.find(command => command.kind === 'command' && command.name === 'clean')!
      expect(clean).toBeDefined()
      await expect(f.runtime.run(f.project.id, clean.id)).rejects.toThrow(/untrusted/i)
      expect((await f.runtime.projects.get(f.project.id)).trust).toBe('untrusted')
      expect(await f.runtime.store.listRuns()).toEqual([])
      expect(await readFile(join(f.project.path, 'package.json'), 'utf8')).toBe(f.manifest)
    }
    finally { await f.close() }
  })

  it('rejects cross-origin, arbitrary paths, writes, unknown IDs and hosted inspection before scanning', async () => {
    const f = await fixture()
    const hosted = await fixture('hosted')
    const scan = vi.spyOn(f.runtime, 'projectSpace')
    try {
      const rejectedHeaders: Record<string, string>[] = [{ origin: 'https://example.com' }, { 'sec-fetch-site': 'cross-site' }]
      for (const headers of rejectedHeaders)
        expect((await fetch(f.url, { headers })).status).toBe(403)
      expect(await new Promise((resolve) => {
        const req = request(f.url, { headers: { host: 'attacker.example.com' } }, (res) => {
          res.resume()
          resolve(res.statusCode)
        })
        req.end()
      })).toBe(403)
      expect((await fetch(`${f.url}?path=/tmp`)).status).toBe(400)
      expect((await fetch(`${f.url}/extra`)).status).toBe(400)
      expect((await fetch(f.url, { method: 'POST' })).status).toBe(405)
      expect(scan).not.toHaveBeenCalled()
      expect((await fetch(f.url.replace(f.project.id, 'unknown'))).status).toBe(404)
      expect((await fetch(hosted.url)).status).toBe(403)
      await expect(hosted.runtime.projectSpace(hosted.project.id)).rejects.toMatchObject({ status: 403 })
    }
    finally {
      scan.mockRestore()
      await Promise.all([f.close(), hosted.close()])
    }
  })

  it('cancels on disconnect and limits duplicate scans without caching completed results', async () => {
    const f = await fixture()
    const original = f.runtime.projects.list.bind(f.runtime.projects)
    let release!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const listing = vi.spyOn(f.runtime.projects, 'list').mockImplementation(async () => {
      await hold
      return original()
    })
    try {
      const controller = new AbortController()
      const pending = f.runtime.projectSpace(f.project.id, controller.signal)
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await expect(f.runtime.projectSpace(f.project.id)).rejects.toMatchObject({ status: 409 })
      controller.abort()
      release()
      await rejected
      listing.mockRestore()
      expect(await f.runtime.projectSpace(f.project.id)).toMatchObject({ status: 'complete' })

      let disconnectedSignal: AbortSignal | undefined
      const scan = vi.spyOn(f.runtime, 'projectSpace').mockImplementation(async (_id, signal) => {
        disconnectedSignal = signal
        return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }))
      })
      const req = request(f.url)
      req.on('error', () => {})
      req.end()
      await vi.waitFor(() => expect(disconnectedSignal).toBeDefined())
      req.destroy()
      await vi.waitFor(() => expect(disconnectedSignal?.aborted).toBe(true))
      scan.mockRestore()
    }
    finally {
      release()
      listing.mockRestore()
      await f.close()
    }
  })
})

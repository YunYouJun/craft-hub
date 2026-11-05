import type { ChildProcess } from 'node:child_process'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { FSWatcher } from 'chokidar'
import { describe, expect, it, vi } from 'vitest'
import { craftHubCelebrationDesktopUrl, craftHubProjectDesktopUrl, launchCraftHubApp, launchCraftHubProject } from '../src/app'
import { CraftHubRuntime } from '../src/runtime'

const execFileAsync = promisify(execFile)

async function projectFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-app-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
  return realpath(root)
}

async function gitProjectFixture(): Promise<string> {
  const root = await projectFixture()
  await execFileAsync('git', ['init', root])
  await execFileAsync('git', ['-C', root, 'remote', 'add', 'origin', 'git@github.com:YunYouJun/craft-hub.git'])
  return root
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

async function startCliApp(projectPath: string): Promise<{ child: ChildProcess, url: string }> {
  const cliPath = resolve(repositoryRoot, 'packages/craft-hub/src/cli.ts')
  const child = spawn(process.execPath, ['--import', 'tsx', cliPath, 'app', relative(repositoryRoot, projectPath), '--no-open'], {
    cwd: repositoryRoot,
    env: { ...process.env, CRAFT_HUB_DATA_DIR: join(projectPath, '.cli-data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolvePromise, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error(`CLI did not start: ${output}`)), 5_000)
    child.stdout?.on('data', (chunk) => {
      output += String(chunk)
      const match = output.match(/Craft Hub is ready at (http:\/\/\S+)/)
      if (!match?.[1])
        return
      clearTimeout(timeout)
      resolvePromise({ child, url: match[1] })
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`CLI exited with ${String(code)}: ${output}`))
    })
  })
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return

  await new Promise<void>((resolvePromise) => {
    child.once('exit', () => resolvePromise())
    if (!child.kill())
      resolvePromise()
  })
}

async function readChunk<T>(reader: ReadableStreamDefaultReader<T>, timeoutMs = 5_000): Promise<ReadableStreamReadResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out waiting for streamed response data')), timeoutMs)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

async function readUntilEvent(reader: ReadableStreamDefaultReader<Uint8Array>, expected: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  const decoder = new TextDecoder()
  let output = ''
  while (!output.includes(expected)) {
    const chunk = await readChunk(reader, Math.max(deadline - Date.now(), 1))
    if (chunk.done)
      throw new Error(`Event stream closed before ${expected}`)
    output += decoder.decode(chunk.value, { stream: true })
  }
  return output
}

const watcherProbeIntervalMs = 500
const watcherStartupTimeoutMs = 1_500

async function acknowledgeProjectWatcher(reader: ReadableStreamDefaultReader<Uint8Array>, projectPath: string): Promise<void> {
  // Chokidar ready completes the scan; macOS can still drop the first native callbacks.
  // Confirm a real overview notification before making the single capabilities edit.
  const stop = new AbortController()
  const probing = (async () => {
    let attempt = 0
    while (!stop.signal.aborted) {
      await writeFile(join(projectPath, 'README.md'), `# Watcher startup ${++attempt}\n`)
      try {
        // Space probes beyond the event coalescing window so they can be acknowledged.
        await delay(watcherProbeIntervalMs, undefined, { signal: stop.signal })
      }
      catch (error) {
        if (!stop.signal.aborted)
          throw error
      }
    }
  })()
  try {
    await Promise.race([
      readUntilEvent(reader, '"scopes":["overview"]', watcherStartupTimeoutMs),
      probing,
    ])
  }
  catch (error) {
    throw new Error('Project watcher did not acknowledge startup', { cause: error })
  }
  finally {
    stop.abort()
    await probing
  }
}

describe('app launcher', () => {
  it('builds a celebration Desktop Link', () => {
    expect(craftHubCelebrationDesktopUrl()).toBe('craft-hub://celebrate?v=1')
  })

  it('builds normalized project and capability Desktop Links', () => {
    expect(craftHubProjectDesktopUrl({
      repository: 'git@github.com:YunYouJun/craft-hub.git',
      subdir: 'apps/web',
    }, 'package.json:dev')).toBe(
      'craft-hub://project?v=1&repo=https%3A%2F%2Fgithub.com%2FYunYouJun%2Fcraft-hub&subdir=apps%2Fweb&capability=package.json%3Adev',
    )
  })

  it('opens the requested project in the installed desktop client by default', async () => {
    const projectPath = await gitProjectFixture()
    const openedDesktopUrls: string[] = []
    const openedBrowserUrls: string[] = []

    const launched = await launchCraftHubProject(projectPath, {
      openBrowser: async (url) => { openedBrowserUrls.push(url) },
      openDesktop: async (url) => { openedDesktopUrls.push(url) },
      runtime: new CraftHubRuntime(join(projectPath, '.data')),
    })

    expect(launched).toEqual({
      kind: 'desktop',
      url: 'craft-hub://project?v=1&repo=https%3A%2F%2Fgithub.com%2FYunYouJun%2Fcraft-hub',
    })
    expect(openedDesktopUrls).toEqual([launched.url])
    expect(openedBrowserUrls).toEqual([])
  })

  it('falls back to the browser workbench when the desktop client cannot be opened', async () => {
    const projectPath = await gitProjectFixture()
    const openedBrowserUrls: string[] = []
    const launched = await launchCraftHubProject(projectPath, {
      openBrowser: async (url) => { openedBrowserUrls.push(url) },
      openDesktop: async () => { throw new Error('protocol handler unavailable') },
      runtime: new CraftHubRuntime(join(projectPath, '.data')),
    })

    expect(launched.kind).toBe('browser')
    expect(openedBrowserUrls).toEqual([launched.url])
    if (launched.kind === 'browser')
      await launched.close()
  })

  it('registers the requested project and starts on a random port', async () => {
    const projectPath = await projectFixture()
    const runtime = new CraftHubRuntime(join(projectPath, '.data'))
    const openedUrls: string[] = []
    const launched = await launchCraftHubApp(projectPath, {
      openBrowser: async (url) => { openedUrls.push(url) },
      runtime,
    })
    const secondLaunch = await launchCraftHubApp(projectPath, {
      open: false,
      runtime: new CraftHubRuntime(join(projectPath, '.second-data')),
    })

    try {
      const url = new URL(launched.url)
      expect(Number(url.port)).toBeGreaterThan(0)
      expect(new URL(secondLaunch.url).port).not.toBe(url.port)
      expect(url.searchParams.get('project')).toBe(launched.project.id)
      expect(openedUrls).toEqual([launched.url])
      await expect(runtime.projects.list()).resolves.toEqual([
        expect.objectContaining({ path: projectPath, trust: 'untrusted' }),
      ])
    }
    finally {
      await Promise.all([launched.close(), secondLaunch.close()])
    }
  })

  it('does not open a browser when opening is disabled', async () => {
    const projectPath = await projectFixture()
    const openedUrls: string[] = []
    const launched = await launchCraftHubApp(projectPath, {
      open: false,
      openBrowser: async (url) => { openedUrls.push(url) },
      runtime: new CraftHubRuntime(join(projectPath, '.data')),
    })

    try {
      expect(openedUrls).toEqual([])
    }
    finally {
      await launched.close()
    }
  })

  it('accepts a relative directory through craft-hub app', async () => {
    const projectPath = await projectFixture()
    const { child, url } = await startCliApp(projectPath)

    try {
      const response = await fetch(new URL('/api/projects', url))
      const catalog = await response.json() as { projects: Array<{ id: string, path: string }> }
      expect(catalog.projects).toEqual([expect.objectContaining({ path: projectPath })])
      expect(new URL(url).searchParams.get('project')).toBe(catalog.projects[0]?.id)
    }
    finally {
      await stopChild(child)
    }
  })

  it('streams project file changes to browser clients', async () => {
    const projectPath = await projectFixture()
    const launched = await launchCraftHubApp(projectPath, {
      open: false,
      runtime: new CraftHubRuntime(join(projectPath, '.event-data')),
    })
    const abort = new AbortController()
    const nativeEmit = FSWatcher.prototype.emit
    let dropStartupNotification = true
    // Model the native startup window: ready can precede the first OS callback.
    const nativeEvents = vi.spyOn(FSWatcher.prototype, 'emit').mockImplementation(function (this: FSWatcher, event, ...args) {
      if (event === 'all' && dropStartupNotification
        && (args[0] === 'add' || args[0] === 'change')
        && (args[1] === join(projectPath, 'README.md') || args[1] === join(projectPath, 'package.json'))) {
        dropStartupNotification = false
        return false
      }
      return nativeEmit.call(this, event, ...args)
    })

    try {
      const response = await fetch(new URL('/api/events', launched.url), { signal: abort.signal })
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      const reader = response.body!.getReader()
      await acknowledgeProjectWatcher(reader, projectPath)
      await writeFile(join(projectPath, 'package.json'), JSON.stringify({ scripts: { dev: 'vite --host' } }))

      const output = await readUntilEvent(reader, '"scopes":["capabilities"]', 3_000)
      expect(output).toContain('event: project-change')
      expect(output).toContain(`"projectId":"${launched.project.id}"`)
      expect(output).toContain('"scopes":["capabilities"]')
      expect(dropStartupNotification).toBe(false)
      await reader.cancel()
    }
    finally {
      abort.abort()
      try {
        await launched.close()
      }
      finally {
        nativeEvents.mockRestore()
        await rm(projectPath, { recursive: true, force: true })
      }
    }
  })

  it('bounds watcher startup failure and stops probe writes after timeout', async () => {
    const projectPath = await projectFixture()
    const launched = await launchCraftHubApp(projectPath, {
      open: false,
      runtime: new CraftHubRuntime(join(projectPath, '.event-data')),
    })
    const abort = new AbortController()
    const nativeEmit = FSWatcher.prototype.emit
    const nativeEvents = vi.spyOn(FSWatcher.prototype, 'emit').mockImplementation(function (this: FSWatcher, event, ...args) {
      if (event === 'all' && args[1] === join(projectPath, 'README.md'))
        return false
      return nativeEmit.call(this, event, ...args)
    })
    try {
      const response = await fetch(new URL('/api/events', launched.url), { signal: abort.signal })
      const reader = response.body!.getReader()
      const started = performance.now()
      await expect(acknowledgeProjectWatcher(reader, projectPath)).rejects.toThrow('Project watcher did not acknowledge startup')
      const elapsed = performance.now() - started
      expect(elapsed).toBeGreaterThanOrEqual(watcherStartupTimeoutMs - 50)
      expect(elapsed).toBeLessThan(watcherStartupTimeoutMs * 2)
      const probePath = join(projectPath, 'README.md')
      const stoppedContent = await readFile(probePath, 'utf8')
      await delay(watcherProbeIntervalMs + 50)
      expect(await readFile(probePath, 'utf8')).toBe(stoppedContent)
    }
    finally {
      abort.abort()
      try {
        await launched.close()
      }
      finally {
        nativeEvents.mockRestore()
        await rm(projectPath, { recursive: true, force: true })
      }
    }
  })

  it('updates revisioned settings and streams changes to browser clients', async () => {
    const projectPath = await projectFixture()
    const launched = await launchCraftHubApp(projectPath, {
      open: false,
      runtime: new CraftHubRuntime(join(projectPath, '.settings-data')),
    })
    const abort = new AbortController()

    try {
      const initial = await fetch(new URL('/api/settings', launched.url)).then(response => response.json()) as { revision: string }
      const events = await fetch(new URL('/api/events', launched.url), { signal: abort.signal })
      const reader = events.body!.getReader()
      const updatedResponse = await fetch(new URL('/api/settings', launched.url), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision: initial.revision, settings: { 'workbench.locale': 'zh-CN' } }),
      })
      expect(updatedResponse.status).toBe(200)
      expect(await updatedResponse.json()).toMatchObject({ settings: { 'workbench.locale': 'zh-CN' } })

      let output = ''
      const timeout = Date.now() + 3_000
      while (!output.includes('event: settings-change') && Date.now() < timeout) {
        const chunk = await readChunk(reader, Math.max(timeout - Date.now(), 1))
        if (chunk.done)
          break
        output += new TextDecoder().decode(chunk.value)
      }
      expect(output).toContain('event: settings-change')
      expect(output).toContain('workbench.locale')

      const staleResponse = await fetch(new URL('/api/settings', launched.url), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision: initial.revision, settings: { 'workbench.locale': 'en' } }),
      })
      expect(staleResponse.status).toBe(409)
      await reader.cancel()
    }
    finally {
      abort.abort()
      await launched.close()
    }
  })

  it('updates machine-local capability pins through the project API', async () => {
    const projectPath = await projectFixture()
    const launched = await launchCraftHubApp(projectPath, {
      open: false,
      runtime: new CraftHubRuntime(join(projectPath, '.pin-api-data')),
    })

    try {
      const capabilities = await fetch(new URL(`/api/projects/${launched.project.id}/capabilities`, launched.url))
        .then(response => response.json()) as Array<{ id: string }>
      const capabilityId = capabilities[0]!.id
      const updated = await fetch(new URL(`/api/projects/${launched.project.id}/pins`, launched.url), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capabilityIds: [capabilityId] }),
      })

      expect(updated.status).toBe(200)
      await expect(updated.json()).resolves.toEqual({
        projectId: launched.project.id,
        capabilityIds: [capabilityId],
      })
      await expect(fetch(new URL(`/api/projects/${launched.project.id}/pins`, launched.url))
        .then(response => response.json()))
        .resolves
        .toEqual({ projectId: launched.project.id, capabilityIds: [capabilityId] })
    }
    finally {
      await launched.close()
    }
  })

  it('serves a validated repository-local project icon', async () => {
    const projectPath = await projectFixture()
    await mkdir(join(projectPath, '.craft-hub'), { recursive: true })
    await writeFile(join(projectPath, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    await writeFile(join(projectPath, '.craft-hub', 'project.jsonc'), `${JSON.stringify({
      version: 1,
      project: { icon: './icon.svg' },
    }, null, 2)}\n`)
    const launched = await launchCraftHubApp(projectPath, {
      open: false,
      runtime: new CraftHubRuntime(join(projectPath, '.icon-data')),
    })

    try {
      const response = await fetch(new URL(`/api/projects/${launched.project.id}/icon`, launched.url))
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/svg+xml')
      expect(await response.text()).toContain('<svg')
    }
    finally {
      await launched.close()
    }
  })

  it('streams command output before a long-running command completes', async () => {
    const projectPath = await projectFixture()
    await writeFile(join(projectPath, 'package.json'), JSON.stringify({
      scripts: {
        dev: `node -e "console.log('server-ready'); setTimeout(() => {}, 300)"`,
      },
    }))
    const runtime = new CraftHubRuntime(join(projectPath, '.run-data'))
    const launched = await launchCraftHubApp(projectPath, { open: false, runtime })

    try {
      await runtime.projects.setTrust(launched.project.id, 'trusted')
      const capability = (await runtime.capabilities(launched.project.id)).find(item => item.name === 'dev')!
      const response = await fetch(new URL(`/api/projects/${launched.project.id}/run`, launched.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capabilityId: capability.id }),
      })

      expect(response.headers.get('content-type')).toContain('application/x-ndjson')
      const lines = (await response.text()).trim().split('\n').map(line => JSON.parse(line) as { type: string, chunk?: string })
      expect(lines[0]?.type).toBe('start')
      expect(lines.at(-1)?.type).toBe('complete')
      expect(lines.some(line => line.type === 'output' && line.chunk?.includes('server-ready'))).toBe(true)
      const summaries = await fetch(new URL('/api/runs/summary', launched.url)).then(response => response.json())
      expect(summaries).toEqual([
        expect.objectContaining({ projectId: launched.project.id, running: 0, lastStatus: 'completed' }),
      ])
    }
    finally {
      await launched.close()
    }
  })

  it('accepts input for a streamed PTY run', async () => {
    const projectPath = await projectFixture()
    await writeFile(join(projectPath, 'package.json'), JSON.stringify({
      scripts: {
        interactive: `node -e "process.stdin.once('data', data => { console.log('received:' + data.toString().trim()); process.exit(0) })"`,
      },
    }))
    const runtime = new CraftHubRuntime(join(projectPath, '.input-data'))
    const launched = await launchCraftHubApp(projectPath, { open: false, runtime })

    try {
      await runtime.projects.setTrust(launched.project.id, 'trusted')
      const capability = (await runtime.capabilities(launched.project.id)).find(item => item.name === 'interactive')!
      const response = await fetch(new URL(`/api/projects/${launched.project.id}/run`, launched.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capabilityId: capability.id }),
      })
      const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
      let output = ''
      let runId = ''
      while (!runId) {
        const chunk = await readChunk(reader)
        output += chunk.value ?? ''
        for (const line of output.split('\n').slice(0, -1).filter(Boolean)) {
          const event = JSON.parse(line) as { type: string, run?: { id: string } }
          if (event.type === 'start')
            runId = event.run!.id
        }
      }

      const inputResponse = await fetch(new URL(`/api/runs/${runId}/input`, launched.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: 'hello over http\r' }),
      })
      expect(inputResponse.status).toBe(202)
      while (true) {
        const chunk = await readChunk(reader)
        output += chunk.value ?? ''
        if (chunk.done)
          break
      }
      expect(output).toContain('received:hello over http')
      expect(output).toContain('"type":"complete"')
    }
    finally {
      await launched.close()
    }
  })
})

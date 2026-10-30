import type { CommandCapability, RunStreamEvent } from '../src/types'
import { Buffer } from 'node:buffer'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-command-review-')))
  await writeFile(join(root, 'package.json'), '{}')
  const command: CommandCapability = {
    id: 'review:echo',
    kind: 'command',
    name: 'Reviewed echo',
    source: 'package.json',
    invocation: { command: process.execPath, args: ['-e', 'console.log(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd()}));console.error("fixture-stderr")', '--'], cwd: root, requiredEnv: [] },
    inputs: [{ id: 'message', type: 'text', argumentStyle: 'positional', required: true }],
  }
  const runtime = new CraftHubRuntime({
    dataDir: join(root, 'data'),
    configDir: join(root, 'config'),
    capabilityProviders: [{ id: 'review-fixture', discover: async () => [structuredClone(command)] }],
  })
  const settingsWatch = vi.spyOn(runtime.settings, 'startWatching').mockResolvedValue()
  const configWatch = vi.spyOn(runtime.userConfig, 'startWatching').mockResolvedValue()
  const app = await startCraftHubServer({ port: 0, runtime })
  const project = await runtime.addProject(root)
  const projectPath = `/api/projects/${project.id}`
  const inputs = { message: 'hello; $(not-a-shell) 中文' }
  async function request(path: string, body?: unknown, method = 'POST', owner = 'fixture-owner') {
    return fetch(`${app.url}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${owner}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
  }
  async function prepare(owner?: string): Promise<{ reviewId: string }> {
    const response = await request(`${projectPath}/command-review`, { capabilityId: command.id, inputs }, 'POST', owner)
    expect(response.status).toBe(200)
    return response.json()
  }
  async function close() {
    await app.close({ processExiting: true })
    settingsWatch.mockRestore()
    configWatch.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
  return { root, command, runtime, project, projectPath, inputs, app, request, prepare, close }
}

describe('hTTP command review', () => {
  it('keeps untrusted discovery and cancelled reviews free of writes and execution', async () => {
    const f = await fixture()
    try {
      const review = await f.prepare()
      expect((await f.runtime.projects.get(f.project.id)).trust).toBe('untrusted')
      expect(await f.runtime.store.listRuns()).toEqual([])
      expect((await f.request(`${f.projectPath}/command-review/${review.reviewId}`, undefined, 'DELETE')).status).toBe(200)
      expect((await f.request(`${f.projectPath}/trust`, { reviewId: review.reviewId })).status).toBe(409)
      expect((await f.request(`${f.projectPath}/run`, { capabilityId: f.command.id, inputs: f.inputs, reviewId: review.reviewId })).status).toBe(409)
      expect((await f.runtime.projects.get(f.project.id)).trust).toBe('untrusted')
      expect(await f.runtime.store.listRuns()).toEqual([])
    }
    finally { await f.close() }
  })

  it('binds trust and confirmation to the caller identity and frozen declaration', async () => {
    const f = await fixture()
    try {
      const review = await f.prepare()
      expect((await f.request(`${f.projectPath}/trust`, { reviewId: review.reviewId }, 'POST', 'another-caller')).status).toBe(409)
      expect((await f.request(`${f.projectPath}/run`, { capabilityId: f.command.id, inputs: f.inputs, reviewId: review.reviewId }, 'POST', 'another-caller')).status).toBe(409)
      f.command.script = 'changed after review'
      const rejected = await f.request(`${f.projectPath}/trust`, { reviewId: review.reviewId })
      expect(rejected.status).toBe(409)
      expect(await rejected.json()).toMatchObject({ reviewRequired: true })
      expect((await f.runtime.projects.get(f.project.id)).trust).toBe('untrusted')
      expect(await f.runtime.store.listRuns()).toEqual([])
    }
    finally { await f.close() }
  })

  it('runs exact structured argv in the project cwd only once after explicit trust', async () => {
    const f = await fixture()
    try {
      const untrusted = await f.prepare()
      expect((await f.request(`${f.projectPath}/run`, { capabilityId: f.command.id, inputs: f.inputs, reviewId: untrusted.reviewId })).status).toBe(409)
      expect(await f.runtime.store.listRuns()).toEqual([])
      const review = await f.prepare()
      expect((await f.request(`${f.projectPath}/trust`, { reviewId: review.reviewId })).status).toBe(200)
      const responses = await Promise.all([
        f.request(`${f.projectPath}/run`, { capabilityId: f.command.id, inputs: f.inputs, reviewId: review.reviewId }),
        f.request(`${f.projectPath}/run`, { capabilityId: f.command.id, inputs: f.inputs, reviewId: review.reviewId }),
      ])
      expect(responses.map(response => response.status).sort()).toEqual([200, 409])
      const output = await responses.find(response => response.status === 200)!.text()
      const events = output.trim().split('\n').map(line => JSON.parse(line) as RunStreamEvent)
      const last = events.at(-1)!
      expect(last.type).toBe('complete')
      if (last.type !== 'complete')
        throw new Error('Missing complete event')
      expect(last.run.status).toBe('completed')
      expect(last.run.args.at(-1)).toBe(f.inputs.message)
      expect(last.run.cwd).toBe(f.root)
      expect(last.run.stdout).toContain(f.inputs.message)
      // The shared PTY merges stderr into its ordered terminal output.
      expect(last.run.stdout).toContain('fixture-stderr')
      expect(await f.runtime.store.listRuns()).toHaveLength(1)
    }
    finally { await f.close() }
  })

  it('rechecks the reviewed declaration at the final asynchronous terminal-load boundary', async () => {
    const f = await fixture()
    try {
      await f.runtime.projects.setTrust(f.project.id, 'trusted')
      const review = await f.prepare()
      let reads = 0
      const discovery = vi.spyOn(f.runtime, 'capabilities').mockImplementation(async () => {
        const command = structuredClone(f.command)
        if (++reads >= 3)
          command.script = 'changed immediately before spawn'
        return [command]
      })
      try {
        const response = await f.request(`${f.projectPath}/run`, { capabilityId: f.command.id, inputs: f.inputs, reviewId: review.reviewId })
        expect(response.status).toBe(409)
        expect(await response.json()).toMatchObject({ reviewRequired: true })
        expect(reads).toBe(3)
        expect(await f.runtime.store.listRuns()).toEqual([])
      }
      finally { discovery.mockRestore() }
    }
    finally { await f.close() }
  })

  it('streams prerequisite startup output exactly once across the initial run snapshot boundary', async () => {
    const f = await fixture()
    try {
      f.command.invocation.prerequisites = [{ command: process.execPath, args: ['-e', 'console.log("fixture-prerequisite")'], cwd: f.root, requiredEnv: [], label: 'Prepare fixture' }]
      const review = await f.prepare()
      await f.request(`${f.projectPath}/trust`, { reviewId: review.reviewId })
      const response = await f.request(`${f.projectPath}/run`, { capabilityId: f.command.id, inputs: f.inputs, reviewId: review.reviewId })
      expect(response.status).toBe(200)
      const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line) as RunStreamEvent)
      const first = events[0]!
      expect(first.type).toBe('start')
      if (first.type !== 'start')
        throw new Error('Missing start event')
      const streamedOutput = first.run.stdout + events.flatMap(item => item.type === 'output' ? [item.chunk] : []).join('')
      expect(streamedOutput.match(/\[Craft Hub 1\/2\]/g)).toHaveLength(1)
      expect(streamedOutput.match(/fixture-prerequisite/g)).toHaveLength(1)
      const final = events.at(-1)!
      expect(final.type).toBe('complete')
      if (final.type === 'complete')
        expect(streamedOutput).toBe(final.run.stdout)
    }
    finally { await f.close() }
  })

  it('supports existing PTY input, resize and cancellation after a reviewed start', async () => {
    const f = await fixture()
    try {
      f.command.inputs = []
      f.command.invocation.args = ['-e', 'process.stdin.setRawMode(true);console.log("fixture-ready");process.stdout.on("resize",()=>console.log("fixture-size:"+process.stdout.columns+"x"+process.stdout.rows));process.stdin.on("data",data=>console.log("fixture-input:"+data));setInterval(()=>{},1000)']
      const prepared = await f.request(`${f.projectPath}/command-review`, { capabilityId: f.command.id, inputs: {} })
      const review = await prepared.json() as { reviewId: string }
      await f.request(`${f.projectPath}/trust`, { reviewId: review.reviewId })
      const stream = await f.request(`${f.projectPath}/run`, { capabilityId: f.command.id, inputs: {}, reviewId: review.reviewId })
      expect(stream.status).toBe(200)
      const reader = stream.body!.getReader()
      const decoder = new TextDecoder()
      let output = ''
      const events = () => output.split('\n').slice(0, -1).map(line => JSON.parse(line) as RunStreamEvent)
      const until = async (text: string, complete = false) => {
        const received = () => complete ? events().some(item => item.type === 'complete') : events().flatMap(item => item.type === 'output' ? [item.chunk] : []).join('').includes(text)
        while (!received()) {
          const item = await reader.read()
          expect(item.done, `Stream ended before ${text}`).toBe(false)
          output += decoder.decode(item.value, { stream: true })
        }
      }
      try {
        await until('fixture-ready')
        const first = JSON.parse(output.split('\n')[0]!) as Extract<RunStreamEvent, { type: 'start' }>
        const path = `/api/runs/${first.run.id}`
        expect((await f.request(`${path}/resize`, { columns: 81, rows: 19 })).status).toBe(202)
        await until('fixture-size:81x19')
        expect((await f.request(`${path}/input`, { data: 'native-input' })).status).toBe(202)
        await until('fixture-input:native-input')
        expect((await f.request(path, undefined, 'DELETE')).status).toBe(200)
        await until('complete', true)
        expect(await f.runtime.store.listRuns()).toEqual([expect.objectContaining({ status: 'cancelled' })])
      }
      finally { await reader.cancel() }
    }
    finally { await f.close() }
  })

  it('rejects cross-origin review creation and invalid review IDs without changing legacy preview', async () => {
    const f = await fixture()
    try {
      const crossOrigin = await fetch(`${f.app.url}${f.projectPath}/command-review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'origin': 'https://example.invalid' },
        body: JSON.stringify({ capabilityId: f.command.id, inputs: f.inputs }),
      })
      expect(crossOrigin.status).toBe(403)
      expect((await f.request(`${f.projectPath}/run`, { capabilityId: f.command.id, inputs: f.inputs, reviewId: {} })).status).toBe(400)
      expect((await f.request(`${f.projectPath}/preview-command`, { capabilityId: f.command.id, inputs: f.inputs })).status).toBe(200)
      expect(await f.runtime.store.listRuns()).toEqual([])
    }
    finally { await f.close() }
  })

  it('preserves non-UTF8 terminal bytes and rejects malformed, mixed and oversized base64 before writing', async () => {
    const f = await fixture()
    try {
      f.command.inputs = []
      f.command.invocation.args = ['-e', 'process.stdin.setRawMode(true);let bytes=Buffer.alloc(0);process.stdin.on("data",chunk=>{bytes=Buffer.concat([bytes,chunk]);if(bytes.length>=7){console.log("fixture-bytes:"+bytes.toString("hex"));process.exit(0)}});console.log("fixture-byte-ready")']
      const response = await f.request(`${f.projectPath}/command-review`, { capabilityId: f.command.id, inputs: {} })
      const review = await response.json() as { reviewId: string }
      await f.request(`${f.projectPath}/trust`, { reviewId: review.reviewId })
      const stream = await f.request(`${f.projectPath}/run`, { capabilityId: f.command.id, inputs: {}, reviewId: review.reviewId })
      expect(stream.status).toBe(200)
      const reader = stream.body!.getReader()
      const decoder = new TextDecoder()
      let raw = ''
      const events = () => raw.split('\n').slice(0, -1).map(line => JSON.parse(line) as RunStreamEvent)
      const until = async (expected: string) => {
        while (!events().flatMap(item => item.type === 'output' ? [item.chunk] : []).join('').includes(expected)) {
          const item = await reader.read()
          expect(item.done).toBe(false)
          raw += decoder.decode(item.value, { stream: true })
        }
      }
      try {
        await until('fixture-byte-ready')
        const first = events().find(item => item.type === 'start')!
        expect(first.type).toBe('start')
        if (first.type !== 'start')
          throw new Error('Missing start event')
        const inputPath = `/api/runs/${first.run.id}/input`
        const write = vi.spyOn(f.runtime, 'writeRun')
        for (const body of [
          { data: 'mixed', dataBase64: 'QQ==' },
          { dataBase64: '!' },
          { dataBase64: 'ab' },
          { dataBase64: 'AB==' },
          { dataBase64: 'AA==\n' },
          { dataBase64: '_w==' },
          { dataBase64: 42 },
          { dataBase64: null },
          { dataBase64: Buffer.alloc(65537).toString('base64') },
        ])
          expect((await f.request(inputPath, body)).status).toBe(400)
        expect(write).not.toHaveBeenCalled()
        const bytes = Buffer.from([0xFF, 0x80, 0x41, 0x03, 0x1B, 0x5B, 0x44])
        expect((await f.request(inputPath, { dataBase64: bytes.toString('base64') })).status).toBe(202)
        await until(`fixture-bytes:${bytes.toString('hex')}`)
        expect(write).toHaveBeenCalledExactlyOnceWith(first.run.id, bytes)
      }
      finally { await reader.cancel() }
    }
    finally { await f.close() }
  })
})

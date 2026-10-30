import type { CommandCapability, RunRecord, RunStreamEvent } from 'craft-hub'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { commandFixtureExecutions, prepareCommandFixture, withCommandFixtureSidecar } from './project-command-fixture.ts'

// Exercise the exact packaged public APIs consumed by Swift without touching an installed App or real account.
assert.equal(process.platform, 'darwin', 'Native command verification requires macOS')
const app = resolve(process.argv[2] ?? fileURLToPath(new URL('../build/Craft Hub Prototype.app', import.meta.url)))
const evidence = resolve(process.argv[3] ?? fileURLToPath(new URL('../build/project-command-verification', import.meta.url)))
await mkdir(evidence, { recursive: true })
const root = await realpath(await mkdtemp(join(evidence, 'run-')))
const fixture = await prepareCommandFixture(root)
const checks: string[] = []
let failure: string | undefined
try {
  await access(join(app, 'Contents/Resources/SwiftTerm_SwiftTerm.bundle/Contents/Resources/default.metallib'))
  const license = await readFile(join(app, 'Contents/Resources/CraftHubMac_CraftHubMac.bundle/Contents/Resources/ThirdPartyLicenses/SwiftTerm.txt'), 'utf8')
  assert.equal(license, await readFile(new URL('../Sources/CraftHubMac/Resources/ThirdPartyLicenses/SwiftTerm.txt', import.meta.url), 'utf8'))
  checks.push('SwiftTerm resources and exact bundled MIT notice are present')
  await withCommandFixtureSidecar(app, root, async ({ request, origin }) => {
    async function json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
      const response = await request(path, method, body)
      assert.equal(response.status, 200, `${method} ${path}: ${response.status} ${await response.clone().text()}`)
      return response.json() as Promise<T>
    }
    const registration = await request('/api/projects', 'POST', { path: fixture.project })
    assert.equal(registration.status, 201)
    const project = await registration.json() as { id: string, trust: string }
    assert.equal(project.trust, 'untrusted')
    const path = `/api/projects/${project.id}`
    const discovery = await json<{ capabilities: CommandCapability[] }>(`${path}/capability-discovery`)
    const command = (name: string) => {
      const value = discovery.capabilities.find(item => item.kind === 'command' && item.name === name)
      assert(value, `Missing fixture command ${name}`)
      return value
    }
    const inspect = command('inspect')
    const terminal = command('terminal')
    const heartbeat = command('heartbeat')
    const terminals = await json<{ version: number, applications: string[] }>('/api/native-host/terminal-applications')
    assert.equal(terminals.version, 1)
    assert(Array.isArray(terminals.applications) && terminals.applications.every(item => ['Terminal', 'iTerm', 'Ghostty', 'Warp'].includes(item)))
    assert.equal((await fetch(new URL('/api/native-host/terminal-applications', origin))).status, 403)
    assert.equal((await request('/api/native-host/terminal-applications?application=other')).status, 400)
    const terminalChoice = terminals.applications[0] ?? 'Terminal'
    for (const input of [
      { projectId: project.id, application: terminalChoice, path: fixture.project },
      { projectId: project.id, application: terminalChoice, runId: 'fixture-run' },
      { projectId: project.id, application: 'Not An Installed Fixture Terminal' },
      { projectId: 'missing-fixture-project', application: terminalChoice },
      { projectId: project.id, capabilityId: 'missing-fixture-command', application: terminalChoice },
    ])
      assert.equal((await request('/api/native-host/open-project-terminal', 'POST', input)).status, 400)
    assert.deepEqual(await json('/api/runs'), [])
    assert.deepEqual(await commandFixtureExecutions(fixture.marker), [])
    checks.push('native external terminal boundary: installed list and invalid/override rejection; no external application opened')
    const inputs = { message: 'native; $(literal) 中文', mode: 'beta', verbose: 'true' }
    async function review(capabilityId: string, values: Record<string, string>) {
      return json<{ reviewId: string, project: { trust: string }, invocation: { args: string[], cwd: string } }>(`${path}/command-review`, 'POST', { capabilityId, inputs: values })
    }
    const cancelled = await review(inspect.id, inputs)
    assert.equal(cancelled.project.trust, 'untrusted')
    assert.equal(cancelled.invocation.cwd, fixture.project)
    assert.deepEqual(await json('/api/runs'), [])
    assert.deepEqual(await commandFixtureExecutions(fixture.marker), [])
    assert.equal((await request(`${path}/command-review/${cancelled.reviewId}`, 'DELETE')).status, 200)
    assert.equal((await request(`${path}/trust`, 'POST', { reviewId: cancelled.reviewId })).status, 409)
    assert.equal((await request(`${path}/run`, 'POST', { capabilityId: inspect.id, inputs, reviewId: cancelled.reviewId })).status, 409)
    checks.push('untrusted review/cancel: zero trust changes and zero executions')

    const stale = await review(inspect.id, inputs)
    const packagePath = join(fixture.project, 'package.json')
    const original = await readFile(packagePath, 'utf8')
    const declaration = JSON.parse(original)
    declaration.scripts.inspect += ' --changed-after-review'
    await writeFile(packagePath, JSON.stringify(declaration))
    assert.equal((await request(`${path}/trust`, 'POST', { reviewId: stale.reviewId })).status, 409)
    assert.equal((await request(`${path}/run`, 'POST', { capabilityId: inspect.id, inputs, reviewId: stale.reviewId })).status, 409)
    await writeFile(packagePath, original)
    assert.equal((await json<{ projects: Array<{ id: string, trust: string }> }>('/api/projects')).projects.find(item => item.id === project.id)?.trust, 'untrusted')
    assert.deepEqual(await commandFixtureExecutions(fixture.marker), [])
    checks.push('changed package script: rejected before trust or execution')

    const accepted = await review(inspect.id, inputs)
    await json(`${path}/trust`, 'POST', { reviewId: accepted.reviewId })
    const stream = await request(`${path}/run`, 'POST', { capabilityId: inspect.id, inputs, reviewId: accepted.reviewId })
    assert.equal(stream.status, 200)
    const frames = (await stream.text()).trim().split('\n').map(line => JSON.parse(line) as RunStreamEvent)
    const complete = frames.at(-1)!
    assert.equal(complete.type, 'complete')
    assert(complete.type === 'complete')
    assert.equal(complete.run.status, 'completed')
    assert.equal(complete.run.cwd, fixture.project)
    assert(complete.run.stdout.includes('fixture-stderr:inspect'))
    const executions = await commandFixtureExecutions(fixture.marker)
    assert.deepEqual(executions.map(item => item.mode), ['inspect'])
    assert.deepEqual(executions[0]!.args, ['--message', inputs.message, '--mode=beta', '--verbose'])
    assert.equal((await request(`${path}/run`, 'POST', { capabilityId: inspect.id, inputs, reviewId: accepted.reviewId })).status, 409)
    assert.equal((await commandFixtureExecutions(fixture.marker)).length, 1)
    checks.push('explicit trust/run: one process, exact argv/cwd, ANSI/stdout/merged stderr, replay rejected')

    async function running(capabilityId: string) {
      const approved = await review(capabilityId, {})
      const response = await request(`${path}/run`, 'POST', { capabilityId, inputs: {}, reviewId: approved.reviewId })
      assert.equal(response.status, 200)
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let text = ''
      const events = () => text.split('\n').slice(0, -1).map(line => JSON.parse(line) as RunStreamEvent)
      const until = async (expected: string | 'complete') => {
        const ready = () => expected === 'complete'
          ? events().some(item => item.type === 'complete')
          : events().flatMap(item => item.type === 'output' ? [item.chunk] : []).join('').includes(expected)
        while (!ready()) {
          const item = await reader.read()
          assert(!item.done, `Command stream ended before ${expected}`)
          text += decoder.decode(item.value, { stream: true })
          assert(text.length <= 1024 * 1024, 'Oversized command fixture stream')
        }
      }
      return { reader, events, until, run: () => {
        const first = events().find(item => item.type === 'start')
        assert(first?.type === 'start')
        return first.run
      } }
    }
    const interactive = await running(terminal.id)
    try {
      await interactive.until('fixture-terminal-ready')
      const runPath = `/api/runs/${interactive.run().id}`
      assert.equal((await request(`${runPath}/resize`, 'POST', { columns: 81, rows: 19 })).status, 202)
      await interactive.until('fixture-size:81x19')
      assert.equal((await request(`${runPath}/input`, 'POST', { dataBase64: Buffer.from('native terminal 中文\r').toString('base64') })).status, 202)
      await interactive.until('fixture-echo:native terminal 中文')
      await request(`${runPath}/input`, 'POST', { data: 'exit\r' })
      await interactive.until('complete')
      const final = interactive.events().at(-1)!
      assert(final.type === 'complete' && final.run.status === 'completed')
    }
    finally { await interactive.reader.cancel() }
    checks.push('interactive PTY: Unicode line input, echo, 81x19 resize and normal exit')

    const longRunning = await running(heartbeat.id)
    await longRunning.until('fixture-heartbeat-ready')
    const detached = longRunning.run()
    await longRunning.reader.cancel()
    const history = await json<RunRecord[]>('/api/runs')
    assert(history.some(item => item.id === detached.id && item.status === 'running'))
    const stopped = await json<RunRecord>(`/api/runs/${detached.id}`, 'DELETE')
    assert.equal(stopped.status, 'cancelled')
    const records = await json<RunRecord[]>('/api/runs')
    assert.equal(records.length, 3)
    assert(records.some(item => item.id === detached.id && item.status === 'cancelled'))
    assert.deepEqual((await commandFixtureExecutions(fixture.marker)).map(item => item.mode), ['inspect', 'terminal', 'heartbeat'])
    checks.push('detached stream: recovered running record from history, explicit stop persisted cancellation')
  })
}
catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error)
  process.exitCode = 1
}
finally {
  const hashes = Object.fromEntries(await Promise.all(['Contents/MacOS/CraftHubMac', 'Contents/Resources/app/apps/desktop/dist/sidecar.mjs'].map(async file => [file, createHash('sha256').update(await readFile(join(app, file))).digest('hex')])))
  await writeFile(join(root, 'report.json'), JSON.stringify({ app, root, hashes, checks, failure, finishedAt: new Date().toISOString(), evidencePreserved: true }, null, 2))
  console.log(JSON.stringify({ passed: !failure, checks, evidence: root, failure }))
}

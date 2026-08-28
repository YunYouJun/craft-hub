import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { DevRuntimeSupervisor } from './dev-runtime-supervisor.ts'
import { startWebDevServer } from './dev-vite.ts'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2]

if (mode !== 'desktop' && mode !== 'web')
  throw new Error('Usage: tsx scripts/dev-environment.ts <desktop|web>')

const webServer = await startWebDevServer()
const devStateDirectory = await mkdtemp(join(tmpdir(), 'craft-hub-dev-'))
const buildSignalPath = join(devStateDirectory, 'runtime-build')
const children: ChildProcess[] = []
const childExits: Array<Promise<{ code: number | null, signal: NodeJS.Signals | null }>> = []
let stopping: Promise<void> | undefined
let rejectRuntimeFailure!: (error: Error) => void
const runtimeFailure = new Promise<never>((_resolve, reject) => {
  rejectRuntimeFailure = reject
})

function spawnWorkspace(args: string[], environment = process.env): ChildProcess {
  const child = spawn('pnpm', args, {
    cwd: repositoryRoot,
    env: environment,
    shell: false,
    stdio: 'inherit',
  })
  children.push(child)
  childExits.push(new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  }))
  return child
}

function failRuntime(error: Error): void {
  if (!stopping)
    rejectRuntimeFailure(error)
}

const runtimeSupervisor = new DevRuntimeSupervisor(() => {
  if (mode === 'desktop') {
    return spawnWorkspace(['--filter', '@craft-hub/desktop', 'dev'], {
      ...process.env,
      CRAFT_HUB_DEV_URL: webServer.url,
    })
  }
  return spawnWorkspace(['--filter', 'craft-hub', 'exec', 'tsx', 'src/cli.ts', 'ui'])
}, failRuntime)

let observedBuildRevision = ''
async function applyBuildSignal(): Promise<void> {
  const revision = await readFile(buildSignalPath, 'utf8').catch(() => '')
  if (!revision || revision === observedBuildRevision)
    return
  observedBuildRevision = revision
  await runtimeSupervisor.applyBuild(revision)
}

const buildSignalWatcher = watch(devStateDirectory, (_event, filename) => {
  if (String(filename) === 'runtime-build')
    void applyBuildSignal().catch(error => failRuntime(error instanceof Error ? error : new Error(String(error))))
})

function stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  stopping ??= (async () => {
    buildSignalWatcher.close()
    await runtimeSupervisor.stop(signal)
    for (const child of children)
      child.kill(signal)
    const closeWebServer = webServer.close()
    await Promise.allSettled(childExits)
    await closeWebServer
    await rm(devStateDirectory, { recursive: true, force: true })
  })()
  return stopping
}

try {
  process.stdout.write(`Craft Hub web: ${webServer.url}\n`)

  spawnWorkspace(['--filter', 'craft-hub', 'dev'], {
    ...process.env,
    CRAFT_HUB_DEV_BUILD_SIGNAL: buildSignalPath,
  })

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as NodeJS.Signals[])
    process.once(signal, () => void stop(signal))

  const result = await Promise.race([webServer.closed, runtimeFailure, ...childExits])

  if (!stopping && result.code !== 0 && !result.signal)
    throw new Error(`Development process exited with code ${String(result.code)}`)
}
finally {
  await stop()
}

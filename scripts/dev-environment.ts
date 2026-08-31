import type { ChildProcess } from 'node:child_process'
import type { WebDevServer } from './dev-vite.ts'
import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { waitForRuntimeReady } from './dev-runtime-readiness.ts'
import { DevRuntimeSupervisor } from './dev-runtime-supervisor.ts'
import { startInitialDevelopmentServices } from './dev-startup.ts'
import { startWebDevServer } from './dev-vite.ts'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2]

if (mode !== 'desktop' && mode !== 'web')
  throw new Error('Usage: tsx scripts/dev-environment.ts <desktop|web>')

const devStateDirectory = await mkdtemp(join(tmpdir(), 'craft-hub-dev-'))
const buildSignalPath = join(devStateDirectory, 'runtime-build')
const runtimeHealthUrl = 'http://127.0.0.1:4318/api/health'
const children: ChildProcess[] = []
const childExits: Array<Promise<{ code: number | null, signal: NodeJS.Signals | null }>> = []
let webServer: WebDevServer | undefined
let runtimeSupervisor: DevRuntimeSupervisor | undefined
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

let pendingBuildRevision = ''
let initialBuildResolved = false
let resolveInitialBuild!: (revision: string) => void
const initialBuild = new Promise<string>((resolveBuild) => {
  resolveInitialBuild = resolveBuild
})

async function restartRuntime(revision: string): Promise<void> {
  if (!runtimeSupervisor)
    return
  await runtimeSupervisor.applyBuild(revision)
  await Promise.race([waitForRuntimeReady(runtimeHealthUrl), runtimeFailure])
}

async function applyBuildSignal(): Promise<void> {
  const revision = await readFile(buildSignalPath, 'utf8').catch(() => '')
  if (!revision || revision === pendingBuildRevision)
    return
  pendingBuildRevision = revision
  if (!initialBuildResolved) {
    initialBuildResolved = true
    resolveInitialBuild(revision)
  }
  await restartRuntime(revision)
}

const buildSignalWatcher = watch(devStateDirectory, (_event, filename) => {
  if (String(filename) === 'runtime-build')
    void applyBuildSignal().catch(error => failRuntime(error instanceof Error ? error : new Error(String(error))))
})

function stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  stopping ??= (async () => {
    buildSignalWatcher.close()
    await runtimeSupervisor?.stop(signal)
    for (const child of children)
      child.kill(signal)
    const closeWebServer = webServer?.close()
    await Promise.allSettled(childExits)
    await closeWebServer
    await rm(devStateDirectory, { recursive: true, force: true })
  })()
  return stopping
}

try {
  spawnWorkspace(['--filter', 'craft-hub', 'dev'], {
    ...process.env,
    CRAFT_HUB_DEV_BUILD_SIGNAL: buildSignalPath,
  })
  const buildWatcherExit = childExits[0]!

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as NodeJS.Signals[])
    process.once(signal, () => void stop(signal))

  await Promise.race([
    initialBuild,
    buildWatcherExit.then(({ code, signal }) => {
      throw new Error(`Runtime build watcher exited before the initial build with code ${String(code)} and signal ${String(signal)}`)
    }),
  ])

  webServer = await startInitialDevelopmentServices(mode, {
    startRuntime: async (initialWebServer) => {
      runtimeSupervisor = new DevRuntimeSupervisor(() => {
        if (mode === 'desktop') {
          if (!initialWebServer)
            throw new Error('Desktop development requires a Vite server')
          return spawnWorkspace(['--filter', '@craft-hub/desktop', 'dev'], {
            ...process.env,
            CRAFT_HUB_DEV_URL: initialWebServer.url,
          })
        }
        return spawnWorkspace(['--filter', 'craft-hub', 'exec', 'tsx', 'src/cli.ts', 'ui'])
      }, failRuntime)
      await restartRuntime(pendingBuildRevision)
    },
    startWeb: () => startWebDevServer(),
  })
  process.stdout.write(`Craft Hub web: ${webServer.url}\n`)

  const result = await Promise.race([webServer.closed, runtimeFailure, ...childExits])

  if (!stopping && result.code !== 0 && !result.signal)
    throw new Error(`Development process exited with code ${String(result.code)}`)
}
finally {
  await stop()
}

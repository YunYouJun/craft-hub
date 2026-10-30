import type { NativeApplicationProcess } from './native-macos-install.ts'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { acquireDevelopmentSessionLock } from './dev-session-lock.ts'
import { installNativeApplication, nativeProductName } from './native-macos-install.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const capture = promisify(execFile)
const mode = process.argv[2] ?? 'run'
if (process.argv.length > 3 || !['run', '--verify', '--logs', '--telemetry'].includes(mode))
  throw new Error('Usage: pnpm reinstall:macos [run|--verify|--logs|--telemetry]')
if (process.platform !== 'darwin')
  throw new Error('The native app can only be built and installed on macOS')
if (process.env.CRAFT_HUB_NATIVE_DATA_DIR || process.env.CRAFT_HUB_NATIVE_OUTPUT_DIR || process.env.CRAFT_HUB_NATIVE_RELEASE === 'true')
  throw new Error('Use pnpm build:macos for isolated candidates and releases; reinstall:macos updates the local daily-use app')

const installDirectory = resolve(process.env.CRAFT_HUB_NATIVE_INSTALL_DIR ?? join(homedir(), 'Applications'))
await mkdir(installDirectory, { recursive: true })
const canonicalInstallDirectory = await realpath(installDirectory)
const target = join(canonicalInstallDirectory, nativeProductName)
const lock = await acquireDevelopmentSessionLock({ lockPath: join(canonicalInstallDirectory, '.craft-hub-native-install.lock') })
const abort = new AbortController()
let interrupted = false
function onSignal() {
  interrupted = true
  abort.abort()
}
process.on('SIGINT', onSignal)
process.on('SIGTERM', onSignal)

async function run(command: string, args: string[], env = process.env): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', detached: true, shell: false })
    const stop = () => {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
            throw error
        }
      }
    }
    abort.signal.addEventListener('abort', stop, { once: true })
    if (abort.signal.aborted)
      stop()
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      abort.signal.removeEventListener('abort', stop)
      if (code === 0)
        resolvePromise()
      else
        reject(new Error(`${command} exited with ${signal ?? code}`))
    })
  })
}

try {
  const buildRoot = join(root, 'apps/macos/build/local-installs')
  await mkdir(buildRoot, { recursive: true })
  const output = await mkdtemp(join(buildRoot, 'candidate-'))
  const helper = join(output, 'native-lifecycle')
  console.log(`Building a fresh native app for ${target}`)
  await run('pnpm', ['build:macos'], { ...process.env, CRAFT_HUB_NATIVE_OUTPUT_DIR: output })
  await run('/usr/bin/xcrun', ['swiftc', join(root, 'scripts/native-macos-lifecycle.swift'), '-o', helper])
  abort.signal.throwIfAborted()

  async function applications(): Promise<NativeApplicationProcess[]> {
    return JSON.parse((await capture(helper, ['list'], { timeout: 5000 })).stdout) as NativeApplicationProcess[]
  }
  async function processTable() {
    const { stdout } = await capture('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,command='])
    return stdout.split('\n').flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+) (.{24}) (.*)$/)
      return match ? [{ pid: Number(match[1]), parent: Number(match[2]), identity: `${match[3]} ${match[4]}`, command: match[4]! }] : []
    })
  }
  async function stop(bundle: string): Promise<boolean> {
    const executable = join(bundle, 'Contents/MacOS/CraftHubMac')
    const running = (await applications()).filter(app => app.executable === executable)
    if (!running.length)
      return false
    const table = await processTable()
    const owned = new Set(running.map(app => app.pid))
    for (let count = -1; count !== owned.size;) {
      count = owned.size
      for (const child of table) {
        if (owned.has(child.parent))
          owned.add(child.pid)
      }
    }
    const recorded = table.filter(app => owned.has(app.pid))
    for (const app of running) {
      console.log(`Requesting normal quit of installed native app (PID ${app.pid})`)
      await capture(helper, ['quit', String(app.pid), app.executable, String(app.startedAt)], { timeout: 5000 })
    }
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const current = await processTable()
      if (recorded.every(app => !current.some(candidate => candidate.pid === app.pid && candidate.identity === app.identity)))
        return true
      await setTimeout(200)
    }
    throw new Error('The installed app or its sidecar is still running. Finish its work/quit confirmation, then retry; no process was force-stopped')
  }
  async function launch(bundle: string): Promise<NativeApplicationProcess> {
    await capture('/usr/bin/open', ['-n', bundle])
    const executable = join(bundle, 'Contents/MacOS/CraftHubMac')
    const deadline = Date.now() + 20_000
    let candidate: NativeApplicationProcess | undefined
    let observedAt = 0
    while (Date.now() < deadline) {
      const running = (await applications()).find(app => app.executable === executable)
      const table = await processTable()
      if (running && table.some(child => child.parent === running.pid && child.command.includes(`${bundle}/Contents/Resources/app/apps/desktop/dist/sidecar.mjs`))) {
        if (candidate?.pid === running.pid && candidate.startedAt === running.startedAt && Date.now() - observedAt >= 2000)
          return running
        if (candidate?.pid !== running.pid || candidate.startedAt !== running.startedAt) {
          candidate = running
          observedAt = Date.now()
        }
      }
      else {
        candidate = undefined
      }
      await setTimeout(200)
    }
    throw new Error(`The installed app did not start its own runtime at ${bundle}. Close any other native copy using the daily profile or resolve the app's startup error, then retry`)
  }
  // Once replacement starts, finish installation/recovery even if Ctrl-C arrives. Never abandon a stopped daily app.
  const installed = await installNativeApplication(join(output, nativeProductName), target, {
    copy: async (source, destination) => { await capture('/usr/bin/ditto', [source, destination]) },
    verify: async (bundle) => {
      const { stdout } = await capture('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(bundle, 'Contents/Info.plist')])
      if (stdout.trim() !== 'dev.craft-hub.macos-prototype')
        throw new Error('Refusing to install a different application')
      await capture('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
    },
    stop,
    launch,
  })
  console.log(`Installed and verified ${target} (PID ${installed.process.pid})\nPrevious bundle and installation receipt: ${installed.backupDirectory}`)
  await capture(helper, ['dock', target, installed.backupDirectory], { timeout: 5000 })
  console.log('Refreshed existing Craft Hub Dock entries to the installed native app')
  await lock.release()
  if (!interrupted && (mode === '--logs' || mode === '--telemetry')) {
    await run('/usr/bin/log', ['stream', '--info', '--style', 'compact', '--predicate', `processIdentifier == ${installed.process.pid}${mode === '--telemetry' ? ' AND category == "Performance"' : ''}`])
  }
}
finally {
  await lock.release()
  process.off('SIGINT', onSignal)
  process.off('SIGTERM', onSignal)
  if (interrupted)
    process.exitCode = 130
}

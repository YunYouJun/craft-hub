import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { startWebDevServer } from './dev-vite.ts'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2]

if (mode !== 'desktop' && mode !== 'web')
  throw new Error('Usage: tsx scripts/dev-environment.ts <desktop|web>')

const webServer = await startWebDevServer()
const children: ChildProcess[] = []
const childExits: Array<Promise<{ code: number | null, signal: NodeJS.Signals | null }>> = []
let stopping: Promise<void> | undefined

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

function stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  stopping ??= (async () => {
    for (const child of children)
      child.kill(signal)
    const closeWebServer = webServer.close()
    await Promise.allSettled(childExits)
    await closeWebServer
  })()
  return stopping
}

try {
  process.stdout.write(`Craft Hub web: ${webServer.url}\n`)

  if (mode === 'desktop') {
    spawnWorkspace(['--filter', 'craft-hub', 'dev'])
    spawnWorkspace(['--filter', '@craft-hub/desktop', 'dev'], {
      ...process.env,
      CRAFT_HUB_DEV_URL: webServer.url,
    })
  }
  else {
    spawnWorkspace(['--filter', 'craft-hub', 'exec', 'tsx', 'src/cli.ts', 'ui'])
  }

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as NodeJS.Signals[])
    process.once(signal, () => void stop(signal))

  const result = await Promise.race([webServer.closed, ...childExits])

  if (!stopping && result.code !== 0 && !result.signal)
    throw new Error(`Development process exited with code ${String(result.code)}`)
}
finally {
  await stop()
}

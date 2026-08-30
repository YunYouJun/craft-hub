import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const webRoot = resolve(repositoryRoot, 'apps/web')
const vitePackagePath = fileURLToPath(import.meta.resolve('vite/package.json'))
const viteCliPath = resolve(dirname(vitePackagePath), 'bin/vite.js')
const processShutdownTimeoutMs = 2_000

export interface DevelopmentProcessExit {
  code: number | null
  signal: NodeJS.Signals | null
}

export interface WebDevServer {
  close: () => Promise<void>
  closed: Promise<DevelopmentProcessExit>
  url: string
}

export interface WebDevServerOptions {
  preferredPort?: number
}

/** Start Vite and report the URL it actually bound, including any port fallback. */
export async function startWebDevServer(options: WebDevServerOptions = {}): Promise<WebDevServer> {
  const child = spawn(process.execPath, [
    viteCliPath,
    '--host',
    '127.0.0.1',
    '--port',
    String(options.preferredPort ?? 5173),
    '--clearScreen',
    'false',
  ], {
    cwd: webRoot,
    shell: false,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const closed = processExit(child)
  child.stdout?.on('data', chunk => process.stdout.write(chunk))

  try {
    const url = await developmentUrl(child)
    return {
      close: () => terminateProcess(child, closed),
      closed,
      url,
    }
  }
  catch (error) {
    await terminateProcess(child, closed).catch(() => {})
    throw error
  }
}

async function terminateProcess(child: ChildProcess, closed: Promise<DevelopmentProcessExit>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    await closed
    return
  }

  child.kill('SIGTERM')
  if (await settlesWithin(closed, processShutdownTimeoutMs))
    return

  if (child.exitCode === null && child.signalCode === null)
    child.kill('SIGKILL')
  if (!await settlesWithin(closed, processShutdownTimeoutMs))
    throw new Error('Vite did not exit after SIGTERM and SIGKILL')
}

async function settlesWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolveTimeout) => {
        timer = setTimeout(resolveTimeout, timeoutMs, false)
        timer.unref()
      }),
    ])
  }
  finally {
    if (timer)
      clearTimeout(timer)
  }
}

function developmentUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    const stdout = child.stdout
    if (!stdout)
      return reject(new Error('Vite started without a readable output stream'))

    let output = ''
    let cleanup = () => {}
    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      const match = output.match(/Local:[^\n]*?(http:\/\/127\.0\.0\.1:\d+\/)/)
      if (!match)
        return
      cleanup()
      resolveUrl(match[1])
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup()
      reject(new Error(`Vite exited before reporting its URL (${String(code ?? signal)})`))
    }
    cleanup = () => {
      stdout.off('data', onData)
      child.off('error', onError)
      child.off('exit', onExit)
    }

    stdout.on('data', onData)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

function processExit(child: ChildProcess): Promise<DevelopmentProcessExit> {
  return new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolveExit({ code, signal }))
  })
}

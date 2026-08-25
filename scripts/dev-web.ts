import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const children: ChildProcess[] = [
  spawn('pnpm', ['exec', 'tsx', 'src/cli.ts', 'ui'], { cwd: resolve(workspaceRoot, 'packages/craft-hub'), stdio: 'inherit' }),
  spawn('pnpm', ['exec', 'vite'], { cwd: resolve(workspaceRoot, 'apps/web'), stdio: 'inherit' }),
]

let stopping = false
function stop(signal: NodeJS.Signals = 'SIGTERM'): void {
  if (stopping)
    return
  stopping = true
  for (const child of children)
    child.kill(signal)
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as NodeJS.Signals[])
  process.once(signal, () => stop(signal))

await new Promise<void>((resolve, reject) => {
  for (const child of children) {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      const interrupted = stopping
      stop()
      if (interrupted || code === 0 || signal)
        resolve()
      else
        reject(new Error(`Development process exited with code ${String(code)}`))
    })
  }
})

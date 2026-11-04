import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { SharedCaptureRuntime } from 'craft-hub/shared-runtime'
import { fakeCapturePlugin } from './fake-capture-plugin'

// The entrypoint deliberately has no Electron, HTTP listener, project watcher or cloud plugin.
// The broker owns stdin; EOF is parent loss, NOT a GUI client's disconnection.
let runtime: SharedCaptureRuntime | undefined
let stopping = false
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
async function stop(abort = false): Promise<void> {
  if (stopping)
    return
  stopping = true
  if (abort)
    runtime?.abort()
  const deadline = setTimeout(() => process.exit(2), 5000)
  try {
    await runtime?.close()
  }
  finally {
    clearTimeout(deadline)
    lines.close()
    process.exit(0)
  }
}
process.once('SIGTERM', () => void stop(true))
process.once('SIGINT', () => void stop(true))
lines.once('close', () => void stop(true))

function emit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

async function main(): Promise<void> {
  try {
    const configPath = process.argv[2]
    if (!configPath || !isAbsolute(configPath))
      throw new Error('An absolute fixture configuration is required')
    const config = JSON.parse(await readFile(configPath, 'utf8')) as { fixtureOnly?: boolean, dataDir: string, configDir: string, idleMs?: number, requestMs?: number }
    if (config.fixtureOnly !== true || !isAbsolute(config.dataDir) || !isAbsolute(config.configDir))
      throw new Error('This experimental worker accepts only explicit isolated fixture profiles')
    for (const value of [config.idleMs ?? 30_000, config.requestMs ?? 30_000]) {
      if (!Number.isInteger(value) || value < 50 || value > 300_000)
        throw new Error('Invalid runtime deadline')
    }
    runtime = await SharedCaptureRuntime.open({ ...config, provider: async () => fakeCapturePlugin(config.dataDir), onIdle: () => void stop() })
    emit({ event: 'ready', generation: runtime.generation, profileId: runtime.profileId, pid: process.pid })
    lines.on('line', (line) => {
      if (stopping)
        return
      if (Buffer.byteLength(line) > 300_000) {
        void stop(true)
        return
      }
      let id: string | undefined
      try {
        const envelope = JSON.parse(line) as { id: string, clientId: string, request: unknown }
        if (typeof envelope.id !== 'string' || envelope.id.length > 100 || typeof envelope.clientId !== 'string')
          throw new Error('Invalid request envelope')
        id = envelope.id
        void runtime!.request(envelope.clientId, envelope.request).then(
          result => emit({ id, ok: true, result }),
          () => emit({ id, ok: false, error: 'Request rejected or runtime unavailable' }),
        )
      }
      catch {
        emit({ id, ok: false, error: 'Invalid runtime request' })
      }
    })
  }
  catch {
    emit({ event: 'startup-failed', error: 'Fixture runtime startup failed; check profile ownership and configuration' })
    await stop(true)
  }
}
void main()

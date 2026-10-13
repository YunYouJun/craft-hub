import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { CraftHubRuntime } from '../../../packages/craft-hub/src/runtime.ts'
import { startCraftHubServer } from '../../../packages/craft-hub/src/server.ts'
import { openPersonalWorkbenchTool } from '../../desktop/src/open-targets.ts'
import { createHostRequestHandler, createSessionGuard, runNative, stopNativeActions } from './host'

async function main(): Promise<void> {
  // This isolated host must not attach to a delivery broker configured for another app.
  delete process.env.CRAFT_HUB_DEVICE_CONFIG
  const root = process.env.CRAFT_HUB_TAURI_TRIAL_DIR
  if (!root)
    throw new Error('The Tauri trial requires its own data directory')
  const dataDir = resolve(root, 'runtime')
  const configDir = resolve(root, 'config')
  await Promise.all([mkdir(dataDir, { recursive: true, mode: 0o700 }), mkdir(configDir, { recursive: true, mode: 0o700 })])
  const runtime = new CraftHubRuntime({ dataDir, configDir })
  const secret = randomBytes(32).toString('hex')
  const guard = createSessionGuard(secret)
  const server = await startCraftHubServer({
    host: '127.0.0.1',
    port: 0,
    runtime,
    staticDir: resolve(dirname(fileURLToPath(import.meta.url)), 'web'),
    authorizeRequest: request => guard.authorize(request),
    handleHostRequest: createHostRequestHandler(guard, () => runtime, openPersonalWorkbenchTool, runNative, resolve(dirname(fileURLToPath(import.meta.url)), 'Folder Picker.app/Contents/MacOS/folder-picker')),
  })
  guard.setOrigin(server.url)
  let closing = false
  async function shutdown(): Promise<void> {
    if (closing)
      return
    closing = true
    stopNativeActions()
    const deadline = setTimeout(() => process.exit(1), 5000)
    deadline.unref()
    await server.close({ processExiting: true })
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
  // The Rust host holds this pipe open. EOF also handles a host crash or force quit.
  process.stdin.resume()
  process.stdin.once('end', () => void shutdown())
  process.stdout.write(`${JSON.stringify({ url: `${server.url}/__craft_hub_host/bootstrap?token=${secret}`, pid: process.pid })}\n`)
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Trial startup failed'}\n`)
  process.exit(1)
})

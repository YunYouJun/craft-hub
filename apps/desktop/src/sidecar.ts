import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { communityDistribution, HostExtensionManager, startCraftHubServer } from 'craft-hub'
import { loadDesktopDistributionManifest } from './distribution.ts'
import { createBuiltinHostPlugins, createDesktopHostRuntime } from './host-runtime.ts'
import { createSessionGuard, createSidecarRequestHandler } from './sidecar-host.ts'

/**
 * Runtime sidecar for the native macOS host (ADR 0012). It composes the same runtime as the Electron host, serves it
 * on IPv4 loopback behind a one-use bootstrap, and exits when the native host closes its stdin pipe, including after
 * the host crashes or is force quit.
 */
async function main(): Promise<void> {
  // A sidecar must not attach to a delivery broker configured for another host.
  delete process.env.CRAFT_HUB_DEVICE_CONFIG
  const root = process.env.CRAFT_HUB_SIDECAR_DIR
  if (!root)
    throw new Error('The runtime sidecar requires CRAFT_HUB_SIDECAR_DIR')
  const dataDir = resolve(root, 'runtime')
  const configDir = resolve(root, 'config')
  await Promise.all([mkdir(dataDir, { recursive: true, mode: 0o700 }), mkdir(configDir, { recursive: true, mode: 0o700 })])

  const manifestPath = fileURLToPath(new URL('../distribution.json', import.meta.url))
  const distribution = loadDesktopDistributionManifest(manifestPath)
  const builtinPlugins = createBuiltinHostPlugins({ workstationDirectory: fileURLToPath(new URL('../workstation-runtime', import.meta.url)), dataDir })
  const runtime = await createDesktopHostRuntime({
    builtinPlugins: builtinPlugins.plugins,
    optionalPlugins: builtinPlugins.optionalPlugins,
    configDir,
    dataDir,
    distribution: distribution?.distribution ?? communityDistribution,
    distributionPlugins: distribution?.hostPlugins?.length
      ? { id: distribution.distribution.id, name: distribution.distribution.name, manifestPath, modules: distribution.hostPlugins }
      : undefined,
    hostExtensions: new HostExtensionManager(dataDir),
    logError: message => process.stderr.write(`${message}\n`),
  })
  const secret = randomBytes(32).toString('hex')
  const guard = createSessionGuard(secret)
  const server = await startCraftHubServer({
    host: '127.0.0.1',
    port: 0,
    runtime,
    staticDir: fileURLToPath(new URL('../../web/dist', import.meta.url)),
    authorizeRequest: request => guard.authorize(request),
    handleHostRequest: createSidecarRequestHandler(guard, () => runtime),
  })
  guard.setOrigin(server.url)

  let closing = false
  async function shutdown(): Promise<void> {
    if (closing)
      return
    closing = true
    const deadline = setTimeout(() => process.exit(1), 5000)
    deadline.unref()
    await Promise.allSettled(builtinPlugins.closeConnections())
    await server.close({ processExiting: true })
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
  process.stdin.resume()
  process.stdin.once('end', () => void shutdown())
  process.stdout.write(`${JSON.stringify({ url: `${server.url}/__craft_hub_host/bootstrap?token=${secret}`, pid: process.pid })}\n`)
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Runtime sidecar failed to start'}\n`)
  process.exit(1)
})

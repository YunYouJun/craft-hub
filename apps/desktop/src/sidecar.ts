import type { ProfileLease } from 'craft-hub'
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { communityDistribution, HostExtensionManager, startCraftHubServer } from 'craft-hub'
import { loadDesktopDistributionManifest } from './distribution.ts'
import { bundledHostExtensionControls, createBuiltinHostPlugins, createDesktopHostRuntime } from './host-runtime.ts'
import { NativeCloudService } from './native-cloud.ts'
import { NativeCodexActivity } from './native-codex-activity.ts'
import { createNativeExtensionHandler, NativeExtensionControls } from './native-extensions.ts'
import { NativeDeviceVault, NativeHostChannel } from './native-host-channel.ts'
import { createNativeNavigationService } from './native-navigation.ts'
import { createProjectLaunchService } from './project-launch.ts'
import { createSessionGuard, createSidecarRequestHandler, openSystemTarget } from './sidecar-host.ts'
import { acquireSidecarProfileLease } from './sidecar-profile.ts'
import { takeConfigurationBackupKeys } from './workstation-runtime.ts'

/**
 * Runtime sidecar for the native macOS host (ADR 0012). It composes the same runtime as the Electron host, serves it
 * on IPv4 loopback behind a one-use bootstrap, and exits when the native host closes its stdin pipe, including after
 * the host crashes or is force quit.
 */
async function main(): Promise<void> {
  const root = process.env.CRAFT_HUB_SIDECAR_DIR
  if (!root)
    throw new Error('The runtime sidecar requires CRAFT_HUB_SIDECAR_DIR')
  const lease = await acquireSidecarProfileLease(root)
  try {
    await startSidecar(root, lease)
  }
  catch (error) {
    lease.release()
    throw error
  }
}

async function startSidecar(root: string, profileLease: ProfileLease): Promise<void> {
  const configurationEnvironment = takeConfigurationBackupKeys(process.env)
  // A sidecar must not attach to a delivery broker configured for another host.
  delete process.env.CRAFT_HUB_DEVICE_CONFIG
  const dataDir = resolve(root, 'runtime')
  const configDir = resolve(root, 'config')
  await Promise.all([mkdir(dataDir, { recursive: true, mode: 0o700 }), mkdir(configDir, { recursive: true, mode: 0o700 })])

  const manifestPath = fileURLToPath(new URL('../distribution.json', import.meta.url))
  const distribution = loadDesktopDistributionManifest(manifestPath)
  const builtinPlugins = createBuiltinHostPlugins({ workstationDirectory: fileURLToPath(new URL('../workstation-runtime', import.meta.url)), dataDir, configurationEnvironment })
  const hostExtensions = new HostExtensionManager(dataDir)
  const runtime = await createDesktopHostRuntime({
    builtinPlugins: builtinPlugins.plugins,
    optionalPlugins: builtinPlugins.optionalPlugins,
    configDir,
    dataDir,
    profileLease,
    distribution: distribution?.distribution ?? communityDistribution,
    distributionPlugins: distribution?.hostPlugins?.length
      ? { id: distribution.distribution.id, name: distribution.distribution.name, manifestPath, modules: distribution.hostPlugins }
      : undefined,
    hostExtensions,
    logError: message => process.stderr.write(`${message}\n`),
  })
  const secret = randomBytes(32).toString('hex')
  const nativeApiToken = randomBytes(32).toString('hex')
  const guard = createSessionGuard(secret, nativeApiToken)
  const activity = new NativeCodexActivity({ dataDir })
  await activity.start()
  // The private channel is negotiated by the owning native app. Legacy/preflight sidecars keep cloud disabled.
  const nativeChannel = process.env.CRAFT_HUB_NATIVE_HOST_CHANNEL === '1'
    ? new NativeHostChannel(process.stdin, process.stdout)
    : undefined
  const cloud = nativeChannel
    ? new NativeCloudService({
        endpoint: process.env.CRAFT_HUB_CLOUD_ENDPOINT,
        webOrigin: process.env.CRAFT_HUB_CLOUD_ORIGIN,
        callbackScheme: 'craft-hub-native',
        dataDir,
        platform: process.platform,
        runtime,
        vault: new NativeDeviceVault(nativeChannel),
        openExternal: openSystemTarget,
      }, process.env.CRAFT_HUB_CLOUD_CONFIGURATION_INVALID === '1')
    : undefined
  const bundledControls = bundledHostExtensionControls(hostExtensions, builtinPlugins)
  const extensionHandler = createNativeExtensionHandler(guard, new NativeExtensionControls(
    hostExtensions,
    bundledControls.status,
    new Set(['workstation', ...builtinPlugins.plugins.map(plugin => plugin.id), ...builtinPlugins.optionalPlugins.map(plugin => plugin.id), runtime.distribution.id]),
  ))
  const hostHandler = createSidecarRequestHandler(
    guard,
    () => runtime,
    undefined,
    undefined,
    bundledControls,
    createProjectLaunchService(() => runtime, {
      openURL: openSystemTarget,
      openPath: openSystemTarget,
      reportError: message => process.stderr.write(`${message}\n`),
    }),
    createNativeNavigationService(() => runtime),
  )
  const server = await startCraftHubServer({
    host: '127.0.0.1',
    port: 0,
    runtime,
    staticDir: fileURLToPath(new URL('../../web/dist', import.meta.url)),
    authorizeRequest: request => guard.authorize(request),
    handleHostRequest: async (request, response) => await activity.handle(request, response, guard) || await cloud?.handle(request, response, guard)
      || await extensionHandler(request, response) || hostHandler(request, response),
  })
  guard.setOrigin(server.url)

  let closing = false
  async function shutdown(): Promise<void> {
    if (closing)
      return
    closing = true
    const deadline = setTimeout(() => process.exit(1), 5000)
    deadline.unref()
    const cloudCleanup = cloud?.close()
    nativeChannel?.close()
    await Promise.allSettled([...builtinPlugins.closeConnections(), cloudCleanup, activity.close()])
    await server.close({ processExiting: true })
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
  process.stdin.resume()
  process.stdin.once('end', () => void shutdown())
  process.stdout.write(`${JSON.stringify({ version: 1, url: `${server.url}/__craft_hub_host/bootstrap?token=${secret}`, nativeApiToken, pid: process.pid })}\n`)
  await cloud?.controller.start()
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Runtime sidecar failed to start'}\n`)
  process.exit(1)
})

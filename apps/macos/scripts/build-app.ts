import { execFile, spawn } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { deployDesktop } from '../../../scripts/package-macos.ts'
import { packageWorkstationRuntime } from '../../../scripts/package-workstation-runtime.ts'
import { prepareDesktopArchitecture, prepareDesktopPackage } from '../../../scripts/prepare-desktop-package.ts'
import { embedAppIntents } from './app-intents.ts'
import { bundleMicrosoftTodoConnector, bundleSidecar, sidecarExternals } from './bundle-sidecar.ts'
import { nativeLinkPlist, nativeReleaseConfiguration, nativeUpdatePlist, signNativeBundle, xmlText } from './native-release.ts'

// Builds the native macOS prototype from ADR 0012 into apps/macos/build/Craft Hub Prototype.app. The app ships no
// Node: its runtime sidecar and the runtime CLI are single-file bundles that run on the user's own compatible Node.
// Only native addons and files the runtime reads by path stay beside them; Electron-only files never ship.
const run = promisify(execFile)
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryDir = resolve(appDir, '../..')
const buildDir = resolve(appDir, 'build')
const outputDir = process.env.CRAFT_HUB_NATIVE_OUTPUT_DIR ? resolve(repositoryDir, process.env.CRAFT_HUB_NATIVE_OUTPUT_DIR) : buildDir
const productName = 'Craft Hub Prototype'
const bundle = resolve(outputDir, `${productName}.app`)
const contents = resolve(bundle, 'Contents')
const architecture = process.arch === 'arm64' ? 'arm64' : 'x64'
const swiftArchitecture = architecture === 'arm64' ? 'arm64' : 'x86_64'
const swiftBuildArguments = ['build', '-c', 'release', '--arch', swiftArchitecture, '--package-path', appDir]
if (process.platform !== 'darwin')
  throw new Error('The native prototype builds on macOS only')
const { version } = JSON.parse(await readFile(resolve(repositoryDir, 'package.json'), 'utf8')) as { version: string }
const releaseConfig = nativeReleaseConfiguration(version, process.arch, process.env)
const linkPlist = nativeLinkPlist(releaseConfig, process.env)

async function step(label: string, command: string, args: string[]): Promise<string> {
  process.stdout.write(`${label}\n`)
  const { stdout } = await run(command, args, { cwd: repositoryDir, maxBuffer: 64 * 1024 * 1024 })
  return stdout.trim()
}

/** Dependencies of the external packages that only build or install them, never load at runtime. */
const buildOnlyPackages = new Set(['node-addon-api', 'prebuild-install'])

/** Copy the externals and what they load at runtime from a deployed, pruned tree, keeping its nested layout. */
async function copyRuntimePackages(from: string, to: string, roots: string[]): Promise<void> {
  const copied = new Set<string>()
  async function locate(name: string, fromDirectory: string): Promise<string | undefined> {
    for (let directory = fromDirectory; directory.startsWith(from); directory = dirname(directory)) {
      const candidate = join(directory, 'node_modules', name)
      try {
        await access(join(candidate, 'package.json'))
        return candidate
      }
      catch {}
      if (directory === from)
        return undefined
    }
  }
  async function visit(directory: string): Promise<void> {
    if (copied.has(directory))
      return
    copied.add(directory)
    await cp(directory, join(to, directory.slice(from.length)), { recursive: true, verbatimSymlinks: true })
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (buildOnlyPackages.has(name))
        continue
      const found = await locate(name, directory)
      if (!found)
        throw new Error(`Runtime dependency ${name} of ${directory} is missing from the deployed tree`)
      await visit(found)
    }
  }
  for (const root of roots)
    await visit(join(from, 'node_modules', root))
}

/** Start the bundled sidecar in a throwaway data directory and require its handshake, so a bundling break fails the build. */
async function verifySidecar(appDirectory: string): Promise<void> {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'craft-hub-sidecar-check-'))
  try {
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(process.execPath, [join(appDirectory, 'apps/desktop/dist/sidecar.mjs')], { env: { HOME: process.env.HOME, PATH: process.env.PATH, CRAFT_HUB_SIDECAR_DIR: dataDirectory }, stdio: ['pipe', 'pipe', 'pipe'] })
      let errors = ''
      let handshake = ''
      let handshook = false
      const timer = setTimeout(() => child.kill(), 20_000)
      child.stderr.on('data', chunk => errors += chunk)
      child.stdout.on('data', (chunk) => {
        if (handshook)
          return
        handshake += String(chunk)
        if (handshake.length > 16 * 1024) {
          child.kill()
          return
        }
        const newline = handshake.indexOf('\n')
        if (newline < 0)
          return
        try {
          const value = JSON.parse(handshake.slice(0, newline)) as { version?: number, nativeApiToken?: string, url?: string }
          const url = new URL(value.url ?? '')
          if (value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.nativeApiToken ?? '')
            || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
            || url.pathname !== '/__craft_hub_host/bootstrap' || !/^[a-f0-9]{64}$/.test(url.searchParams.get('token') ?? '')) {
            throw new Error('Invalid sidecar handshake')
          }
          handshook = true
          child.stdin.end()
        }
        catch {
          child.kill()
        }
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        if (code === 0 && handshook)
          resolvePromise()
        else
          reject(new Error(`The bundled sidecar did not start:\n${errors}`))
      })
    })
    await run(process.execPath, [join(appDirectory, 'apps/desktop/dist/cli.mjs'), '--version'])
  }
  finally {
    await rm(dataDirectory, { recursive: true, force: true })
  }
}

/** The pinned Workstation release builds from source, so reuse it until the lock moves to another revision. */
async function workstationRuntime(): Promise<string> {
  const lock = JSON.parse(await readFile(resolve(repositoryDir, 'scripts/workstation-runtime.lock.json'), 'utf8')) as { revision: string }
  const cached = resolve(buildDir, 'workstation-runtime', lock.revision)
  try {
    await access(join(cached, 'runtime.json'))
    return cached
  }
  catch {
    await rm(resolve(buildDir, 'workstation-runtime'), { recursive: true, force: true })
    await mkdir(dirname(cached), { recursive: true })
    process.stdout.write('Packaging the pinned Workstation runtime\n')
    await packageWorkstationRuntime(cached)
    return cached
  }
}

await step('Building the runtime, web workbench and desktop sidecar', 'pnpm', ['--filter', '@craft-hub/web...', '--filter', '@craft-hub/desktop...', 'build'])
const staging = await mkdtemp(join(tmpdir(), 'craft-hub-macos-'))
try {
  const deployed = join(staging, 'deployed')
  const app = join(staging, 'app')
  const desktop = join(app, 'apps/desktop')
  process.stdout.write('Deploying the native addons\n')
  await deployDesktop(deployed)
  // The same pruning as the Electron app: no duplicate store, no bundled Codex CLI, one PTY and keychain architecture.
  await prepareDesktopPackage(deployed, 'external')
  await prepareDesktopArchitecture(deployed, architecture, 'external')

  process.stdout.write('Bundling the sidecar, CLI and Microsoft To Do connector\n')
  await bundleSidecar(join(desktop, 'dist'))
  // The cross-spawn parser is loaded with createRequire, so it resolves beside the bundles like the externals.
  await copyRuntimePackages(deployed, desktop, [...sidecarExternals, 'cross-spawn'])
  await bundleMicrosoftTodoConnector(join(deployed, 'node_modules/@softeria/ms-365-mcp-server'), join(desktop, 'node_modules/@softeria/ms-365-mcp-server'))
  // The bundled runtime reads its software catalog from `../catalogs` relative to the bundle.
  await cp(resolve(repositoryDir, 'packages/craft-hub/catalogs'), join(desktop, 'catalogs'), { recursive: true })
  await cp(await workstationRuntime(), join(desktop, 'workstation-runtime'), { recursive: true, verbatimSymlinks: true })
  await cp(resolve(repositoryDir, 'apps/web/dist'), join(app, 'apps/web/dist'), { recursive: true })
  process.stdout.write('Checking the bundled sidecar starts\n')
  await verifySidecar(app)

  const intentProtocols = join(staging, 'intent-protocols.json')
  await writeFile(intentProtocols, JSON.stringify(['AppIntent', 'AppShortcutsProvider']))
  await step('Compiling the native app', 'swift', [
    ...swiftBuildArguments,
    '-Xswiftc',
    '-emit-const-values',
    '-Xswiftc',
    '-const-gather-protocols-list',
    '-Xswiftc',
    intentProtocols,
  ])
  await rm(bundle, { recursive: true, force: true })
  await mkdir(resolve(contents, 'MacOS'), { recursive: true })
  await mkdir(resolve(contents, 'Resources'), { recursive: true })
  await cp(app, resolve(contents, 'Resources/app'), { recursive: true, verbatimSymlinks: true })
}
finally {
  await rm(staging, { recursive: true, force: true })
}

const binDirectory = await step('Locating the build products', 'swift', [...swiftBuildArguments, '--show-bin-path'])
const executable = resolve(contents, 'MacOS/CraftHubMac')
await cp(join(binDirectory, 'CraftHubMac'), executable)
const executableArchitecture = (await run('lipo', ['-archs', executable])).stdout.trim()
if (executableArchitecture !== swiftArchitecture)
  throw new Error(`Native executable architecture ${executableArchitecture} does not match packaged ${architecture} dependencies`)
process.stdout.write('Extracting App Intents metadata\n')
await embedAppIntents(appDir, resolve(contents, 'Resources'), architecture, binDirectory)
// ditto preserves the framework's version symlinks and helper executable permissions.
await mkdir(resolve(contents, 'Frameworks'), { recursive: true })
await step('Embedding Sparkle', 'ditto', [resolve(appDir, '.build/artifacts/sparkle/Sparkle/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework'), resolve(contents, 'Frameworks/Sparkle.framework')])
// SwiftPM records the deployment target as the SDK version, which keeps AppKit and SwiftUI in their pre-26
// compatibility appearance. Record the SDK actually used so system controls adopt Liquid Glass on macOS 26+.
const sdkVersion = await step('Recording the SDK version', 'xcrun', ['--show-sdk-version'])
await run('xcrun', ['vtool', '-set-build-version', 'macos', '15.0', sdkVersion, '-replace', '-output', executable, executable])

await cp(resolve(repositoryDir, 'apps/desktop/assets/icon.icns'), resolve(contents, 'Resources/AppIcon.icns'))
let iconName = ''
try {
  // Xcode 26 and later compile Icon Composer files into the Liquid Glass asset catalog.
  await run('xcrun', ['actool', resolve(repositoryDir, 'apps/desktop/assets/icon.icon'), '--compile', resolve(contents, 'Resources'), '--platform', 'macosx', '--minimum-deployment-target', '15.0', '--app-icon', 'icon', '--output-partial-info-plist', resolve(buildDir, 'icon-info.plist')])
  iconName = '<key>CFBundleIconName</key><string>icon</string>'
}
catch {
  process.stdout.write('actool could not compile icon.icon; using the .icns icon only\n')
}

await writeFile(resolve(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.craft-hub.macos-prototype</string>
<key>CFBundleName</key><string>${productName}</string>
<key>CFBundleDisplayName</key><string>${productName}</string>
<key>CFBundleExecutable</key><string>CraftHubMac</string>
<key>CFBundlePackageType</key><string>APPL</string>
${linkPlist}
<key>CFBundleDocumentTypes</key><array><dict>
<key>CFBundleTypeName</key><string>Project Folder</string>
<key>CFBundleTypeRole</key><string>Viewer</string>
<key>LSHandlerRank</key><string>Alternate</string>
<key>LSItemContentTypes</key><array><string>public.folder</string></array>
</dict></array>
<key>NSPrincipalClass</key><string>NSApplication</string>
<key>CFBundleShortVersionString</key><string>${version.replace(/-.*$/, '')}</string>
<key>CFBundleVersion</key><string>${releaseConfig.bundleVersion}</string>
<key>CraftHubReleaseVersion</key><string>${xmlText(version)}</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
${iconName}
<key>LSMinimumSystemVersion</key><string>15.0</string>
<key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
${nativeUpdatePlist(releaseConfig)}
</dict></plist>
`)
process.stdout.write(releaseConfig.enabled ? 'Signing the release with Developer ID\n' : 'Signing ad hoc for local use\n')
await signNativeBundle(bundle, releaseConfig.enabled ? process.env.MACOS_KEYCHAIN_PATH : undefined)
process.stdout.write(`Built ${bundle}\n`)

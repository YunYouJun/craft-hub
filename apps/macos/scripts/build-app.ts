import { execFile } from 'node:child_process'
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { deployDesktop } from '../../../scripts/package-macos.ts'
import { packageWorkstationRuntime } from '../../../scripts/package-workstation-runtime.ts'
import { prepareDesktopArchitecture, prepareDesktopPackage } from '../../../scripts/prepare-desktop-package.ts'

// Builds the native macOS prototype from ADR 0012 into apps/macos/build/Craft Hub Prototype.app. The app ships no
// Node: its runtime sidecar is the desktop package's `dist/sidecar.mjs`, deployed and pruned exactly like the
// Electron app's, and runs on the user's own compatible Node.
const run = promisify(execFile)
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryDir = resolve(appDir, '../..')
const buildDir = resolve(appDir, 'build')
const productName = 'Craft Hub Prototype'
const bundle = resolve(buildDir, `${productName}.app`)
const contents = resolve(bundle, 'Contents')
const architecture = process.arch === 'arm64' ? 'arm64' : 'x64'
if (process.platform !== 'darwin')
  throw new Error('The native prototype builds on macOS only')

async function step(label: string, command: string, args: string[]): Promise<string> {
  process.stdout.write(`${label}\n`)
  const { stdout } = await run(command, args, { cwd: repositoryDir, maxBuffer: 64 * 1024 * 1024 })
  return stdout.trim()
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

await step('Building the runtime, web workbench and desktop sidecar', 'pnpm', ['--filter', 'craft-hub', '--filter', '@craft-hub/web', '--filter', '@craft-hub/desktop', 'build'])
const staging = await mkdtemp(join(tmpdir(), 'craft-hub-macos-'))
try {
  const desktop = join(staging, 'apps/desktop')
  process.stdout.write('Deploying the sidecar dependencies\n')
  await deployDesktop(desktop)
  await cp(await workstationRuntime(), join(desktop, 'workstation-runtime'), { recursive: true, verbatimSymlinks: true })
  await cp(resolve(repositoryDir, 'apps/web/dist'), join(staging, 'apps/web/dist'), { recursive: true })
  // The same pruning as the Electron app: no duplicate store, no bundled Codex CLI, one PTY architecture.
  await prepareDesktopPackage(desktop, 'external')
  await prepareDesktopArchitecture(desktop, architecture, 'external')

  await step('Compiling the native app', 'swift', ['build', '-c', 'release', '--package-path', appDir])
  await rm(bundle, { recursive: true, force: true })
  await mkdir(resolve(contents, 'MacOS'), { recursive: true })
  await mkdir(resolve(contents, 'Resources'), { recursive: true })
  await cp(join(staging, 'apps'), resolve(contents, 'Resources/app/apps'), { recursive: true, verbatimSymlinks: true })
}
finally {
  await rm(staging, { recursive: true, force: true })
}

const binDirectory = await step('Locating the build products', 'swift', ['build', '-c', 'release', '--package-path', appDir, '--show-bin-path'])
const executable = resolve(contents, 'MacOS/CraftHubMac')
await cp(join(binDirectory, 'CraftHubMac'), executable)
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

const { version } = JSON.parse(await readFile(resolve(repositoryDir, 'package.json'), 'utf8')) as { version: string }
await writeFile(resolve(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.craft-hub.macos-prototype</string>
<key>CFBundleName</key><string>${productName}</string>
<key>CFBundleDisplayName</key><string>${productName}</string>
<key>CFBundleExecutable</key><string>CraftHubMac</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version.replace(/-.*$/, '')}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
${iconName}
<key>LSMinimumSystemVersion</key><string>15.0</string>
<key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
`)
await step('Signing ad hoc for local use', 'codesign', ['--force', '--deep', '--sign', '-', bundle])
process.stdout.write(`Built ${bundle}\n`)

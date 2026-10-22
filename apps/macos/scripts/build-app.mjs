import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

// Builds the native macOS prototype from ADR 0012 into apps/macos/build/Craft Hub Prototype.app.
// The app ships no Node: it runs the Tauri trial's prepared backend on the user's own compatible Node.
const run = promisify(execFile)
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryDir = resolve(appDir, '../..')
const productName = 'Craft Hub Prototype'
const bundle = resolve(appDir, 'build', `${productName}.app`)
const contents = resolve(bundle, 'Contents')
if (process.platform !== 'darwin')
  throw new Error('The native prototype builds on macOS only')

async function step(label, command, args, cwd = repositoryDir) {
  process.stdout.write(`${label}\n`)
  await run(command, args, { cwd, maxBuffer: 64 * 1024 * 1024 })
}

await step('Building the web workbench', 'pnpm', ['--filter', '@craft-hub/web', 'build'])
await step('Preparing the runtime backend', 'pnpm', ['--filter', '@craft-hub/tauri-trial', 'prepare:backend'])
await step('Compiling the native app', 'swift', ['build', '-c', 'release', '--package-path', appDir])

await rm(bundle, { recursive: true, force: true })
await mkdir(resolve(contents, 'MacOS'), { recursive: true })
await mkdir(resolve(contents, 'Resources'), { recursive: true })
const { stdout: binDir } = await run('swift', ['build', '-c', 'release', '--package-path', appDir, '--show-bin-path'])
const executable = resolve(contents, 'MacOS/CraftHubMac')
await cp(resolve(binDir.trim(), 'CraftHubMac'), executable)
// SwiftPM records the deployment target as the SDK version, which keeps AppKit and SwiftUI in their pre-26
// compatibility appearance. Record the SDK actually used so system controls adopt Liquid Glass on macOS 26+.
const { stdout: sdkVersion } = await run('xcrun', ['--show-sdk-version'])
await run('xcrun', ['vtool', '-set-build-version', 'macos', '15.0', sdkVersion.trim(), '-replace', '-output', executable, executable])
// The prepared backend includes a copied Node for the Tauri trial; this host resolves the user's Node instead.
await cp(resolve(repositoryDir, 'apps/tauri/.prepared/backend'), resolve(contents, 'Resources/backend'), {
  recursive: true,
  filter: source => source !== resolve(repositoryDir, 'apps/tauri/.prepared/backend/node'),
})
// The bundled runtime reads its software catalog from `../catalogs` relative to backend.mjs.
await cp(resolve(repositoryDir, 'packages/craft-hub/catalogs'), resolve(contents, 'Resources/catalogs'), { recursive: true })
await cp(resolve(repositoryDir, 'apps/desktop/assets/icon.icns'), resolve(contents, 'Resources/AppIcon.icns'))
let iconName = ''
try {
  // Xcode 26 and later compile Icon Composer files into the Liquid Glass asset catalog.
  await run('xcrun', ['actool', resolve(repositoryDir, 'apps/desktop/assets/icon.icon'), '--compile', resolve(contents, 'Resources'), '--platform', 'macosx', '--minimum-deployment-target', '15.0', '--app-icon', 'icon', '--output-partial-info-plist', resolve(appDir, 'build/icon-info.plist')])
  iconName = '<key>CFBundleIconName</key><string>icon</string>'
}
catch {
  process.stdout.write('actool could not compile icon.icon; using the .icns icon only\n')
}

const { version } = JSON.parse(await readFile(resolve(repositoryDir, 'package.json'), 'utf8'))
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

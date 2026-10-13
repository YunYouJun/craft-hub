import { execFile } from 'node:child_process'
import { chmod, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryDir = resolve(appDir, '../..')
const outputDir = resolve(appDir, '.prepared/backend')
if (process.platform !== 'darwin')
  throw new Error('The initial Tauri trial currently targets macOS only')
await rm(outputDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })
const result = await build({
  absWorkingDir: repositoryDir,
  entryPoints: [resolve(appDir, 'backend/main.ts')],
  outfile: resolve(outputDir, 'backend.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  minify: true,
  legalComments: 'linked',
  external: ['node-pty', 'jsonc-parser'],
  metafile: true,
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url); const __dirname = import.meta.dirname;' },
})
if (Object.keys(result.metafile.inputs).some(path => path.includes('@openai/codex')))
  throw new Error('The lightweight trial must not embed the Codex SDK or CLI')
await writeFile(resolve(outputDir, 'build-inputs.json'), JSON.stringify({ nodeVersion: process.version, platform: process.platform, architecture: process.arch, inputs: Object.keys(result.metafile.inputs) }, null, 2))
// Ship the exact Node runtime used by this build, so no system Node is needed.
await cp(process.execPath, resolve(outputDir, 'node'))
await chmod(resolve(outputDir, 'node'), 0o755)
const pickerBundle = resolve(outputDir, 'Folder Picker.app')
await mkdir(resolve(pickerBundle, 'Contents/MacOS'), { recursive: true })
await writeFile(resolve(pickerBundle, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.craft-hub.tauri-trial.folder-picker</string>
<key>CFBundleName</key><string>Craft Hub Project Picker</string>
<key>CFBundleExecutable</key><string>folder-picker</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>13.5</string>
</dict></plist>`)
await promisify(execFile)('/usr/bin/xcrun', ['swiftc', '-O', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx13.5`, resolve(appDir, 'backend/folder-picker.swift'), '-o', resolve(pickerBundle, 'Contents/MacOS/folder-picker')])
await promisify(execFile)('/usr/bin/codesign', ['--force', '--sign', '-', pickerBundle])
const require = createRequire(resolve(repositoryDir, 'packages/craft-hub/package.json'))
const copiedPackages = new Map()
async function copyRuntimePackage(name, from) {
  const packageRequire = createRequire(from)
  const packagePath = packageRequire.resolve(`${name}/package.json`)
  const manifest = JSON.parse(await readFile(packagePath, 'utf8'))
  if (copiedPackages.has(name)) {
    if (copiedPackages.get(name) !== manifest.version)
      throw new Error(`Conflicting sidecar dependency versions for ${name}`)
    return
  }
  copiedPackages.set(name, manifest.version)
  await cp(dirname(packagePath), resolve(outputDir, 'node_modules', name), { recursive: true })
  for (const dependency of Object.keys(manifest.dependencies ?? {}))
    await copyRuntimePackage(dependency, packagePath)
}
// The runtime deliberately loads cross-spawn with createRequire for its internal parser.
await copyRuntimePackage('cross-spawn', resolve(repositoryDir, 'packages/craft-hub/package.json'))
// jsonc-parser's UMD wrapper passes require through a factory; keep its files intact.
const jsoncDir = dirname(require.resolve('jsonc-parser/package.json'))
await cp(jsoncDir, resolve(outputDir, 'node_modules/jsonc-parser'), { recursive: true })
const ptyDir = dirname(require.resolve('node-pty/package.json'))
const targetPtyDir = resolve(outputDir, 'node_modules/node-pty')
await mkdir(resolve(targetPtyDir, 'lib'), { recursive: true })
for (const name of await readdir(resolve(ptyDir, 'lib'))) {
  if (name.endsWith('.js') && !name.endsWith('.test.js'))
    await cp(resolve(ptyDir, 'lib', name), resolve(targetPtyDir, 'lib', name))
}
for (const name of ['package.json', 'LICENSE'])
  await cp(resolve(ptyDir, name), resolve(targetPtyDir, name))
await cp(resolve(ptyDir, `prebuilds/${process.platform}-${process.arch}`), resolve(targetPtyDir, `prebuilds/${process.platform}-${process.arch}`), { recursive: true })
await cp(resolve(repositoryDir, 'apps/web/dist'), resolve(outputDir, 'web'), { recursive: true })
const indexPath = resolve(outputDir, 'web/index.html')
const html = await readFile(indexPath, 'utf8')
await writeFile(indexPath, html.replace('<head>', '<head><script src="/__craft_hub_host/bridge.js"></script>'))
process.stdout.write(`Prepared a self-contained ${process.platform}-${process.arch} backend with Node ${process.version}; Codex SDK/CLI excluded.\n`)

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { verifyDesktopFuses } from './desktop-fuses.ts'
import { desktopNodeRelease } from './package-desktop-node.ts'

assert.equal(process.platform, 'darwin')
assert(process.argv[2], 'Usage: tsx scripts/verify-desktop-backend.ts <packaged-Electron.app>')
const app = await realpath(resolve(process.argv[2]))
await verifyDesktopFuses(app)
const backend = join(app, 'Contents/Resources/app.asar.unpacked/apps/desktop/workstation-runtime')
const node = join(backend, 'node/bin/node')
const cli = join(backend, 'dist/cli.js')
const receipt = JSON.parse(await readFile(join(backend, 'node/runtime.json'), 'utf8'))
assert(['arm64', 'x64'].includes(receipt.architecture))
const release = await desktopNodeRelease(receipt.architecture)
assert.equal(receipt.version, release.version)
assert.equal(receipt.archiveSHA256, release.sha256)
assert((await readFile(join(backend, 'node/LICENSE'), 'utf8')).includes('Node.js'))
const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-backend-acceptance-')))
const home = join(root, 'home')
const source = join(root, 'source')
const env = { HOME: home, DOTFILES_HOME: home, DOTFILES_REPO_ROOT: source, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8' }

async function execute(command: string, args: string[], input?: unknown): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = execFile(command, args, { cwd: root, env, timeout: 20_000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      if (error)
        reject(new Error('The packaged backend operation failed'))
      else
        resolveOutput(stdout)
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(input === undefined ? '' : JSON.stringify(input))
  })
}
async function request(command: string, input: Record<string, unknown>): Promise<Record<string, any>> {
  const envelope = JSON.parse(await execute(node, [cli, command], { version: 1, ...input }))
  assert.equal(envelope.ok, true)
  assert.equal(envelope.result.version, 1)
  return envelope.result
}
let activeRun: string | undefined
async function rejectAlteredAsar(): Promise<void> {
  const copy = join(root, 'Altered.app')
  await execute('/usr/bin/ditto', [app, copy])
  const archive = await open(join(copy, 'Contents/Resources/app.asar'), 'r+')
  try {
    const { buffer } = await archive.read({ length: 1, position: 16 })
    buffer[0] = buffer[0]! ^ 1
    await archive.write(buffer, 0, 1, 16)
  }
  finally { await archive.close() }
  // Re-sign only the disposable copy. Otherwise OS signature failure could hide a broken ASAR-integrity fuse.
  await execute('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', copy])
  await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', copy])
  const executable = (await execute('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', join(copy, 'Contents/Info.plist')])).trim()
  const rejection = await new Promise<{ failed: boolean, signal?: string | null, stderr: string }>((resolveResult) => {
    const child = execFile(join(copy, 'Contents/MacOS', executable), ['--craft-hub-native-identity-transfer'], { cwd: root, env, timeout: 20_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, _stdout, stderr) => {
      resolveResult({ failed: !!error, signal: error?.signal, stderr })
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end('{"version":1,"action":"preview"}')
  })
  assert(rejection.failed && rejection.signal !== 'SIGKILL', 'The altered archive must fail before the timeout')
  assert.match(rejection.stderr, /integrity.*(?:fail|mismatch)|(?:fail|mismatch).*integrity/i, 'Require ASAR integrity failure, not an unrelated startup refusal')
}
try {
  await mkdir(home)
  await mkdir(join(source, 'home'), { recursive: true })
  await writeFile(join(source, 'home/dot_zshrc'), 'export CRAFT_HUB_FIXTURE=source\n')
  await writeFile(join(home, '.zshrc'), 'export CRAFT_HUB_FIXTURE=local\n')
  assert.equal((await execute(node, ['--version'])).trim(), `v${release.version}`)
  // No terminal Node or Electron Node-mode environment is available to a nested process.
  const nested = JSON.parse(await execute(node, ['-e', 'const {execFileSync}=require("node:child_process");process.stdout.write(execFileSync(process.execPath,["-p","JSON.stringify({node:process.versions.node,path:process.execPath,electron:process.versions.electron})"],{env:process.env}))']))
  assert.equal(nested.node, release.version)
  assert.equal(nested.path, node)
  assert.equal(nested.electron, undefined)
  const support = await request('host-json', { operation: 'capabilities' })
  assert.equal(support.protocols.configuration, 1)
  const inspected = await request('configuration', { operation: 'inspect' })
  assert(inspected.items.some((item: { id: string }) => item.id === 'dot_zshrc' || item.id === '.zshrc' || JSON.stringify(item).includes('dot_zshrc')))
  const catalog = await request('software-json', { operation: 'catalog' })
  // A detected entry is an explicit no-install plan. Still exercises Workstation's detached Node worker.
  const detected = catalog.items.find((item: { status: string }) => item.status === 'detected')
  assert(detected, 'At least one system or installed catalog item is needed for the no-install worker fixture')
  const plan = await request('software-json', { operation: 'preview', softwareIds: [detected.id] })
  assert.deepEqual(plan.prerequisites, [])
  assert.equal(plan.items.length, 1)
  assert.equal(plan.items[0].action, 'skip')
  const run = await request('software-json', { operation: 'install', planId: plan.id, confirmed: true })
  activeRun = run.id
  let state = run
  for (let attempt = 0; ['queued', 'running', 'cancelling'].includes(state.state) && attempt < 100; attempt++) {
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
    state = await request('software-json', { operation: 'run', runId: activeRun })
  }
  assert.equal(state.state, 'completed')
  assert.equal(state.items[0].state, 'skipped')
  activeRun = undefined
  assert.equal(await readFile(join(home, '.zshrc'), 'utf8'), 'export CRAFT_HUB_FIXTURE=local\n')
  assert.equal(await readFile(join(source, 'home/dot_zshrc'), 'utf8'), 'export CRAFT_HUB_FIXTURE=source\n')
  await rejectAlteredAsar()
  console.log(JSON.stringify({ fuses: 'verified from the packaged binary', asarIntegrity: 'altered header rejected after re-signing the disposable copy', runtime: release.version, backend: 'capabilities, configuration inspection, catalog and detached no-install worker passed', terminalNode: 'not used', source: 'unchanged', installations: 0, profile: 'disposable' }))
}
finally {
  if (activeRun)
    await request('software-json', { operation: 'cancel', runId: activeRun }).catch(() => {})
  await rm(root, { recursive: true, force: true })
}

import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { isMacosKeytarArchitecture, prepareMacosKeytar } from '../../../scripts/prepare-macos-keytar'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

function nativeBundle(architecture: 'arm64' | 'x64'): Buffer {
  const binary = Buffer.alloc(32)
  binary.writeUInt32LE(0xFEEDFACF, 0)
  binary.writeUInt32LE(architecture === 'arm64' ? 0x0100000C : 0x01000007, 4)
  binary.writeUInt32LE(8, 12)
  return binary
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'craft-hub-keytar-prebuild-'))
  directories.push(directory)
  await mkdir(join(directory, 'build/Release'), { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'keytar', version: '7.9.0' }))
  const binaryPath = join(directory, 'build/Release/keytar.node')
  return { directory, binaryPath }
}

it.each(['arm64', 'x64'] as const)('keeps a verified %s native bundle without downloading it again', async (architecture) => {
  const { directory, binaryPath } = await fixture()
  await writeFile(binaryPath, nativeBundle(architecture))
  const install = vi.fn()
  await prepareMacosKeytar(directory, architecture, { installPrebuild: install })
  expect(install).not.toHaveBeenCalled()
})

it.each(['arm64', 'x64'] as const)('replaces the build-machine addon with the %s prebuild before allowing packaging', async (architecture) => {
  const { directory, binaryPath } = await fixture()
  await writeFile(binaryPath, nativeBundle(architecture === 'arm64' ? 'x64' : 'arm64'))
  const install = vi.fn(async () => {
    await writeFile(binaryPath, nativeBundle(architecture))
  })
  await prepareMacosKeytar(directory, architecture, { installPrebuild: install })
  expect(install).toHaveBeenCalledOnce()
  expect(isMacosKeytarArchitecture(await readFile(binaryPath), architecture)).toBe(true)
})

it('installs a missing prebuild and rejects downloads that leave an incompatible native bundle', async () => {
  const { directory, binaryPath } = await fixture()
  await prepareMacosKeytar(directory, 'x64', { installPrebuild: async () => {
    await writeFile(binaryPath, nativeBundle('x64'))
  } })
  await expect(prepareMacosKeytar(directory, 'arm64', { installPrebuild: async () => {} })).rejects.toThrow('does not match darwin-arm64')
})

it('fails packaging when the pinned prebuild cannot be obtained instead of silently losing keychain access', async () => {
  const { directory, binaryPath } = await fixture()
  await writeFile(binaryPath, nativeBundle('arm64'))
  await expect(prepareMacosKeytar(directory, 'x64', { installPrebuild: async () => {
    throw new Error('No prebuilt binary')
  } })).rejects.toThrow('darwin-x64 is unavailable')
  expect(isMacosKeytarArchitecture(await readFile(binaryPath), 'x64')).toBe(false)
})

it('rejects unexpected dependency versions and malformed native headers', async () => {
  const { directory } = await fixture()
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'keytar', version: '8.0.0' }))
  const install = vi.fn()
  await expect(prepareMacosKeytar(directory, 'arm64', { installPrebuild: install })).rejects.toThrow('Expected keytar@7.9.0')
  expect(install).not.toHaveBeenCalled()
  expect(isMacosKeytarArchitecture(Buffer.from('not a native bundle'), 'arm64')).toBe(false)
  const executable = nativeBundle('arm64')
  executable.writeUInt32LE(2, 12)
  expect(isMacosKeytarArchitecture(executable, 'arm64')).toBe(false)
})

it.each(['arm64', 'x64'] as const)('runs the deployed installer with an explicit %s N-API target and recovers a missing build directory', async (architecture) => {
  const { directory, binaryPath } = await fixture()
  await rm(join(directory, 'build'), { recursive: true })
  const installerDirectory = join(directory, 'node_modules/prebuild-install')
  await mkdir(installerDirectory, { recursive: true })
  await writeFile(join(installerDirectory, 'package.json'), JSON.stringify({ name: 'prebuild-install', version: '7.1.3' }))
  await writeFile(join(installerDirectory, 'bin.js'), `
const fs = require('node:fs')
const args = process.argv.slice(2)
if (!['--force', '--platform=darwin', '--runtime=napi', '--target=3'].every(arg => args.includes(arg)))
  throw new Error('Expected explicit pinned N-API target')
const architecture = args.find(arg => arg.startsWith('--arch='))?.slice(7)
if (!['arm64', 'x64'].includes(architecture))
  throw new Error('Expected explicit architecture')
const binary = Buffer.alloc(32)
binary.writeUInt32LE(0xFEEDFACF, 0)
binary.writeUInt32LE(architecture === 'arm64' ? 0x0100000C : 0x01000007, 4)
binary.writeUInt32LE(8, 12)
fs.writeFileSync('build/Release/keytar.node', binary)
`)
  await prepareMacosKeytar(directory, architecture)
  expect(isMacosKeytarArchitecture(await readFile(binaryPath), architecture)).toBe(true)
})

it('rejects native directories and installers linked outside the deployed tree', async () => {
  const { directory, binaryPath } = await fixture()
  const external = await mkdtemp(join(tmpdir(), 'craft-hub-keytar-external-'))
  directories.push(external)
  await writeFile(join(external, 'keytar.node'), nativeBundle('arm64'))
  await rm(join(directory, 'build/Release'), { recursive: true })
  await symlink(external, join(directory, 'build/Release'), 'junction')
  await expect(prepareMacosKeytar(directory, 'x64', { installPrebuild: async () => {} })).rejects.toThrow('stay inside')
  expect(isMacosKeytarArchitecture(await readFile(join(external, 'keytar.node')), 'arm64')).toBe(true)

  await rm(join(directory, 'build/Release'))
  await mkdir(join(directory, 'build/Release'))
  await writeFile(binaryPath, nativeBundle('arm64'))
  await writeFile(join(external, 'package.json'), JSON.stringify({ name: 'prebuild-install', version: '7.1.3' }))
  await writeFile(join(external, 'bin.js'), 'throw new Error("Must not execute")')
  await mkdir(join(directory, 'node_modules'))
  await symlink(external, join(directory, 'node_modules/prebuild-install'), 'junction')
  await expect(prepareMacosKeytar(directory, 'x64')).rejects.toThrow('stay inside')
})

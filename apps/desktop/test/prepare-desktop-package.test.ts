import { Buffer } from 'node:buffer'
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { prepareDesktopArchitecture, prepareDesktopPackage } from '../../../scripts/prepare-desktop-package'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

function keytarBinary(architecture: 'arm64' | 'x64'): Buffer {
  const binary = Buffer.alloc(32)
  binary.writeUInt32LE(0xFEEDFACF, 0)
  binary.writeUInt32LE(architecture === 'arm64' ? 0x0100000C : 0x01000007, 4)
  binary.writeUInt32LE(8, 12)
  return binary
}

async function fixture(architecture: 'arm64' | 'x64' = 'arm64'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-package-prune-'))
  directories.push(root)
  for (const path of ['src/main.ts', 'test/main.test.ts', 'tsconfig.json', 'tsdown.config.ts', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'dist/main.mjs', 'preload.cjs', 'assets/icon.png', 'package.json', 'desktop-build.json', 'distribution.json', 'node_modules/craft-hub/web/index.html', 'node_modules/craft-hub/dist/index.mjs', 'node_modules/node-pty/lib/index.js', 'node_modules/node-pty/prebuilds/darwin-arm64/pty.node', 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper', 'node_modules/node-pty/prebuilds/darwin-x64/pty.node', 'node_modules/node-pty/prebuilds/win32-arm64/pty.node', 'node_modules/node-pty/prebuilds/win32-x64/pty.node', 'node_modules/node-pty/LICENSE', 'node_modules/craft-hub/schema/project.schema.json']) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), path)
  }
  for (const name of ['craft-hub', 'node-pty'])
    await writeFile(join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name }))
  const keytarDirectory = join(root, 'node_modules/keytar')
  await mkdir(join(keytarDirectory, 'build/Release'), { recursive: true })
  await writeFile(join(keytarDirectory, 'package.json'), JSON.stringify({ name: 'keytar', version: '7.9.0' }))
  await writeFile(join(keytarDirectory, 'build/Release/keytar.node'), keytarBinary(architecture))
  const nativePackages = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'linux-arm64': 'aarch64-unknown-linux-musl',
    'win32-x64': 'x86_64-pc-windows-msvc',
  }
  const optionalDependencies = Object.fromEntries(Object.keys(nativePackages).map(target => [`@openai/codex-${target}`, 'npm:@openai/codex@1.0.0']))
  for (const [target, triple] of Object.entries(nativePackages)) {
    const directory = join(root, 'node_modules/@openai', `codex-${target}`)
    await mkdir(join(directory, 'vendor', triple, 'bin'), { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@openai/codex' }))
    await writeFile(join(directory, 'vendor', triple, 'bin/codex'), `native-${target}`)
    await writeFile(join(directory, 'vendor', triple, 'bin/codex-code-mode-host'), `host-${target}`)
    await writeFile(join(directory, 'vendor', triple, 'codex-package.json'), '{}')
  }
  await mkdir(join(root, 'node_modules/@openai/codex'), { recursive: true })
  await writeFile(join(root, 'node_modules/@openai/codex/package.json'), JSON.stringify({ name: '@openai/codex', optionalDependencies }))
  await mkdir(join(root, 'node_modules/@openai/codex-sdk/dist'), { recursive: true })
  await writeFile(join(root, 'node_modules/@openai/codex-sdk/dist/index.js'), 'export class Codex {}')
  for (const path of ['src/native.cc', 'deps/native.cc', 'third_party/native.cc', 'scripts/install.js', 'typings/index.d.ts', 'binding.gyp', 'lib/unixTerminal.test.js']) {
    await mkdir(join(root, 'node_modules/node-pty', path, '..'), { recursive: true })
    await writeFile(join(root, 'node_modules/node-pty', path), 'build-only')
  }
  await writeFile(join(root, 'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper'), 'x64-helper')
  return root
}

it('keeps the deployed runtime and both Mac PTY binaries while removing duplicate Web and Windows binaries', async () => {
  const root = await fixture()
  await prepareDesktopPackage(root)

  expect(await readdir(root)).toEqual(expect.arrayContaining(['dist', 'preload.cjs', 'assets', 'package.json', 'desktop-build.json', 'distribution.json']))
  for (const entry of ['src', 'test', 'tsconfig.json', 'tsdown.config.ts', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'node_modules/craft-hub/web'])
    await expect(access(join(root, entry))).rejects.toThrow()
  expect(await readdir(join(root, 'node_modules/node-pty/prebuilds'))).toEqual(['darwin-arm64', 'darwin-x64'])
  for (const path of ['node_modules/craft-hub/dist/index.mjs', 'node_modules/craft-hub/schema/project.schema.json', 'node_modules/node-pty/lib/index.js', 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper', 'node_modules/node-pty/LICENSE'])
    expect(await readFile(join(root, path), 'utf8')).toBe(path)
  for (const entry of ['src', 'deps', 'third_party', 'scripts', 'typings', 'binding.gyp', 'lib/unixTerminal.test.js'])
    await expect(access(join(root, 'node_modules/node-pty', entry))).rejects.toThrow()
})

it.each(['arm64', 'x64'] as const)('prunes only the %s copied application while keeping the shared staging reusable', async (architecture) => {
  const root = await fixture()
  await prepareDesktopPackage(root)
  const copied = await mkdtemp(join(tmpdir(), 'craft-hub-package-copy-'))
  directories.push(copied)
  await cp(root, copied, { recursive: true })
  await writeFile(join(copied, 'node_modules/keytar/build/Release/keytar.node'), keytarBinary(architecture))
  await prepareDesktopArchitecture(copied, architecture)

  expect(await readdir(join(copied, 'node_modules/@openai'))).toEqual(['codex', `codex-darwin-${architecture}`, 'codex-sdk'])
  expect(await readdir(join(copied, 'node_modules/node-pty/prebuilds'))).toEqual([`darwin-${architecture}`])
  const triple = architecture === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  expect(await readFile(join(copied, `node_modules/@openai/codex-darwin-${architecture}/vendor/${triple}/bin/codex-code-mode-host`), 'utf8')).toBe(`host-darwin-${architecture}`)
  expect(await readdir(join(root, 'node_modules/node-pty/prebuilds'))).toEqual(['darwin-arm64', 'darwin-x64'])
  expect(await readdir(join(root, 'node_modules/@openai'))).toContain(`codex-darwin-${architecture === 'arm64' ? 'x64' : 'arm64'}`)
  expect(await readFile(join(root, 'node_modules/keytar/build/Release/keytar.node'))).toEqual(keytarBinary('arm64'))
  expect(await readFile(join(copied, 'node_modules/keytar/build/Release/keytar.node'))).toEqual(keytarBinary(architecture))
})

it('rejects a target missing its native Codex package before pruning any other architecture', async () => {
  const root = await fixture('x64')
  await rm(join(root, 'node_modules/@openai/codex-darwin-x64'), { recursive: true })
  await expect(prepareDesktopArchitecture(root, 'x64')).rejects.toThrow()
  await expect(access(join(root, 'node_modules/@openai/codex-darwin-arm64'))).resolves.toBeUndefined()
  await expect(access(join(root, 'node_modules/node-pty/prebuilds/darwin-arm64'))).resolves.toBeUndefined()
})

it('refuses an application missing its credential addon before pruning its other native dependencies', async () => {
  const root = await fixture()
  await rm(join(root, 'node_modules/keytar'), { recursive: true })
  await expect(prepareDesktopArchitecture(root, 'arm64')).rejects.toThrow()
  expect(await readdir(join(root, 'node_modules/node-pty/prebuilds'))).toContain('darwin-x64')
})

it('removes the CLI in explicit lightweight mode while retaining the SDK and native project execution', async () => {
  const root = await fixture()
  await prepareDesktopPackage(root, 'external')
  await prepareDesktopArchitecture(root, 'arm64', 'external')
  expect(await readdir(join(root, 'node_modules/@openai'))).toEqual(['codex-sdk'])
  expect(await readFile(join(root, 'node_modules/@openai/codex-sdk/dist/index.js'), 'utf8')).toContain('export class Codex')
  expect(await readdir(join(root, 'node_modules/node-pty/prebuilds'))).toEqual(['darwin-arm64'])
  await expect(access(join(root, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'))).resolves.toBeUndefined()
})

it.each(['dir', 'junction'] as const)('refuses to prune a dependency linked outside the staging directory with a %s link', async (linkType) => {
  const root = await fixture()
  const external = await mkdtemp(join(tmpdir(), 'craft-hub-external-package-'))
  directories.push(external)
  await mkdir(join(external, 'web'))
  await writeFile(join(external, 'package.json'), JSON.stringify({ name: 'craft-hub' }))
  await writeFile(join(external, 'web/index.html'), 'external Web UI')
  await rm(join(root, 'node_modules/craft-hub'), { recursive: true })
  await symlink(external, join(root, 'node_modules/craft-hub'), linkType)

  await expect(prepareDesktopPackage(root)).rejects.toThrow('must stay inside the deployed directory')
  expect(await readFile(join(external, 'web/index.html'), 'utf8')).toBe('external Web UI')
})

it('allows a dependency linked to another directory inside staging', async () => {
  const root = await fixture()
  const runtime = join(root, 'node_modules/craft-hub')
  const internal = join(root, 'runtime-store/craft-hub')
  await cp(runtime, internal, { recursive: true })
  await rm(runtime, { recursive: true })
  await symlink(internal, runtime, 'junction')

  await prepareDesktopPackage(root)
  await expect(access(join(internal, 'web'))).rejects.toThrow()
  expect(await readFile(join(internal, 'dist/index.mjs'), 'utf8')).toBe('node_modules/craft-hub/dist/index.mjs')
})

it('refuses to traverse an external PTY prebuild directory sharing the staging path prefix', async () => {
  const root = await fixture()
  const external = `${root}-external`
  directories.push(external)
  await mkdir(join(external, 'win32-x64'), { recursive: true })
  await writeFile(join(external, 'win32-x64/pty.node'), 'external native binary')
  const prebuilds = join(root, 'node_modules/node-pty/prebuilds')
  await rm(prebuilds, { recursive: true })
  await symlink(external, prebuilds, 'junction')

  await expect(prepareDesktopPackage(root)).rejects.toThrow('must stay inside the deployed directory')
  expect(await readFile(join(external, 'win32-x64/pty.node'), 'utf8')).toBe('external native binary')
})

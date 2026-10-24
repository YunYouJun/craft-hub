import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const require = createRequire(import.meta.url)
export const identityLauncherSource = fileURLToPath(new URL('../apps/desktop/native/identity-launcher', import.meta.url))
export const identityIPCSource = fileURLToPath(new URL('../apps/macos/Sources/CraftHubIdentityIPC', import.meta.url))

/** Build the macOS process owner and authenticated transport against stable Node-API and the local SDK. */
export async function buildIdentityLauncher(target: string, architecture: 'arm64' | 'x64'): Promise<void> {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(architecture))
    throw new Error('Identity launchers require a supported macOS build host')
  const headers = require('node-api-headers') as { include_dir: string }
  await mkdir(dirname(target), { recursive: true })
  const scratch = await mkdtemp(join(tmpdir(), 'craft-hub-identity-build-'))
  try {
    const flags = ['-mmacosx-version-min=15.0', '-arch', architecture === 'arm64' ? 'arm64' : 'x86_64', '-Wall', '-Wextra', '-Werror', '-O2', '-I', join(identityIPCSource, 'include')]
    const object = join(scratch, 'identity-ipc.o')
    await run('/usr/bin/xcrun', ['clang', '-std=c11', ...flags, '-c', join(identityIPCSource, 'identity-ipc.c'), '-o', object], { timeout: 60_000, maxBuffer: 1024 * 1024 })
    await run('/usr/bin/xcrun', [
      'clang++',
      '-std=c++20',
      '-fobjc-arc',
      ...flags,
      '-bundle',
      '-undefined',
      'dynamic_lookup',
      '-framework',
      'Foundation',
      '-framework',
      'Security',
      '-framework',
      'AppKit',
      '-I',
      headers.include_dir,
      join(identityLauncherSource, 'launcher.mm'),
      object,
      '-lbsm',
      '-o',
      target,
    ], { timeout: 60_000, maxBuffer: 1024 * 1024 })
    await copyFile(join(dirname(require.resolve('node-api-headers/package.json')), 'LICENSE'), join(dirname(target), 'NODE_API_HEADERS_LICENSE'))
  }
  finally { await rm(scratch, { recursive: true, force: true }) }
}

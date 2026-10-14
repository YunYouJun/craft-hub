import type { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const keytarVersion = '7.9.0'
type Architecture = 'arm64' | 'x64'

interface KeytarPreparationOptions {
  stagingDirectory?: string
  installPrebuild?: () => Promise<void>
}

/** Check the native bundle header without loading credentials or executing the addon. */
export function isMacosKeytarArchitecture(binary: Buffer, architecture: Architecture): boolean {
  return binary.length >= 32
    && binary.readUInt32LE(0) === 0xFEEDFACF
    && binary.readUInt32LE(4) === (architecture === 'arm64' ? 0x0100000C : 0x01000007)
    && binary.readUInt32LE(12) === 8
}

/** Replace an installed addon with the pinned N-API prebuild for this copied application. */
export async function prepareMacosKeytar(directory: string, architecture: Architecture, options: KeytarPreparationOptions = {}): Promise<void> {
  const root = await realpath(options.stagingDirectory ?? directory)
  directory = await realpath(directory)
  await assertStagedPath(root, directory)
  const manifestPath = join(directory, 'package.json')
  const metadata = JSON.parse(await readFile(manifestPath, 'utf8')) as { name?: string, version?: string }
  if (metadata.name !== 'keytar' || metadata.version !== keytarVersion)
    throw new Error(`Expected keytar@${keytarVersion} when preparing macOS credentials`)
  const binaryPath = join(directory, 'build/Release/keytar.node')
  await assertStagedPath(root, binaryPath)
  let binary: Buffer | undefined
  try {
    binary = await readFile(binaryPath)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error
  }
  if (binary && isMacosKeytarArchitecture(binary, architecture))
    return

  const installer = options.installPrebuild ? undefined : createRequire(manifestPath).resolve('prebuild-install/bin.js')
  if (installer)
    await assertStagedPath(root, installer)
  try {
    await mkdir(dirname(binaryPath), { recursive: true })
    if (options.installPrebuild) {
      await options.installPrebuild()
    }
    else {
      await execFileAsync(process.execPath, [installer!, '--force', '--platform=darwin', `--arch=${architecture}`, '--runtime=napi', '--target=3'], {
        cwd: directory,
        timeout: 60_000,
      })
    }
    binary = await readFile(binaryPath)
  }
  catch (error) {
    throw new Error(`The pinned keytar prebuild for darwin-${architecture} is unavailable. macOS credential storage must use a matching native addon.`, { cause: error })
  }
  if (!isMacosKeytarArchitecture(binary, architecture))
    throw new Error(`The keytar prebuild does not match darwin-${architecture}`)
}

async function assertStagedPath(root: string, path: string): Promise<void> {
  const contained = (value: string): boolean => {
    const offset = relative(root, value)
    return offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset) && resolve(root, offset) === value
  }
  if (!contained(resolve(path)))
    throw new Error(`Credential addon paths must stay inside the deployed directory: ${path}`)
  let existing = path
  for (;;) {
    try {
      if (!contained(await realpath(existing)))
        throw new Error(`Credential addon paths must stay inside the deployed directory: ${path}`)
      return
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
      const entry = await lstat(existing).catch((failure: NodeJS.ErrnoException) => {
        if (failure.code !== 'ENOENT')
          throw failure
      })
      if (entry?.isSymbolicLink())
        throw new Error(`Credential addon paths cannot use a broken link: ${path}`)
      existing = dirname(existing)
    }
  }
}

import type { DesktopCodexMode } from '../apps/desktop/src/build-info.ts'
import { access, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

/** Remove only known build inputs and duplicated resources from a deployed macOS desktop. */
export async function prepareDesktopPackage(desktopDirectory: string, codexMode: DesktopCodexMode = 'bundled'): Promise<void> {
  const root = await realpath(desktopDirectory)
  for (const entry of ['src', 'test', 'tsconfig.json', 'tsdown.config.ts', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])
    await rm(join(root, entry), { recursive: true, force: true })

  // The desktop always supplies apps/web/dist as the local server's staticDir.
  // The CLI distribution keeps its embedded Web UI; only this deployed copy is pruned.
  const runtimeDirectory = await deployedDependency(root, 'craft-hub')
  await rm(join(runtimeDirectory, 'web'), { recursive: true, force: true })

  const ptyDirectory = await deployedDependency(root, 'node-pty')
  const libDirectory = await stagedDirectory(root, join(ptyDirectory, 'lib'))
  const prebuildDirectory = await stagedDirectory(root, join(ptyDirectory, 'prebuilds'))
  // Installed apps load the shipped native prebuild; rebuilding inside read-only ASAR is unsupported.
  for (const entry of ['src', 'deps', 'third_party', 'scripts', 'typings', 'binding.gyp'])
    await rm(join(ptyDirectory, entry), { recursive: true, force: true })
  for (const entry of await readdir(libDirectory)) {
    if (/\.test\.js(?:\.map)?$/.test(entry))
      await rm(join(libDirectory, entry), { force: true })
  }
  for (const entry of await readdir(prebuildDirectory)) {
    // Keep both Mac architectures because the same staging tree packages arm64 and x64.
    if (!entry.startsWith('darwin-'))
      await rm(join(prebuildDirectory, entry), { recursive: true, force: true })
  }
  if (codexMode === 'external')
    await removeBundledCodex(root)
}

/** Prune a copied application for its own target, leaving the shared staging tree reusable. */
export async function prepareDesktopArchitecture(desktopDirectory: string, architecture: 'arm64' | 'x64', codexMode: DesktopCodexMode = 'bundled'): Promise<void> {
  const root = await realpath(desktopDirectory)
  const ptyDirectory = await deployedDependency(root, 'node-pty')
  const prebuildDirectory = await stagedDirectory(root, join(ptyDirectory, 'prebuilds'))
  const ptyTarget = join(prebuildDirectory, `darwin-${architecture}`)
  await Promise.all(['pty.node', 'spawn-helper'].map(file => access(join(ptyTarget, file))))
  if (codexMode === 'external') {
    for (const entry of await readdir(prebuildDirectory)) {
      if (entry !== `darwin-${architecture}`)
        await rm(join(prebuildDirectory, entry), { recursive: true, force: true })
    }
    return
  }

  const nativePackageName = `@openai/codex-darwin-${architecture}`
  let nativeDirectory: string
  try {
    nativeDirectory = await deployedDependency(root, nativePackageName, '@openai/codex')
  }
  catch (error) {
    throw new Error(`Bundled Codex for darwin-${architecture} is unavailable. Build on the matching architecture or choose CRAFT_HUB_DESKTOP_CODEX_MODE=external.`, { cause: error })
  }
  const vendorDirectory = await stagedDirectory(root, join(nativeDirectory, 'vendor'))
  const triple = architecture === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  const targetDirectory = join(vendorDirectory, triple)
  const currentExecutable = join(targetDirectory, 'bin/codex')
  try {
    await Promise.all([access(currentExecutable), access(join(targetDirectory, 'codex-package.json'))])
  }
  catch {
    // The pinned SDK also supports the older native package layout.
    await access(join(targetDirectory, 'codex/codex'))
  }

  // Validate every removable package before deleting anything, including deployment symlinks.
  const codexDirectory = await deployedDependency(root, '@openai/codex')
  const codexManifest = JSON.parse(await readFile(join(codexDirectory, 'package.json'), 'utf8')) as { optionalDependencies?: Record<string, string> }
  const removablePackages: string[] = []
  for (const name of Object.keys(codexManifest.optionalDependencies ?? {})) {
    if (name === nativePackageName || !/^@openai\/codex-(?:darwin|linux|win32)-(?:arm64|x64)$/.test(name))
      continue
    try {
      await access(join(root, 'node_modules', name))
    }
    catch {
      continue
    }
    await deployedDependency(root, name, '@openai/codex')
    removablePackages.push(name)
  }
  for (const name of removablePackages)
    await rm(join(root, 'node_modules', name), { recursive: true, force: true })
  for (const entry of await readdir(prebuildDirectory)) {
    if (entry !== `darwin-${architecture}`)
      await rm(join(prebuildDirectory, entry), { recursive: true, force: true })
  }
  for (const entry of await readdir(vendorDirectory)) {
    if (entry !== triple)
      await rm(join(vendorDirectory, entry), { recursive: true, force: true })
  }
}

async function removeBundledCodex(root: string): Promise<void> {
  const codexDirectory = await deployedDependency(root, '@openai/codex')
  const metadata = JSON.parse(await readFile(join(codexDirectory, 'package.json'), 'utf8')) as { optionalDependencies?: Record<string, string> }
  const names = Object.keys(metadata.optionalDependencies ?? {}).filter(name => /^@openai\/codex-(?:darwin|linux|win32)-(?:arm64|x64)$/.test(name))
  let binDirectory: string | undefined
  try {
    await access(join(root, 'node_modules/.bin'))
    binDirectory = await stagedDirectory(root, join(root, 'node_modules/.bin'))
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error
  }
  for (const name of names) {
    try {
      await access(join(root, 'node_modules', name))
    }
    catch {
      continue
    }
    await deployedDependency(root, name, '@openai/codex')
  }
  for (const name of [...names, '@openai/codex'])
    await rm(join(root, 'node_modules', name), { recursive: true, force: true })
  if (binDirectory) {
    for (const name of ['codex', 'codex.cmd', 'codex.ps1'])
      await rm(join(binDirectory, name), { force: true })
  }
}

async function deployedDependency(root: string, name: string, expectedName = name): Promise<string> {
  const directory = await stagedDirectory(root, join(root, 'node_modules', name))
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as { name?: string }
  if (metadata.name !== expectedName)
    throw new Error(`Unexpected desktop dependency at ${directory}: ${metadata.name}`)
  return directory
}

async function stagedDirectory(root: string, path: string): Promise<string> {
  const directory = await realpath(path)
  const offset = relative(root, directory)
  if (offset === '..' || offset.startsWith('../') || resolve(root, offset) !== directory)
    throw new Error(`Desktop dependency must stay inside the deployed directory: ${path}`)
  return directory
}

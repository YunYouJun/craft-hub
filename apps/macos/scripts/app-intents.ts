import { execFile } from 'node:child_process'
import { cp, glob, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Read constants only from this Release product's architecture, never stale builds or test products. */
export async function appIntentConstantPaths(binDirectory: string, architecture: string): Promise<string[]> {
  if (architecture !== 'arm64' && architecture !== 'x64')
    throw new Error('App Intents extraction requires arm64 or x64')
  let directory: string
  if (basename(binDirectory) === 'Release' && basename(dirname(binDirectory)) === 'Products') {
    directory = resolve(binDirectory, '../../Intermediates.noindex/CraftHubMac.build/Release/CraftHubMac-p.build/Objects-normal', architecture === 'arm64' ? 'arm64' : 'x86_64')
  }
  else if (basename(binDirectory) === 'release') {
    directory = join(binDirectory, 'CraftHubMac.build')
  }
  else {
    throw new Error('Unrecognized Swift Release build product directory')
  }
  const paths = (await Array.fromAsync(glob('**/*.swiftconstvalues', { cwd: directory }))).sort().map(path => join(directory, path))
  if (!paths.length)
    throw new Error(`The ${architecture} Release compiler did not emit CraftHubMac intent constants`)
  return paths
}

/** Extract system-discoverable intent metadata from this app's Release constants, excluding tests and dependencies. */
export async function embedAppIntents(appDir: string, resources: string, architecture: string, binDirectory: string): Promise<void> {
  const staging = await mkdtemp(join(tmpdir(), 'craft-hub-intents-'))
  try {
    const sources = await Array.fromAsync(glob('Sources/CraftHubMac/**/*.swift', { cwd: appDir }))
    const constants = await appIntentConstantPaths(binDirectory, architecture)
    const sourceList = join(staging, 'sources.txt')
    const constantsList = join(staging, 'constants.txt')
    await writeFile(sourceList, `${sources.map(path => join(appDir, path)).join('\n')}\n`)
    await writeFile(constantsList, `${constants.join('\n')}\n`)
    const developerDir = (await run('xcode-select', ['-p'])).stdout.trim()
    const sdk = (await run('xcrun', ['--show-sdk-path'])).stdout.trim()
    const version = (await run('xcodebuild', ['-version'])).stdout.match(/Build version (\S+)/)?.[1]
    if (!version)
      throw new Error('The Xcode build version is unavailable for App Intents extraction')
    await run('xcrun', [
      'appintentsmetadataprocessor',
      '--output',
      staging,
      '--toolchain-dir',
      join(developerDir, 'Toolchains/XcodeDefault.xctoolchain'),
      '--module-name',
      'CraftHubMac',
      '--sdk-root',
      sdk,
      '--xcode-version',
      version,
      '--platform-family',
      'macOS',
      '--deployment-target',
      '15.0',
      '--target-triple',
      `${architecture === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos15.0`,
      '--source-file-list',
      sourceList,
      '--swift-const-vals-list',
      constantsList,
    ], { maxBuffer: 8 * 1024 * 1024 })
    const metadata = join(staging, 'Metadata.appintents')
    const data = JSON.parse(await readFile(join(metadata, 'extract.actionsdata'), 'utf8')) as { actions?: Record<string, { openAppWhenRun?: boolean }> }
    for (const name of ['OpenProjectIntent', 'QuickCaptureIntent']) {
      if (data.actions?.[name]?.openAppWhenRun !== true)
        throw new Error(`App Intents metadata is missing the foreground action ${name}`)
    }
    await mkdir(resources, { recursive: true })
    await cp(metadata, join(resources, 'Metadata.appintents'), { recursive: true })
  }
  finally {
    await rm(staging, { recursive: true, force: true })
  }
}

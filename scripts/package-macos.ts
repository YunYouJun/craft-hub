import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { packager } from '@electron/packager'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = resolve(repositoryRoot, 'release')

interface PackageMetadata {
  author?: string
  description?: string
  license?: string
  version: string
}

const supportedArchitectures = ['arm64', 'x64'] as const
type MacArchitecture = typeof supportedArchitectures[number]

function getArchitectures(): MacArchitecture[] {
  const configuredArchitectures = process.env.MACOS_ARCHES?.split(',')
    .map(architecture => architecture.trim())
    .filter(Boolean)
  const architectures = configuredArchitectures?.length
    ? configuredArchitectures
    : [...supportedArchitectures]

  for (const architecture of architectures) {
    if (!supportedArchitectures.includes(architecture as MacArchitecture))
      throw new Error(`Unsupported macOS architecture: ${architecture}`)
  }

  return architectures as MacArchitecture[]
}

function getSigningOptions() {
  if (process.env.MACOS_SIGNING_ENABLED !== 'true')
    return {}

  const requiredEnvironment = [
    'MACOS_KEYCHAIN_PATH',
    'APPLE_API_KEY_PATH',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER_ID',
  ] as const

  for (const name of requiredEnvironment) {
    if (!process.env[name])
      throw new Error(`${name} is required when macOS signing is enabled`)
  }

  return {
    osxNotarize: {
      appleApiIssuer: process.env.APPLE_API_ISSUER_ID!,
      appleApiKey: process.env.APPLE_API_KEY_PATH!,
      appleApiKeyId: process.env.APPLE_API_KEY_ID!,
    },
    osxSign: {
      hardenedRuntime: true,
      keychain: process.env.MACOS_KEYCHAIN_PATH!,
    },
  }
}

function macosApplicationVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match)
    throw new Error(`Workspace version is not a semantic version: ${version}`)
  return `${match[1]}.${match[2]}.${match[3]}`
}

async function createDistributionArtifacts(appPath: string, architecture: MacArchitecture): Promise<void> {
  const volumeDirectory = await mkdtemp(join(tmpdir(), `craft-hub-dmg-${architecture}-`))
  const dmgPath = join(outputDirectory, `Craft-Hub-macOS-${architecture}.dmg`)
  const zipPath = join(outputDirectory, `Craft-Hub-macOS-${architecture}.zip`)

  try {
    await cp(appPath, join(volumeDirectory, 'Craft Hub.app'), { recursive: true })
    await symlink('/Applications', join(volumeDirectory, 'Applications'))
    await rm(dmgPath, { force: true })
    await rm(zipPath, { force: true })
    await execFileAsync('hdiutil', [
      'create',
      '-volname',
      'Craft Hub',
      '-srcfolder',
      volumeDirectory,
      '-ov',
      '-format',
      'UDZO',
      dmgPath,
    ])
    await execFileAsync('ditto', [
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
      appPath,
      zipPath,
    ])

    if (process.env.MACOS_SIGNING_ENABLED === 'true') {
      await execFileAsync('xcrun', [
        'notarytool',
        'submit',
        dmgPath,
        '--key',
        process.env.APPLE_API_KEY_PATH!,
        '--key-id',
        process.env.APPLE_API_KEY_ID!,
        '--issuer',
        process.env.APPLE_API_ISSUER_ID!,
        '--wait',
      ])
      await execFileAsync('xcrun', ['stapler', 'staple', dmgPath])
    }

    console.log(`Created macOS DMG: ${dmgPath}`)
    console.log(`Created macOS update archive: ${zipPath}`)
  }
  finally {
    await rm(volumeDirectory, { force: true, recursive: true })
  }
}

async function deployDesktop(targetDirectory: string): Promise<void> {
  const { stderr, stdout } = await execFileAsync('pnpm', [
    '--config.node-linker=hoisted',
    '--filter',
    '@craft-hub/desktop',
    '--prod',
    'deploy',
    targetDirectory,
  ], {
    cwd: repositoryRoot,
  })

  process.stdout.write(stdout)
  process.stderr.write(stderr)
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin')
    throw new Error('macOS packages must be built on macOS')

  const stagingDirectory = await mkdtemp(join(tmpdir(), 'craft-hub-package-'))
  const desktopDirectory = join(stagingDirectory, 'apps/desktop')

  try {
    await deployDesktop(desktopDirectory)
    await mkdir(join(stagingDirectory, 'apps/web'), { recursive: true })
    await cp(
      resolve(repositoryRoot, 'apps/web/dist'),
      join(stagingDirectory, 'apps/web/dist'),
      { recursive: true },
    )

    const workspacePackage = JSON.parse(
      await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'),
    ) as PackageMetadata
    const electronPackage = JSON.parse(
      await readFile(
        resolve(repositoryRoot, 'apps/desktop/node_modules/electron/package.json'),
        'utf8',
      ),
    ) as { version: string }

    await writeFile(join(stagingDirectory, 'package.json'), `${JSON.stringify({
      name: 'craft-hub-desktop',
      productName: 'Craft Hub',
      version: workspacePackage.version,
      description: workspacePackage.description,
      author: workspacePackage.author,
      license: workspacePackage.license,
      main: 'apps/desktop/dist/main.mjs',
    }, null, 2)}\n`)

    const architectures = getArchitectures()
    const appPaths = await packager({
      appBundleId: 'com.yunyoujun.craft-hub',
      appCategoryType: 'public.app-category.developer-tools',
      arch: architectures,
      appVersion: macosApplicationVersion(workspacePackage.version),
      asar: { unpack: '**/node-pty/**' },
      dir: stagingDirectory,
      electronVersion: electronPackage.version,
      icon: resolve(repositoryRoot, 'apps/desktop/assets/icon.icns'),
      name: 'Craft Hub',
      out: outputDirectory,
      overwrite: true,
      platform: 'darwin',
      prune: false,
      ...getSigningOptions(),
    })

    if (appPaths.length !== architectures.length) {
      throw new Error(
        `Expected ${architectures.length} packaged apps, received ${appPaths.length}`,
      )
    }

    for (const appPath of appPaths)
      console.log(`Packaged macOS app: ${appPath}`)

    for (const architecture of architectures) {
      const appPath = appPaths.find(path => path.endsWith(`darwin-${architecture}`))
      if (!appPath)
        throw new Error(`Packager did not return an app for ${architecture}`)
      await createDistributionArtifacts(join(appPath, 'Craft Hub.app'), architecture)
    }
  }
  finally {
    await rm(stagingDirectory, { force: true, recursive: true })
  }
}

await main()

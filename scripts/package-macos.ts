import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { packager } from '@electron/packager'
import { createDesktopBuildInfo } from '../apps/desktop/src/build-info.ts'
import { communityDesktopArtifactName, communityDesktopProtocol, loadDesktopDistributionManifest, resolveDesktopDistributionAsset } from '../apps/desktop/src/distribution.ts'

const execFileAsync = promisify(execFile)
const staplerRetryDelayMs = 15_000
const staplerMaxAttempts = 6
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configuredDistributionPath = process.env.CRAFT_HUB_DESKTOP_DISTRIBUTION_CONFIG
  ? resolve(process.env.CRAFT_HUB_DESKTOP_DISTRIBUTION_CONFIG)
  : undefined
const desktopDistribution = loadDesktopDistributionManifest(configuredDistributionPath)
if (configuredDistributionPath && !desktopDistribution)
  throw new Error(`Desktop distribution manifest does not exist: ${configuredDistributionPath}`)
const outputDirectory = resolve(repositoryRoot, process.env.CRAFT_HUB_DESKTOP_OUTPUT_DIR ?? 'release')
const productName = desktopDistribution?.distribution.name ?? 'Craft Hub'
const artifactName = desktopDistribution?.desktop.artifactName ?? communityDesktopArtifactName
const desktopProtocol = desktopDistribution?.desktop.protocol ?? communityDesktopProtocol
const appBundleId = desktopDistribution?.distribution.appId ?? 'com.yunyoujun.craft-hub'
const macosApplicationIcon = configuredDistributionPath && desktopDistribution?.desktop.icons
  ? resolveDesktopDistributionAsset(configuredDistributionPath, desktopDistribution.desktop.icons.macos)
  : resolve(repositoryRoot, 'apps/desktop/assets/icon.icns')

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

function getSigningOptions(signingIdentity?: string) {
  if (process.env.MACOS_SIGNING_ENABLED !== 'true') {
    return {
      osxSign: {
        continueOnError: false,
        identity: '-',
        identityValidation: false,
        optionsForFile: () => ({
          hardenedRuntime: false,
          timestamp: 'none',
        }),
      },
    }
  }

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
      continueOnError: false,
      hardenedRuntime: true,
      identity: signingIdentity,
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

async function stapleNotarizedArtifact(path: string): Promise<void> {
  for (let attempt = 1; attempt <= staplerMaxAttempts; attempt += 1) {
    try {
      await execFileAsync('xcrun', ['stapler', 'staple', path])
      return
    }
    catch (error) {
      const output = `${(error as { stdout?: string }).stdout ?? ''}\n${(error as { stderr?: string }).stderr ?? ''}`
      const ticketIsPropagating = output.includes('Record not found')
        || output.includes('Could not find base64 encoded ticket')
      if (!ticketIsPropagating || attempt === staplerMaxAttempts)
        throw error
      console.warn(`Apple notarization ticket is not available yet; retrying stapler (${attempt}/${staplerMaxAttempts})`)
      await new Promise(resolve => setTimeout(resolve, staplerRetryDelayMs))
    }
  }
}

async function resolveSigningIdentity(): Promise<string> {
  const keychain = process.env.MACOS_KEYCHAIN_PATH!
  const { stdout } = await execFileAsync('security', [
    'find-identity',
    '-v',
    '-p',
    'codesigning',
    keychain,
  ])
  const identity = /^\s*\d+\)\s+([0-9A-F]{40})\s+"Developer ID Application:/m.exec(stdout)?.[1]
  if (!identity)
    throw new Error(`No Developer ID Application identity found in ${keychain}`)
  return identity
}

async function signDiskImage(path: string, identity: string): Promise<void> {
  const keychain = process.env.MACOS_KEYCHAIN_PATH!
  await execFileAsync('codesign', [
    '--force',
    '--sign',
    identity,
    '--keychain',
    keychain,
    '--timestamp',
    '--identifier',
    `${appBundleId}.disk-image`,
    path,
  ])
}

function notaryCredentials(): string[] {
  return [
    '--key',
    process.env.APPLE_API_KEY_PATH!,
    '--key-id',
    process.env.APPLE_API_KEY_ID!,
    '--issuer',
    process.env.APPLE_API_ISSUER_ID!,
  ]
}

async function notarizeArtifact(path: string): Promise<void> {
  const { stdout } = await execFileAsync('xcrun', [
    'notarytool',
    'submit',
    path,
    ...notaryCredentials(),
    '--wait',
    '--output-format',
    'json',
  ])
  const result = JSON.parse(stdout) as { id?: string, message?: string, status?: string }
  console.log(`Apple notarization ${result.id ?? 'unknown'}: ${result.status ?? 'unknown'}`)
  if (result.status === 'Accepted')
    return

  if (result.id) {
    const { stdout: log } = await execFileAsync('xcrun', [
      'notarytool',
      'log',
      result.id,
      ...notaryCredentials(),
    ])
    console.error(log)
  }
  throw new Error(`Apple notarization was not accepted: ${result.status ?? result.message ?? 'unknown status'}`)
}

async function createDistributionArtifacts(appPath: string, architecture: MacArchitecture, signingIdentity?: string): Promise<void> {
  const volumeDirectory = await mkdtemp(join(tmpdir(), `${artifactName.toLowerCase()}-dmg-${architecture}-`))
  const dmgPath = join(outputDirectory, `${artifactName}-macOS-${architecture}.dmg`)
  const zipPath = join(outputDirectory, `${artifactName}-macOS-${architecture}.zip`)

  try {
    await cp(appPath, join(volumeDirectory, `${productName}.app`), { recursive: true })
    await symlink('/Applications', join(volumeDirectory, 'Applications'))
    await rm(dmgPath, { force: true })
    await rm(zipPath, { force: true })
    await execFileAsync('hdiutil', [
      'create',
      '-volname',
      productName,
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
      await signDiskImage(dmgPath, signingIdentity!)
      await notarizeArtifact(dmgPath)
      await stapleNotarizedArtifact(dmgPath)
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

async function copyDistributionAsset(
  sourceManifestPath: string,
  targetManifestPath: string,
  assetPath: string,
): Promise<void> {
  const source = resolveDesktopDistributionAsset(sourceManifestPath, assetPath)
  const target = resolveDesktopDistributionAsset(targetManifestPath, assetPath)
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target)
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin')
    throw new Error('macOS packages must be built on macOS')

  const stagingDirectory = await mkdtemp(join(tmpdir(), 'craft-hub-package-'))
  const desktopDirectory = join(stagingDirectory, 'apps/desktop')

  try {
    await deployDesktop(desktopDirectory)
    await writeFile(
      join(desktopDirectory, 'desktop-build.json'),
      `${JSON.stringify(createDesktopBuildInfo(process.env.MACOS_SIGNING_ENABLED === 'true'), null, 2)}\n`,
    )
    if (configuredDistributionPath) {
      const targetManifestPath = join(desktopDirectory, 'distribution.json')
      await cp(configuredDistributionPath, targetManifestPath)
      for (const assetPath of Object.values(desktopDistribution?.desktop.icons ?? {}))
        await copyDistributionAsset(configuredDistributionPath, targetManifestPath, assetPath)
    }
    await mkdir(join(stagingDirectory, 'apps/web'), { recursive: true })
    await cp(
      resolve(repositoryRoot, 'apps/web/dist'),
      join(stagingDirectory, 'apps/web/dist'),
      { recursive: true },
    )

    const workspacePackage = JSON.parse(
      await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'),
    ) as PackageMetadata
    const desktopVersion = process.env.CRAFT_HUB_DESKTOP_VERSION ?? workspacePackage.version
    const electronPackage = JSON.parse(
      await readFile(
        resolve(repositoryRoot, 'apps/desktop/node_modules/electron/package.json'),
        'utf8',
      ),
    ) as { version: string }

    await writeFile(join(stagingDirectory, 'package.json'), `${JSON.stringify({
      name: 'craft-hub-desktop',
      productName,
      version: desktopVersion,
      description: desktopDistribution?.desktop.about?.description ?? workspacePackage.description,
      author: workspacePackage.author,
      license: workspacePackage.license,
      main: 'apps/desktop/dist/main.mjs',
    }, null, 2)}\n`)

    const architectures = getArchitectures()
    const signingIdentity = process.env.MACOS_SIGNING_ENABLED === 'true'
      ? await resolveSigningIdentity()
      : undefined
    const appPaths = await packager({
      appBundleId,
      appCategoryType: 'public.app-category.developer-tools',
      arch: architectures,
      appVersion: macosApplicationVersion(desktopVersion),
      asar: { unpack: '**/node-pty/**' },
      dir: stagingDirectory,
      electronVersion: electronPackage.version,
      icon: macosApplicationIcon,
      name: productName,
      out: outputDirectory,
      overwrite: true,
      platform: 'darwin',
      protocols: [{ name: `${productName} Desktop Links`, schemes: [desktopProtocol] }],
      prune: false,
      ...getSigningOptions(signingIdentity),
    })

    if (appPaths.length !== architectures.length) {
      throw new Error(
        `Expected ${architectures.length} packaged apps, received ${appPaths.length}`,
      )
    }

    for (const appPath of appPaths) {
      if (signingIdentity) {
        await execFileAsync('codesign', [
          '--verify',
          '--deep',
          '--strict',
          '--verbose=4',
          join(appPath, `${productName}.app`),
        ])
      }
      console.log(`Packaged macOS app: ${appPath}`)
    }

    for (const architecture of architectures) {
      const appPath = appPaths.find(path => path.endsWith(`darwin-${architecture}`))
      if (!appPath)
        throw new Error(`Packager did not return an app for ${architecture}`)
      await createDistributionArtifacts(join(appPath, `${productName}.app`), architecture, signingIdentity)
    }
  }
  finally {
    await rm(stagingDirectory, { force: true, recursive: true })
  }
}

await main()

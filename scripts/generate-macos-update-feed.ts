import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { macosApplicationVersion } from '../apps/desktop/src/macos-version.ts'

export interface MacosUpdateFeedOptions {
  architecture: 'arm64' | 'x64'
  outputPath: string
  publishedAt: string
  releaseTag: string
  repository: string
}

/** Write a validated, architecture-specific static Squirrel.Mac release manifest. */
export async function generateMacosUpdateFeed(options: MacosUpdateFeedOptions): Promise<void> {
  if (options.architecture !== 'arm64' && options.architecture !== 'x64')
    throw new Error(`Update architecture must be arm64 or x64: ${options.architecture}`)
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-alpha\.(?:0|[1-9]\d*))?$/.test(options.releaseTag))
    throw new Error(`Release tag must be v followed by a stable or numeric alpha SemVer: ${options.releaseTag}`)
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/[\w.-]{1,100}$/i.test(options.repository) || /\/\.{1,2}$/.test(options.repository))
    throw new Error(`Repository must be a GitHub owner/repository pair: ${options.repository}`)
  validatePublicationDate(options.publishedAt)

  const semanticVersion = options.releaseTag.slice(1)
  const updateVersion = macosApplicationVersion(semanticVersion)
  if (updateVersion.split('.').some(part => !Number.isSafeInteger(Number(part))))
    throw new Error(`Release version is outside the supported macOS update range: ${semanticVersion}`)
  const asset = `Craft-Hub-macOS-${options.architecture}.zip`
  const update = {
    currentRelease: updateVersion,
    releases: [{
      version: updateVersion,
      updateTo: {
        version: updateVersion,
        pub_date: options.publishedAt,
        notes: `Craft Hub ${options.releaseTag} update`,
        name: semanticVersion,
        url: `https://github.com/${options.repository}/releases/download/${options.releaseTag}/${asset}`,
      },
    }],
  }
  await mkdir(dirname(options.outputPath), { recursive: true })
  await writeFile(options.outputPath, `${JSON.stringify(update, null, 2)}\n`)
}

function validatePublicationDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
    throw new Error(`Release publication date must be a valid ISO 8601 UTC timestamp: ${value}`)
  const normalized = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction: string | undefined) => `.${(fraction ?? '').padEnd(3, '0')}Z`)
  const date = new Date(normalized)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== normalized)
    throw new Error(`Release publication date must be a valid ISO 8601 UTC timestamp: ${value}`)
}

if (process.argv[1]?.endsWith('generate-macos-update-feed.ts')) {
  const architecture = process.env.ARCH
  if (architecture !== 'arm64' && architecture !== 'x64')
    throw new Error(`ARCH must be arm64 or x64: ${architecture ?? 'missing'}`)
  for (const name of ['RELEASE_TAG', 'RELEASE_PUBLISHED_AT', 'GITHUB_REPOSITORY'] as const) {
    if (!process.env[name])
      throw new Error(`${name} is required`)
  }
  await generateMacosUpdateFeed({
    architecture,
    outputPath: resolve(`_site/updates/alpha/darwin/${architecture}/RELEASES.json`),
    publishedAt: process.env.RELEASE_PUBLISHED_AT!,
    releaseTag: process.env.RELEASE_TAG!,
    repository: process.env.GITHUB_REPOSITORY!,
  })
}

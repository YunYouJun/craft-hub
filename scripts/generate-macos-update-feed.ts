import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { macosApplicationVersion } from '../apps/desktop/src/macos-version.ts'

interface MacosUpdateFeedOptions {
  architecture: 'arm64' | 'x64'
  outputPath: string
  publishedAt: string
  releaseTag: string
  repository: string
}

export async function generateMacosUpdateFeed(options: MacosUpdateFeedOptions): Promise<void> {
  const semanticVersion = options.releaseTag.replace(/^v/, '')
  const updateVersion = macosApplicationVersion(semanticVersion)
  const asset = `Craft-Hub-macOS-${options.architecture}.zip`
  const update = {
    currentRelease: updateVersion,
    releases: [{
      version: updateVersion,
      updateTo: {
        version: updateVersion,
        pub_date: options.publishedAt,
        notes: `Craft Hub ${options.releaseTag} alpha update`,
        name: semanticVersion,
        url: `https://github.com/${options.repository}/releases/download/${options.releaseTag}/${asset}`,
      },
    }],
  }
  await mkdir(dirname(options.outputPath), { recursive: true })
  await writeFile(options.outputPath, `${JSON.stringify(update, null, 2)}\n`)
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

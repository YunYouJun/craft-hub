import type { MacosUpdateFeedOptions } from './generate-macos-update-feed.ts'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateMacosUpdateFeed } from './generate-macos-update-feed.ts'

const directories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'craft-hub-update-feed-'))
  directories.push(directory)
  return directory
}

function feedOptions(outputPath: string): MacosUpdateFeedOptions {
  return {
    architecture: 'arm64',
    outputPath,
    publishedAt: '2026-10-13T04:05:06Z',
    releaseTag: 'v0.0.1-alpha.5',
    repository: 'example/craft-hub',
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

describe('macOS static update feeds', () => {
  it.each(['arm64', 'x64'] as const)('targets the matching %s ZIP with one consistent numeric version', async (architecture) => {
    const directory = await temporaryDirectory()
    const outputPath = join(directory, architecture, 'RELEASES.json')
    const options = { ...feedOptions(outputPath), architecture }

    await generateMacosUpdateFeed(options)

    const source = await readFile(outputPath, 'utf8')
    expect(source.endsWith('\n')).toBe(true)
    expect(JSON.parse(source)).toEqual({
      currentRelease: '0.0.1005',
      releases: [{
        version: '0.0.1005',
        updateTo: {
          version: '0.0.1005',
          pub_date: options.publishedAt,
          notes: 'Craft Hub v0.0.1-alpha.5 update',
          name: '0.0.1-alpha.5',
          url: `https://github.com/example/craft-hub/releases/download/v0.0.1-alpha.5/Craft-Hub-macOS-${architecture}.zip`,
        },
      }],
    })
  })

  it('keeps the stable transport version newer than alphas without labelling it as alpha', async () => {
    const outputPath = join(await temporaryDirectory(), 'RELEASES.json')
    await generateMacosUpdateFeed({ ...feedOptions(outputPath), releaseTag: 'v0.0.1' })

    const feed = JSON.parse(await readFile(outputPath, 'utf8'))
    expect(feed.currentRelease).toBe('0.0.1999')
    expect(feed.releases[0].updateTo).toMatchObject({ name: '0.0.1', notes: 'Craft Hub v0.0.1 update' })
  })

  it.each(['2024-02-29T04:05:06Z', '2026-10-13T04:05:06.1Z', '2026-10-13T04:05:06.123Z'])('preserves a valid UTC publication timestamp %s', async (publishedAt) => {
    const outputPath = join(await temporaryDirectory(), 'RELEASES.json')
    await generateMacosUpdateFeed({ ...feedOptions(outputPath), publishedAt })
    const feed = JSON.parse(await readFile(outputPath, 'utf8'))
    expect(feed.releases[0].updateTo.pub_date).toBe(publishedAt)
  })

  it.each([
    { releaseTag: '0.0.1-alpha.5' },
    { releaseTag: 'v0.0.1-beta.1' },
    { releaseTag: 'v0.0.1-alpha.999' },
    { releaseTag: 'v0.0.1-alpha.05' },
    { releaseTag: 'v00.0.1' },
    { releaseTag: 'v0.0.1+local' },
    { releaseTag: 'v0.0.1-alpha.5/other' },
    { releaseTag: 'v9007199254740992.0.1' },
    { releaseTag: 'v0.0.9007199254741' },
    { repository: 'https://github.com/example/craft-hub' },
    { repository: 'example/craft-hub/other' },
    { repository: '../craft-hub' },
    { repository: 'example/..' },
    { repository: 'example/craft-hub?redirect=other' },
    { publishedAt: 'not-a-date' },
    { publishedAt: '2026-02-29T04:05:06Z' },
    { publishedAt: '2026-10-13T24:00:00Z' },
    { publishedAt: '2026-10-13' },
  ])('rejects invalid release metadata without replacing an existing feed: %j', async (invalid) => {
    const outputPath = join(await temporaryDirectory(), 'RELEASES.json')
    const existingFeed = '{"currentRelease":"0.0.1004"}\n'
    await writeFile(outputPath, existingFeed)

    await expect(generateMacosUpdateFeed({ ...feedOptions(outputPath), ...invalid })).rejects.toThrow()
    expect(await readFile(outputPath, 'utf8')).toBe(existingFeed)
  })

  it('rejects an unsupported architecture before creating a feed', async () => {
    const outputPath = join(await temporaryDirectory(), 'RELEASES.json')
    const options = { ...feedOptions(outputPath), architecture: 'universal' }

    // Untyped release automation can provide an architecture outside the TypeScript contract.
    await expect(generateMacosUpdateFeed(options as MacosUpdateFeedOptions)).rejects.toThrow('architecture')
    await expect(readFile(outputPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

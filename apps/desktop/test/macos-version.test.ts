import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateMacosUpdateFeed } from '../../../scripts/generate-macos-update-feed.ts'
import { macosApplicationVersion } from '../src/macos-version.ts'

describe('macOS application update version', () => {
  it('keeps numeric alpha releases strictly increasing', () => {
    expect(macosApplicationVersion('0.0.1-alpha.2')).toBe('0.0.1002')
    expect(macosApplicationVersion('0.0.1-alpha.5')).toBe('0.0.1005')
  })

  it('sorts the stable release after its alpha releases', () => {
    expect(macosApplicationVersion('0.0.1')).toBe('0.0.1999')
  })

  it('rejects unsupported prereleases and exhausted alpha ranges', () => {
    expect(() => macosApplicationVersion('0.0.1-beta.1')).toThrow()
    expect(() => macosApplicationVersion('0.0.1-alpha.999')).toThrow()
  })

  it('writes the numeric transport version and semantic release label', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-update-feed-'))
    const outputPath = join(directory, 'RELEASES.json')
    try {
      await generateMacosUpdateFeed({
        architecture: 'arm64',
        outputPath,
        publishedAt: '2026-08-31T00:00:00Z',
        releaseTag: 'v0.0.1-alpha.5',
        repository: 'YunYouJun/craft-hub',
      })
      const feed = JSON.parse(await readFile(outputPath, 'utf8'))
      expect(feed.currentRelease).toBe('0.0.1005')
      expect(feed.releases[0].updateTo).toMatchObject({
        name: '0.0.1-alpha.5',
        version: '0.0.1005',
        url: 'https://github.com/YunYouJun/craft-hub/releases/download/v0.0.1-alpha.5/Craft-Hub-macOS-arm64.zip',
      })
    }
    finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})

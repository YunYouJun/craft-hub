import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDesktopBuildInfo, loadDesktopBuildInfo } from '../src/build-info.ts'

describe('desktop build info', () => {
  it('enables updates only for signed release builds', () => {
    expect(createDesktopBuildInfo(false)).toEqual({ schemaVersion: 1, updatesEnabled: false })
    expect(createDesktopBuildInfo(true)).toEqual({ schemaVersion: 1, updatesEnabled: true })
  })

  it('keeps updates disabled when local package metadata is absent', () => {
    expect(loadDesktopBuildInfo('/missing/desktop-build.json')).toEqual({ schemaVersion: 1, updatesEnabled: false })
  })

  it('loads validated packaged build metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-desktop-build-'))
    const path = join(directory, 'desktop-build.json')
    await writeFile(path, JSON.stringify({ schemaVersion: 1, updatesEnabled: true }))

    expect(loadDesktopBuildInfo(path)).toEqual({ schemaVersion: 1, updatesEnabled: true })
  })
})

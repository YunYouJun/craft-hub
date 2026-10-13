import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDesktopBuildInfo, loadDesktopBuildInfo } from '../src/build-info.ts'

describe('desktop build info', () => {
  it('enables updates only for signed release builds', () => {
    expect(createDesktopBuildInfo(false)).toEqual({ schemaVersion: 1, updatesEnabled: false, codexMode: 'external' })
    expect(createDesktopBuildInfo(true)).toEqual({ schemaVersion: 1, updatesEnabled: true, codexMode: 'external' })
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

  it('defaults new builds to external Codex while preserving explicit bundled and legacy metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-desktop-build-'))
    const path = join(directory, 'desktop-build.json')
    await writeFile(path, JSON.stringify(createDesktopBuildInfo(false)))
    expect(loadDesktopBuildInfo(path)).toEqual({ schemaVersion: 1, updatesEnabled: false, codexMode: 'external' })
    await writeFile(path, JSON.stringify(createDesktopBuildInfo(false, 'bundled')))
    expect(loadDesktopBuildInfo(path)).toEqual({ schemaVersion: 1, updatesEnabled: false })
    await writeFile(path, JSON.stringify({ schemaVersion: 1, updatesEnabled: false, codexMode: 'unknown' }))
    expect(() => loadDesktopBuildInfo(path)).toThrow('bundled or external Codex mode')
  })
})

import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CraftHubSettingsService, SettingsConflictError } from '../src/settings'

async function settingsFixture(): Promise<{ root: string, service: CraftHubSettingsService }> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-settings-'))
  return { root, service: new CraftHubSettingsService(root, '1.2.3') }
}

describe('global settings', () => {
  it('uses defaults until an explicit setting is written atomically', async () => {
    const { root, service } = await settingsFixture()
    const initial = await service.get()

    expect(initial).toMatchObject({ explicitKeys: [], settings: { 'workbench.locale': 'en', 'workbench.theme': 'system' } })
    const updated = await service.update({ 'workbench.locale': 'zh-CN', 'workbench.theme': 'dark' }, initial.revision)

    expect(updated.settings['workbench.locale']).toBe('zh-CN')
    expect(updated.settings['workbench.theme']).toBe('dark')
    expect(updated.explicitKeys).toEqual(['workbench.locale', 'workbench.theme'])
    expect(JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'))).toEqual({
      '$schema': './settings.schema.json',
      'workbench.locale': 'zh-CN',
      'workbench.theme': 'dark',
    })
    expect(JSON.parse(await readFile(join(root, 'settings.schema.json'), 'utf8'))).toMatchObject({
      title: 'Craft Hub user settings',
      additionalProperties: false,
    })
  })

  it('rejects stale revisions and unknown core settings', async () => {
    const { service } = await settingsFixture()
    const initial = await service.get()
    await service.update({ 'workbench.locale': 'zh-CN' }, initial.revision)

    await expect(service.update({ 'workbench.locale': 'en' }, initial.revision)).rejects.toBeInstanceOf(SettingsConflictError)
    const current = await service.get()
    await expect(service.update({ 'workbench.local': 'en' }, current.revision)).rejects.toThrow('Unknown core setting')
  })

  it('exports minimal and full envelopes and previews imports', async () => {
    const { service } = await settingsFixture()
    const initial = await service.get()
    await service.update({ 'extensions.example.enabled': true }, initial.revision)

    const minimal = await service.export('minimal')
    const full = await service.export('full')
    expect(minimal).toMatchObject({
      formatVersion: 1,
      exportMode: 'minimal',
      applicationVersion: '1.2.3',
      settings: { 'extensions.example.enabled': true },
    })
    expect(full.settings).toEqual({
      'workbench.locale': 'en',
      'workbench.theme': 'system',
      'extensions.example.enabled': true,
    })
    await expect(service.previewImport(minimal, 'replace')).resolves.toMatchObject({
      ignored: ['extensions.example.enabled'],
      warnings: [expect.stringContaining('not active')],
    })
  })

  it('backs up replace imports and retains five backups', async () => {
    const { root, service } = await settingsFixture()
    let snapshot = await service.get()
    snapshot = await service.update({ 'workbench.locale': 'zh-CN' }, snapshot.revision)
    const document = await service.export('full')

    vi.useFakeTimers()
    for (let index = 0; index < 6; index++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, index)))
      snapshot = await service.import(document, 'replace', snapshot.revision)
    }
    vi.useRealTimers()

    expect(await readdir(join(root, 'settings-backups'))).toHaveLength(5)
  })

  it('keeps the last valid value when an external edit is invalid', async () => {
    const { root, service } = await settingsFixture()
    const snapshot = await service.get()
    await service.update({ 'workbench.locale': 'zh-CN' }, snapshot.revision)
    await service.startWatching()
    const changed = new Promise<void>((resolve) => {
      service.onChanged((next) => {
        if (next.diagnostic)
          resolve()
      })
    })

    await writeFile(join(root, 'settings.json'), '{ invalid json', 'utf8')
    await changed

    expect(await service.get()).toMatchObject({
      diagnostic: expect.stringContaining('JSON'),
      settings: { 'workbench.locale': 'zh-CN' },
    })
    const invalid = await service.get()
    await expect(service.update({ 'workbench.locale': 'en' }, invalid.revision)).rejects.toThrow('was not overwritten')
    expect(await readFile(join(root, 'settings.json'), 'utf8')).toBe('{ invalid json')
    await service.close()

    await expect(new CraftHubSettingsService(root).get()).resolves.toMatchObject({
      diagnostic: expect.stringContaining('JSON'),
      settings: { 'workbench.locale': 'zh-CN' },
    })
  })

  it('preserves extension settings while rejecting unknown core keys on disk', async () => {
    const { root } = await settingsFixture()
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'settings.json'), JSON.stringify({ 'extensions.example.option': 42 }))
    const service = new CraftHubSettingsService(root)
    expect(await service.get()).toMatchObject({ explicitKeys: ['extensions.example.option'] })

    await writeFile(join(root, 'settings.json'), JSON.stringify({ 'workbench.typo': true }))
    await expect(new CraftHubSettingsService(root).get()).resolves.toMatchObject({
      diagnostic: 'Unknown core setting: workbench.typo',
      explicitKeys: ['extensions.example.option'],
    })
  })
})

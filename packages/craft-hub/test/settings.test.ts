import type { PersonalWorkbenchHome, WorkbenchSidebarSetting } from '../src/settings'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CraftHubSettingsService, personalWorkbenchHomeSchema, SettingsConflictError, sidebarSettingSchema } from '../src/settings'

async function settingsFixture(): Promise<{ root: string, service: CraftHubSettingsService }> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-settings-'))
  return { root, service: new CraftHubSettingsService(root, '1.2.3') }
}

describe('global settings', () => {
  it('initializes once when multiple readers arrive concurrently', async () => {
    const { root, service } = await settingsFixture()

    const [snapshot, extensions, ensuredPath] = await Promise.all([
      service.get(),
      service.extensionValues(),
      service.ensureFile(),
    ])

    expect(snapshot.explicitKeys).toEqual([])
    expect(extensions).toEqual({})
    expect(ensuredPath).toBe(join(root, 'settings.json'))
    expect(await readdir(root)).toEqual(expect.arrayContaining([
      'settings.json',
      'settings.schema.json',
    ]))
  })

  it('uses defaults until an explicit setting is written atomically', async () => {
    const { root, service } = await settingsFixture()
    const initial = await service.get()

    expect(initial).toMatchObject({ explicitKeys: [], settings: { 'workbench.codex': {}, 'workbench.editor': { default: 'vscode' }, 'workbench.locale': 'zh-CN', 'workbench.repositoriesRoot': '', 'workbench.shortcuts': { 'workbench.showCommandPalette': 'Mod+K' }, 'workbench.theme': 'system' } })
    const updated = await service.update({ 'workbench.locale': 'en', 'workbench.theme': 'dark' }, initial.revision)

    expect(updated.settings['workbench.locale']).toBe('en')
    expect(updated.settings['workbench.theme']).toBe('dark')
    expect(updated.explicitKeys).toEqual(['workbench.locale', 'workbench.theme'])
    expect(JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'))).toEqual({
      '$schema': './settings.schema.json',
      'workbench.locale': 'en',
      'workbench.theme': 'dark',
    })
    expect(JSON.parse(await readFile(join(root, 'settings.schema.json'), 'utf8'))).toMatchObject({
      title: 'Craft Hub user settings',
      additionalProperties: false,
    })
  })

  it('persists optional Codex model and reasoning defaults', async () => {
    const { root, service } = await settingsFixture()
    const initial = await service.get()
    const codex = { model: 'gpt-5.6-sol', reasoningEffort: 'high' as const }
    const updated = await service.update({ 'workbench.codex': codex }, initial.revision)

    expect(updated.settings['workbench.codex']).toEqual(codex)
    expect(JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'))['workbench.codex']).toEqual(codex)
    await expect(service.update({ 'workbench.codex': { reasoningEffort: 'extreme' } }, updated.revision)).rejects.toThrow()
  })

  it('provides grouped personal tool defaults without sharing mutable snapshots', async () => {
    const { service } = await settingsFixture()
    const snapshot = await service.get()

    expect(snapshot.settings['workbench.home']).toEqual({
      tools: [
        { id: 'raycast', title: 'Raycast', url: 'https://www.raycast.com/', group: 'Work tools', description: 'Launch tools and installed Raycast commands', launch: { application: 'raycast' } },
        { id: 'orca', title: 'Orca', url: 'https://www.onorca.dev/', group: 'Work tools', description: 'Continue agent work in Orca; project context is not transferred', launch: { application: 'orca' } },
        { id: 'chatgpt', title: 'ChatGPT', url: 'https://chatgpt.com/', group: 'AI Tools' },
        { id: 'claude', title: 'Claude', url: 'https://claude.ai/', group: 'AI Tools' },
      ],
    })
    snapshot.settings['workbench.home'].tools.length = 0
    expect((await service.get()).settings['workbench.home'].tools).toHaveLength(4)
    expect(service.schema()).toMatchObject({
      properties: { 'workbench.home': { properties: { tools: { maxItems: 100 } } } },
    })
  })

  it('persists and reloads personal tools and project pins with revisions', async () => {
    const { root, service } = await settingsFixture()
    const initial = await service.get()
    const home: PersonalWorkbenchHome = {
      tools: [{ id: 'docs', title: 'Project docs', url: 'https://docs.example.com/project', iconUrl: 'https://docs.example.com/icon.svg', group: 'Projects', description: 'Project reference' }],
      pinnedProjectIds: ['project-a', 'project-b'],
      workItems: { groupByList: true, density: 'compact', showEmptyLists: false },
    }
    const updated = await service.update({ 'workbench.home': home }, initial.revision)

    expect(updated.path).toBe(join(root, 'settings.json'))
    expect(updated.explicitKeys).toEqual(['workbench.home'])
    expect(updated.revision).not.toBe(initial.revision)
    expect(JSON.parse(await readFile(updated.path, 'utf8'))['workbench.home']).toEqual(home)
    const reloaded = await new CraftHubSettingsService(root).get()
    expect(reloaded.settings['workbench.home']).toEqual(home)
    expect(reloaded.revision).toBe(updated.revision)
    await expect(service.update({ 'workbench.home': { tools: [] } }, initial.revision)).rejects.toBeInstanceOf(SettingsConflictError)

    const reset = await service.update({ 'workbench.home': null }, updated.revision)
    expect(reset.settings['workbench.home'].tools).toHaveLength(4)
    expect(reset.explicitKeys).toEqual([])
  })

  it.each([
    'javascript:alert(1)',
    'http://example.com/',
    'file:///private/example',
    'data:text/html,example',
    'https://user:password@example.com/',
    'https://user@example.com/',
    'https://user%40name@example.com/',
    'https://exam\nple.com/',
    'not a URL',
  ])('rejects unsafe personal tool URL %s without changing settings', async (url) => {
    const { root, service } = await settingsFixture()
    const initial = await service.get()

    await expect(service.update({
      'workbench.home': { tools: [{ id: 'tool', title: 'Tool', url, group: 'Tools' }] },
    }, initial.revision)).rejects.toThrow()
    await expect(service.update({
      'workbench.home': { tools: [{ id: 'tool', title: 'Tool', url: 'https://example.com/', iconUrl: url, group: 'Tools' }] },
    }, initial.revision)).rejects.toThrow()
    expect((await service.get()).revision).toBe(initial.revision)
    expect(await readdir(root)).not.toContain('settings.json')
  })

  it('rejects duplicate personal tool and project identifiers after trimming', async () => {
    const tool = { id: 'docs', title: 'Docs', url: 'https://docs.example.com/', group: 'Tools' }

    expect(() => personalWorkbenchHomeSchema.parse({ tools: [tool, { ...tool, id: ' docs ' }] })).toThrow('Tool identifiers must be unique')
    expect(() => personalWorkbenchHomeSchema.parse({ tools: [], pinnedProjectIds: ['project-a', ' project-a '] })).toThrow('Pinned project identifiers must be unique')
  })

  it('persists known application launches while leaving legacy website tools compatible', async () => {
    const { root, service } = await settingsFixture()
    const initial = await service.get()
    const home: PersonalWorkbenchHome = {
      tools: [
        { id: 'website', title: 'Docs', url: 'https://example.com/', group: 'Tools' },
        { id: 'raycast', title: 'Project launcher', url: 'https://www.raycast.com/', group: 'Tools', launch: { application: 'raycast', commandUrl: 'raycast://extensions/example/repository-manager/list-repositories' } },
        { id: 'orca', title: 'Orca', url: 'https://www.onorca.dev/', group: 'Tools', launch: { application: 'orca' } },
      ],
    }
    await service.update({ 'workbench.home': home }, initial.revision)

    expect((await new CraftHubSettingsService(root).get()).settings['workbench.home']).toEqual(home)
  })

  it('bounds personal home inputs and rejects undeclared tool properties', () => {
    const tool = { id: 'docs', title: 'Docs', url: 'https://docs.example.com/', group: 'Tools' }

    expect(() => personalWorkbenchHomeSchema.parse({ tools: [{ ...tool, title: 'x'.repeat(129) }] })).toThrow()
    expect(() => personalWorkbenchHomeSchema.parse({ tools: [{ ...tool, description: 'x'.repeat(513) }] })).toThrow()
    expect(() => personalWorkbenchHomeSchema.parse({ tools: [{ ...tool, url: `https://example.com/${'x'.repeat(4096)}` }] })).toThrow()
    expect(() => personalWorkbenchHomeSchema.parse({ tools: Array.from({ length: 101 }, (_, index) => ({ ...tool, id: `tool-${index}` })) })).toThrow()
    expect(() => personalWorkbenchHomeSchema.parse({ tools: [], pinnedProjectIds: Array.from({ length: 201 }, (_, index) => `project-${index}`) })).toThrow()
    expect(() => personalWorkbenchHomeSchema.parse({ tools: [{ ...tool, command: 'open' }] })).toThrow()
    expect(() => personalWorkbenchHomeSchema.parse({ tools: [], workItems: { groupByList: true, density: 'tiny', showEmptyLists: false } })).toThrow()
    expect(() => personalWorkbenchHomeSchema.parse({ tools: [], workItems: { groupByList: true, density: 'compact', showEmptyLists: 'false' } })).toThrow()
  })

  it('keeps personal home settings local when exporting or importing portable settings', async () => {
    const { service } = await settingsFixture()
    const initial = await service.get()
    const home = { tools: [], pinnedProjectIds: ['local-project'] }
    await service.update({ 'workbench.home': home }, initial.revision)

    expect((await service.export('minimal')).settings).not.toHaveProperty('workbench.home')
    expect((await service.export('full')).settings).not.toHaveProperty('workbench.home')
    const document = await service.export('full')
    await expect(service.previewImport({ ...document, settings: { 'workbench.home': home } }, 'merge')).resolves.toMatchObject({
      changes: [],
      ignored: ['workbench.home'],
    })
  })

  it('validates and persists keyboard shortcut bindings', async () => {
    const { root, service } = await settingsFixture()
    const initial = await service.get()
    const shortcuts = {
      'workbench.showCommandPalette': 'Mod+Shift+P',
      'capability:project:build': 'Mod+B',
    }
    const updated = await service.update({ 'workbench.shortcuts': shortcuts }, initial.revision)

    expect(updated.settings['workbench.shortcuts']).toEqual(shortcuts)
    expect(JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'))['workbench.shortcuts']).toEqual(shortcuts)
    await expect(service.update({ 'workbench.shortcuts': { invalid: '' } }, updated.revision)).rejects.toThrow()
  })

  it('defaults to the standard sidebar composition without sharing mutable snapshots', async () => {
    const { service } = await settingsFixture()
    const snapshot = await service.get()

    expect(snapshot.settings['workbench.sidebar']).toEqual({ entries: [] })
    snapshot.settings['workbench.sidebar'].entries.push({ kind: 'separator', id: 'separator:changed' })
    expect((await service.get()).settings['workbench.sidebar']).toEqual({ entries: [] })
    expect(service.schema()).toMatchObject({
      properties: { 'workbench.sidebar': { additionalProperties: false, properties: { entries: { type: 'array' } } } },
    })
  })

  it('persists sidebar ordering, hidden items, and separators and resets them with null', async () => {
    const { root, service } = await settingsFixture()
    const initial = await service.get()
    const sidebar: WorkbenchSidebarSetting = {
      entries: [
        { kind: 'item', id: 'builtin:projects', visible: true },
        { kind: 'separator', id: 'separator:tools' },
        { kind: 'item', id: 'plugin:example:tools', visible: true },
        { kind: 'item', id: 'builtin:home', visible: false },
      ],
    }
    const updated = await service.update({ 'workbench.sidebar': sidebar }, initial.revision)

    expect(updated.explicitKeys).toEqual(['workbench.sidebar'])
    expect(updated.settings['workbench.sidebar']).toEqual(sidebar)
    expect(JSON.parse(await readFile(updated.path, 'utf8'))['workbench.sidebar']).toEqual(sidebar)
    const reloaded = await new CraftHubSettingsService(root).get()
    expect(reloaded.settings['workbench.sidebar']).toEqual(sidebar)
    expect(reloaded.revision).toBe(updated.revision)

    const reset = await service.update({ 'workbench.sidebar': null }, updated.revision)
    expect(reset.settings['workbench.sidebar']).toEqual({ entries: [] })
    expect(reset.explicitKeys).toEqual([])
    expect(JSON.parse(await readFile(reset.path, 'utf8'))).not.toHaveProperty('workbench.sidebar')
    expect((await new CraftHubSettingsService(root).get()).settings['workbench.sidebar']).toEqual({ entries: [] })
  })

  it('rejects duplicate sidebar identifiers after trimming', () => {
    expect(() => sidebarSettingSchema.parse({ entries: [
      { kind: 'separator', id: 'separator:tools' },
      { kind: 'separator', id: ' separator:tools ' },
    ] })).toThrow('Sidebar entry identifiers must be unique')
  })

  it('persists long plugin identifiers and 256 separators alongside newly discovered items', async () => {
    const { root, service } = await settingsFixture()
    const initial = await service.get()
    const pluginId = `plugin:${encodeURIComponent('@example/tools')}:${encodeURIComponent('工具'.repeat(256))}`
    const sidebar: WorkbenchSidebarSetting = { entries: [
      { kind: 'item', id: pluginId, visible: false },
      ...Array.from({ length: 256 }, (_, index) => ({ kind: 'separator' as const, id: `separator:${index}` })),
      { kind: 'item', id: 'builtin:home', visible: true },
    ] }
    const updated = await service.update({ 'workbench.sidebar': sidebar }, initial.revision)
    const withNewItem: WorkbenchSidebarSetting = { entries: [...sidebar.entries, { kind: 'item', id: 'plugin:discovered:tools', visible: true }] }
    const expanded = await service.update({ 'workbench.sidebar': withNewItem }, updated.revision)

    expect(pluginId.length).toBeGreaterThan(256)
    expect(expanded.settings['workbench.sidebar']).toEqual(withNewItem)
    expect(JSON.parse(await readFile(expanded.path, 'utf8'))['workbench.sidebar']).toEqual(withNewItem)
    expect((await new CraftHubSettingsService(root).get()).settings['workbench.sidebar']).toEqual(withNewItem)
    expect((await service.export('minimal')).settings['workbench.sidebar']).toEqual(withNewItem)
  })

  it.each([
    { entries: [{ kind: 'item', id: 'home' }] },
    { entries: [{ kind: 'item', id: 'home', visible: 'true' }] },
    { entries: [{ kind: 'separator', id: 'separator:group', visible: true }] },
    { entries: [{ kind: 'separator', id: 'separator:group', group: 'unknown' }] },
    { entries: [{ kind: 'separator', id: 'separator:group', group: null }] },
    { entries: [{ kind: 'item', id: 'home', visible: true, group: 'builtins' }] },
    { entries: [{ kind: 'unknown', id: 'home' }] },
    { entries: [{ kind: 'item', id: ' ', visible: true }] },
    { entries: [{ kind: 'separator', id: 'separator:bad\0id' }] },
    { entries: [{ kind: 'item', id: 'bad\0id', visible: true }] },
    { entries: [{ kind: 'separator', id: 'group' }] },
    { entries: [{ kind: 'item', id: ' separator:reserved ', visible: true }] },
    { entries: [{ kind: 'item', id: 'home', visible: true, command: 'open' }] },
    { entries: [], undeclared: true },
    { entries: Array.from({ length: 257 }, (_, index) => ({ kind: 'separator', id: `separator:${index}` })) },
    { entries: [
      { kind: 'item', id: 'home', visible: true },
      { kind: 'item', id: 'home', visible: false },
    ] },
  ])('rejects malformed sidebar setting %# without overwriting saved settings', async (sidebar) => {
    const { root, service } = await settingsFixture()
    const initial = await service.get()
    const updated = await service.update({ 'workbench.sidebar': { entries: [{ kind: 'item', id: 'home', visible: true }] } }, initial.revision)
    const saved = await readFile(join(root, 'settings.json'), 'utf8')

    await expect(service.update({ 'workbench.sidebar': sidebar }, updated.revision)).rejects.toThrow()
    expect((await service.get()).revision).toBe(updated.revision)
    expect(await readFile(join(root, 'settings.json'), 'utf8')).toBe(saved)
  })

  it('exports sidebar composition and restores it through portable imports', async () => {
    const { service } = await settingsFixture()
    const initial = await service.get()
    expect((await service.export('minimal')).settings).not.toHaveProperty('workbench.sidebar')
    expect((await service.export('full')).settings['workbench.sidebar']).toEqual({ entries: [] })
    const sidebar: WorkbenchSidebarSetting = { entries: [
      { kind: 'item', id: 'plugin:example:tools', visible: false },
      { kind: 'separator', id: 'separator:main' },
      { kind: 'item', id: 'builtin:home', visible: true },
    ] }
    await service.update({ 'workbench.sidebar': sidebar }, initial.revision)
    const minimal = await service.export('minimal')
    const full = await service.export('full')
    expect(minimal.settings['workbench.sidebar']).toEqual(sidebar)
    expect(full.settings['workbench.sidebar']).toEqual(sidebar)

    const { root, service: destination } = await settingsFixture()
    const destinationInitial = await destination.get()
    await expect(destination.previewImport(minimal, 'merge')).resolves.toMatchObject({
      changes: [{ key: 'workbench.sidebar', type: 'add', after: sidebar }],
      ignored: [],
    })
    const imported = await destination.import(minimal, 'merge', destinationInitial.revision)
    expect(imported.settings['workbench.sidebar']).toEqual(sidebar)
    expect((await new CraftHubSettingsService(root).get()).settings['workbench.sidebar']).toEqual(sidebar)

    const reset = await destination.import({ ...minimal, settings: {} }, 'replace', imported.revision)
    expect(reset.settings['workbench.sidebar']).toEqual({ entries: [] })
    expect(reset.explicitKeys).toEqual([])
    const invalidDocument = { ...minimal, settings: { 'workbench.sidebar': { entries: [{ kind: 'separator', id: 'separator:duplicate' }, { kind: 'separator', id: 'separator:duplicate' }] } } }
    await expect(destination.previewImport(invalidDocument, 'merge')).rejects.toThrow('Sidebar entry identifiers must be unique')
    await expect(destination.import(invalidDocument, 'merge', reset.revision)).rejects.toThrow('Sidebar entry identifiers must be unique')
    expect((await destination.get()).revision).toBe(reset.revision)
  })

  it('preserves explicit divider ownership through saving, reloading, exporting, and importing', async () => {
    const { root, service } = await settingsFixture()
    const initial = await service.get()
    const sidebar: WorkbenchSidebarSetting = { entries: [
      { kind: 'item', id: 'plugin:example:tools', visible: false },
      { kind: 'separator', id: 'separator:moved-builtins', group: 'builtins' },
      { kind: 'item', id: 'builtin:home', visible: true },
      { kind: 'separator', id: 'separator:moved-plugins', group: 'plugins' },
      { kind: 'separator', id: 'separator:legacy' },
      { kind: 'separator', id: 'separator:management', group: 'utilities' },
      { kind: 'item', id: 'builtin:settings', visible: true },
    ] }
    const updated = await service.update({ 'workbench.sidebar': sidebar }, initial.revision)

    expect(updated.settings['workbench.sidebar']).toEqual(sidebar)
    expect(JSON.parse(await readFile(updated.path, 'utf8'))['workbench.sidebar']).toEqual(sidebar)
    const reloaded = new CraftHubSettingsService(root)
    expect((await reloaded.get()).settings['workbench.sidebar']).toEqual(sidebar)
    const minimal = await reloaded.export('minimal')
    const full = await reloaded.export('full')
    expect(minimal.settings['workbench.sidebar']).toEqual(sidebar)
    expect(full.settings['workbench.sidebar']).toEqual(sidebar)

    const { root: destinationRoot, service: destination } = await settingsFixture()
    const destinationInitial = await destination.get()
    const imported = await destination.import(JSON.parse(JSON.stringify(minimal)), 'merge', destinationInitial.revision)
    expect(imported.settings['workbench.sidebar']).toEqual(sidebar)
    expect(JSON.parse(await readFile(imported.path, 'utf8'))['workbench.sidebar']).toEqual(sidebar)
    expect((await new CraftHubSettingsService(destinationRoot).get()).settings['workbench.sidebar']).toEqual(sidebar)
  })

  it('rejects invalid divider ownership during portable imports without changing saved settings', async () => {
    const { root, service } = await settingsFixture()
    const initial = await service.get()
    const updated = await service.update({ 'workbench.sidebar': { entries: [
      { kind: 'separator', id: 'separator:retained', group: 'builtins' },
      { kind: 'item', id: 'builtin:home', visible: true },
    ] } }, initial.revision)
    const saved = await readFile(join(root, 'settings.json'), 'utf8')
    const invalidDocument = {
      ...await service.export('minimal'),
      settings: { 'workbench.sidebar': { entries: [{ kind: 'separator', id: 'separator:invalid', group: 'unknown' }] } },
    }

    await expect(service.previewImport(invalidDocument, 'merge')).rejects.toThrow()
    await expect(service.import(invalidDocument, 'merge', updated.revision)).rejects.toThrow()
    expect((await service.get()).revision).toBe(updated.revision)
    expect(await readFile(join(root, 'settings.json'), 'utf8')).toBe(saved)
  })

  it('validates a shell-free custom editor with a path placeholder', async () => {
    const { service } = await settingsFixture()
    const initial = await service.get()
    const editor = { default: 'custom', custom: { name: 'Cursor', command: 'cursor', args: ['--reuse-window', '{path}'] } }
    const updated = await service.update({ 'workbench.editor': editor }, initial.revision)

    expect(updated.settings['workbench.editor']).toEqual(editor)
    await expect(service.update({ 'workbench.editor': { default: 'custom', custom: { name: 'Unsafe', command: 'sh', args: ['-c'] } } }, updated.revision)).rejects.toThrow('{path}')
  })

  it('accepts the additional built-in Cursor preference', async () => {
    const { service } = await settingsFixture()
    const snapshot = await service.get()
    const updated = await service.update({ 'workbench.editor': { default: 'cursor' } }, snapshot.revision)
    expect(updated.settings['workbench.editor']).toEqual({ default: 'cursor' })
  })

  it('persists a global local repositories root for folder picker defaults', async () => {
    const { root, service } = await settingsFixture()
    const initial = await service.get()
    const updated = await service.update({ 'workbench.repositoriesRoot': '/Users/example/repos' }, initial.revision)

    expect(updated.settings['workbench.repositoriesRoot']).toBe('/Users/example/repos')
    expect(JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'))['workbench.repositoriesRoot']).toBe('/Users/example/repos')
    await expect(service.update({ 'workbench.repositoriesRoot': 'bad\0path' }, updated.revision)).rejects.toThrow('NUL')
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
      formatVersion: 2,
      exportMode: 'minimal',
      applicationVersion: '1.2.3',
      settings: {},
    })
    expect(full.settings).toEqual({
      'workbench.codex': {},
      'workbench.editor': { default: 'vscode' },
      'workbench.locale': 'zh-CN',
      'workbench.sidebar': { entries: [] },
      'workbench.shortcuts': { 'workbench.showCommandPalette': 'Mod+K' },
      'workbench.theme': 'system',
    })
    await expect(service.previewImport({
      ...minimal,
      settings: { 'workbench.repositoriesRoot': '/private/repos', 'extensions.example.enabled': true },
    }, 'replace')).resolves.toMatchObject({
      ignored: ['extensions.example.enabled', 'workbench.repositoriesRoot'],
      warnings: [expect.stringContaining('not portable')],
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
    let changed = false
    service.onChanged((next) => {
      if (next.diagnostic)
        changed = true
    })

    try {
      await writeFile(join(root, 'settings.json'), '{ invalid json', 'utf8')
      await vi.waitFor(() => expect(changed).toBe(true), { timeout: 3_000 })

      expect(await service.get()).toMatchObject({
        diagnostic: expect.stringContaining('JSON'),
        settings: { 'workbench.locale': 'zh-CN' },
      })
      const invalid = await service.get()
      await expect(service.update({ 'workbench.locale': 'en' }, invalid.revision)).rejects.toThrow('was not overwritten')
      expect(await readFile(join(root, 'settings.json'), 'utf8')).toBe('{ invalid json')
    }
    finally {
      await service.close()
    }

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
    await expect(service.extensionValues()).resolves.toEqual({ 'extensions.example.option': 42 })

    await writeFile(join(root, 'settings.json'), JSON.stringify({ 'workbench.typo': true }))
    await expect(new CraftHubSettingsService(root).get()).resolves.toMatchObject({
      diagnostic: 'Unknown core setting: workbench.typo',
      explicitKeys: ['extensions.example.option'],
    })
  })
})

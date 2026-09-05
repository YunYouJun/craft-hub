import { describe, expect, it } from 'vitest'
import { collectWorkbenchDiagnostics } from '../src/diagnostics'

describe('workbench diagnostics', () => {
  it('normalizes, sorts, and deduplicates actionable host problems', () => {
    const snapshot = collectWorkbenchDiagnostics({
      hostPlugins: [{ pluginId: './broken-host.mjs', phase: 'load', message: 'Missing export' }],
      integrations: [{ integrationId: 'issues', pluginId: '@acme/issues', message: 'Provider is unavailable' }],
      marketplaceSources: [{
        id: 'remote',
        name: 'Remote catalog',
        kind: 'user',
        enabled: true,
        error: 'Refresh failed',
        catalog: { schemaVersion: 1, id: 'cached', name: 'Cached', plugins: [] },
      }],
      plugins: [{
        package: '@acme/broken',
        version: '1.0.0',
        sourceId: 'remote',
        installedAt: '2026-09-04T00:00:00.000Z',
        enabled: false,
        packagePath: '/plugins/broken',
        error: 'Manifest is incompatible',
        manifest: {
          schemaVersion: 1,
          craftHub: {},
          id: '@acme/broken',
          displayName: 'Broken plugin',
          permissions: [],
          permissionReasons: {},
          requiresPlugins: [],
          includesPlugins: [],
          projectFiles: [],
          contributes: {
            commands: [],
            commandPresets: [],
            commandTemplates: [],
            packageLinks: [],
            packageQuickActions: [],
            packageToolGroups: [],
            navigationPanels: [],
            workbenches: [],
            skills: [],
            projectTemplates: [],
            integrations: [],
          },
        },
      }],
      projects: {
        projects: [{ id: 'project', name: 'Example', path: '/example', trust: 'untrusted', addedAt: '2026-09-04T00:00:00.000Z' }],
        diagnostics: [{ projectId: 'project', source: 'project-config', targetPath: '.craft-hub/project.jsonc', path: '/unknown', message: 'Unknown key' }],
      },
      settings: {
        path: '/settings.json',
        revision: 'revision',
        explicitKeys: [],
        diagnostic: 'Invalid settings',
        settings: {
          'workbench.codex': {},
          'workbench.editor': { default: 'vscode' },
          'workbench.locale': 'en',
          'workbench.repositoriesRoot': '',
          'workbench.shortcuts': {},
          'workbench.theme': 'system',
        },
      },
      userConfig: {
        configDir: '/config',
        diagnostics: [
          { path: '/config/config.jsonc', message: 'Invalid JSONC' },
          { path: '/config/config.jsonc', message: 'Invalid JSONC' },
        ],
        files: [],
        format: 'jsonc',
      },
    }, '2026-09-04T10:00:00.000Z')

    expect(snapshot.checkedAt).toBe('2026-09-04T10:00:00.000Z')
    expect(snapshot.summary).toEqual({ errors: 6, warnings: 1 })
    expect(snapshot.diagnostics).toHaveLength(7)
    expect(snapshot.diagnostics.slice(0, 6).every(diagnostic => diagnostic.severity === 'error')).toBe(true)
    expect(snapshot.diagnostics.at(-1)).toMatchObject({
      kind: 'marketplace-source',
      severity: 'warning',
      target: { type: 'marketplace', sourceId: 'remote' },
    })
    expect(snapshot.diagnostics.find(diagnostic => diagnostic.kind === 'project-config')).toMatchObject({
      subject: 'Example',
      path: '.craft-hub/project.jsonc',
      target: { type: 'project', projectId: 'project' },
    })
  })
})

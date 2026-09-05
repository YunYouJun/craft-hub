import { describe, expect, it } from 'vitest'
import { pluginManifestV1Schema } from '../src/marketplace'
import { localizeWorkbench, workbenchContributionSchema } from '../src/workbench-contributions'

const packageName = '@acme/craft-hub-plugin-suite'
const childPackage = '@acme/craft-hub-plugin-issues'
const workbench = {
  id: 'engineering',
  title: { 'default': 'Engineering', 'zh-CN': '研发工作台' },
  description: { 'default': 'Daily engineering tools', 'zh-CN': '日常研发工具' },
  icon: 'builtin:briefcase',
  views: [
    { type: 'integration', plugin: childPackage, integration: 'issues', view: 'overview' },
    { type: 'navigation', plugin: packageName, panel: 'resources' },
  ],
} as const

function manifest(input: unknown = workbench) {
  return {
    schemaVersion: 1,
    id: packageName,
    displayName: 'Acme Suite',
    includesPlugins: [{ package: childPackage, version: '^1.0.0' }],
    requiresPlugins: [],
    projectFiles: [],
    permissions: [],
    contributes: {
      navigationPanels: [{
        id: 'resources',
        title: 'Resources',
        links: [{ id: 'handbook', title: 'Handbook', url: 'https://example.com/handbook' }],
      }],
      workbenches: [input],
    },
  }
}

describe('workbench contributions', () => {
  it('localizes a product workbench while preserving its ordered view references', () => {
    const parsed = workbenchContributionSchema.parse(workbench)

    expect(localizeWorkbench(parsed, 'zh-CN')).toEqual({
      id: 'engineering',
      title: '研发工作台',
      description: '日常研发工具',
      icon: 'builtin:briefcase',
      views: parsed.views,
    })
  })

  it('rejects duplicate views, unrelated plugins, and missing local targets', () => {
    expect(() => workbenchContributionSchema.parse({ ...workbench, views: [workbench.views[0], workbench.views[0]] })).toThrow(/must be unique/)
    expect(() => pluginManifestV1Schema.parse(manifest({
      ...workbench,
      views: [{ type: 'integration', plugin: '@other/craft-hub-plugin-issues', integration: 'issues', view: 'overview' }],
    }))).toThrow(/included or required plugins/)
    expect(() => pluginManifestV1Schema.parse(manifest({
      ...workbench,
      views: [{ type: 'navigation', plugin: packageName, panel: 'missing' }],
    }))).toThrow(/unknown local navigation view/)
  })

  it('accepts references to local views and declared child plugins', () => {
    expect(pluginManifestV1Schema.parse(manifest()).contributes.workbenches).toHaveLength(1)
  })
})

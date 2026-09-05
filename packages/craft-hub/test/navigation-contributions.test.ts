import { describe, expect, it } from 'vitest'
import { localizeNavigationPanel, navigationPanelContributionSchema } from '../src/navigation-contributions'

const panel = {
  id: 'developer-resources',
  title: { 'default': 'Developer resources', 'zh-CN': '研发资源' },
  description: { 'default': 'Shared tools', 'zh-CN': '共享工具' },
  icon: 'builtin:code',
  links: [{
    id: 'handbook',
    title: { 'default': 'Handbook', 'zh-CN': '研发手册' },
    description: { 'default': 'Standards and workflows', 'zh-CN': '规范与流程' },
    url: 'https://example.com/engineering',
    icon: 'builtin:docs',
    keywords: ['standards', '规范'],
  }],
}

describe('navigation contributions', () => {
  it('validates and localizes a safe declarative panel', () => {
    const parsed = navigationPanelContributionSchema.parse(panel)
    expect(localizeNavigationPanel(parsed, 'zh-CN')).toMatchObject({
      title: '研发资源',
      description: '共享工具',
      links: [{ title: '研发手册', description: '规范与流程', url: 'https://example.com/engineering' }],
    })
  })

  it('rejects insecure destinations, credentials, and duplicate link ids', () => {
    expect(() => navigationPanelContributionSchema.parse({ ...panel, links: [{ ...panel.links[0], url: 'http://example.com' }] })).toThrow(/HTTPS/)
    expect(() => navigationPanelContributionSchema.parse({ ...panel, links: [{ ...panel.links[0], url: 'https://user:secret@example.com' }] })).toThrow(/credentials/)
    expect(() => navigationPanelContributionSchema.parse({ ...panel, links: [panel.links[0], panel.links[0]] })).toThrow(/must be unique/)
  })
})

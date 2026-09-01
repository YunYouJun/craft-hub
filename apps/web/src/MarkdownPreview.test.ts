// @vitest-environment happy-dom
/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MarkdownPreview from './MarkdownPreview.vue'

describe('markdown preview', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'craftHubDesktop')
  })

  it('sanitizes active content and resolves relative images inside the project API', () => {
    const wrapper = mount(MarkdownPreview, {
      props: {
        content: '# Guide\n\n<script>alert(1)</script>\n\n![Preview](./assets/preview.png)\n\n[Unsafe](javascript:alert(1))',
        projectId: 'project/id',
        readmePath: 'docs/README.md',
      },
    })

    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.get('img').attributes('src')).toBe('/api/projects/project%2Fid/overview-asset?path=docs%2Fassets%2Fpreview.png')
    expect(wrapper.get('a').attributes('href')).toBe('#')
    expect(wrapper.html()).not.toContain('javascript:')
  })

  it('opens relative document links through the scoped desktop bridge', async () => {
    const openProjectEvidenceInEditor = vi.fn(async () => {})
    window.craftHubDesktop = { openProjectEvidenceInEditor }
    const wrapper = mount(MarkdownPreview, {
      props: { content: '[Configuration](./configuration.md)', projectId: 'project', readmePath: 'docs/README.md' },
    })

    await wrapper.get('a').trigger('click')
    expect(openProjectEvidenceInEditor).toHaveBeenCalledWith('project', 'docs/configuration.md')
  })

  it('resolves plugin assets and emits contained Markdown navigation without a project bridge', async () => {
    const assetUrl = vi.fn((path: string) => `/api/plugins/document-asset?path=${encodeURIComponent(path)}`)
    const wrapper = mount(MarkdownPreview, {
      props: { content: '![Preview](./assets/preview.png)\n\n[Guide](./guide.md)', readmePath: 'docs/README.md', assetUrl },
    })

    expect(wrapper.findAll('img')[0]!.attributes('src')).toBe('/api/plugins/document-asset?path=docs%2Fassets%2Fpreview.png')
    expect(wrapper.findAll('img')[0]!.attributes('referrerpolicy')).toBe('no-referrer')
    await wrapper.get('a').trigger('click')
    expect(wrapper.emitted('navigateDocument')).toEqual([['docs/guide.md']])
  })
})

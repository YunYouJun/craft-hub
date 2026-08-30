// @vitest-environment happy-dom
/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SkillContentPreview from './SkillContentPreview.vue'

describe('skill content preview', () => {
  it('renders Markdown source with escaped Shiki syntax highlighting', async () => {
    const wrapper = mount(SkillContentPreview, {
      props: { content: '# Release\n\n```bash\npnpm release:patch\n```\n<script>alert(1)</script>' },
    })

    await vi.waitFor(() => expect(wrapper.find('.shiki').exists()).toBe(true))
    expect(wrapper.html()).toContain('--shiki-light')
    expect(wrapper.get('.shiki').attributes('style')).not.toMatch(/(?:^|;)color:/)
    expect(wrapper.html()).not.toContain('<script>alert(1)</script>')
    expect(wrapper.text()).toContain('pnpm release:patch')
  })
})

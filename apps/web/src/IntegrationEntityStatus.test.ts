// @vitest-environment happy-dom
import lucide from '@iconify-json/lucide/icons.json'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { expect, it } from 'vitest'
import IntegrationEntityStatus from './IntegrationEntityStatus.vue'

it('uses available icons for every entity status, including completed and archived items', () => {
  for (const statusCategory of ['open', 'planning', 'active', 'testing', 'review', 'releasing', 'resolved', 'done', 'closed', 'cancelled', 'unknown'] as const) {
    for (const archived of [false, true]) {
      const wrapper = mount(IntegrationEntityStatus, { global: { plugins: [createPinia()] }, props: { entity: {
        id: 'item',
        title: 'Example item',
        status: statusCategory,
        statusCategory,
        archived,
      } } })
      const icon = wrapper.get('.app-icon').classes().find(name => name.startsWith('i-lucide-'))!
      const name = icon.slice('i-lucide-'.length)
      expect(name in lucide.icons || name in lucide.aliases, `${statusCategory} (archived=${archived}): ${icon} must exist`).toBe(true)
      wrapper.unmount()
    }
  }
})

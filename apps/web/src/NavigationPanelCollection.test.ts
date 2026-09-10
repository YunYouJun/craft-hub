// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import NavigationPanelCollection from './NavigationPanelCollection.vue'

it('opens host routes in the current workbench while retaining external link behavior', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', name: 'home', component: {} }, { path: '/subscriptions', name: 'subscriptions', component: {} }] })
  await router.push('/')
  const wrapper = mount(NavigationPanelCollection, { global: { plugins: [router] }, props: { panels: [{ id: 'sources', pluginId: 'example', pluginName: 'Sources', pluginVersion: '1', title: 'Sources', links: [{ id: 'internal', title: 'Manage', url: `${window.location.origin}/subscriptions`, keywords: [] }, { id: 'external', title: 'Docs', url: 'https://example.com/docs', keywords: [] }] }] } })
  const links = wrapper.findAll('a')
  expect(links[0]!.attributes('target')).toBeUndefined()
  expect(links[1]!.attributes('target')).toBe('_blank')
  await links[0]!.trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.name).toBe('subscriptions')
  wrapper.unmount()
})

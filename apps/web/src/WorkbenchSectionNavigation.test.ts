// @vitest-environment happy-dom

import type { WorkbenchNavigationGroup } from './workbench-navigation'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { createWorkbenchRouter } from './router'
import WorkbenchSectionNavigation from './WorkbenchSectionNavigation.vue'

async function mountNavigation(path: string, groups: WorkbenchNavigationGroup[]) {
  const router = createWorkbenchRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const wrapper = mount(WorkbenchSectionNavigation, {
    props: { title: 'Projects', icon: 'builtin:folder', groups },
    global: { plugins: [router] },
  })
  return { router, wrapper }
}

const projectGroups: WorkbenchNavigationGroup[] = [{ entries: [
  { key: 'projects', title: 'Projects and workspaces', icon: 'builtin:folder', to: '/' },
  { key: 'sources', title: 'Workspace sources', icon: 'builtin:cloud', to: '/subscriptions', match: 'prefix' },
] }]

describe('workbench section navigation', () => {
  it.each(['/subscriptions', '/subscriptions/discover', '/subscriptions/new', '/subscriptions/preview', '/subscriptions/example'])('keeps workspace sources selected on %s', async (path) => {
    const { wrapper } = await mountNavigation(path, projectGroups)
    const current = wrapper.get('[aria-current="page"]')
    expect(current.text()).toBe('Workspace sources')
    expect(current.attributes('href')).toBe('/subscriptions')
    expect(wrapper.findAll('[aria-current="page"]')).toHaveLength(1)
    expect(wrapper.get('.section-navigation-header strong').text()).toBe('Projects')
    wrapper.unmount()
  })

  it('uses real router navigation when switching between projects and configuration sources', async () => {
    const { router, wrapper } = await mountNavigation('/subscriptions/new', projectGroups)
    await wrapper.get('a[href="/"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('workbench')
    expect(wrapper.get('[aria-current="page"]').text()).toBe('Projects and workspaces')

    await wrapper.get('a[href="/subscriptions"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('subscriptions')
    expect(wrapper.get('[aria-current="page"]').text()).toBe('Workspace sources')
    wrapper.unmount()
  })

  it.each([
    ['', 'Configuration'],
    ['?scope=global', 'Configuration'],
    ['?scope=project', 'Project configuration'],
  ])('matches integration scope %s without selecting another scope', async (query, title) => {
    const { wrapper } = await mountNavigation(`/integrations/acme/configuration${query}`, [{ entries: [
      { key: 'default', title: 'Configuration', to: '/integrations/acme/configuration' },
      { key: 'project', title: 'Project configuration', to: '/integrations/acme/configuration?scope=project' },
    ] }])
    expect(wrapper.get('[aria-current="page"]').text()).toBe(title)
    expect(wrapper.findAll('[aria-current="page"]')).toHaveLength(1)
    wrapper.unmount()
  })

  it('respects explicit query scopes and compares query parameters independent of order', async () => {
    const { router, wrapper } = await mountNavigation('/integrations/acme/configuration?mode=details&scope=global', [{ entries: [
      { key: 'global', title: 'Global configuration', to: '/integrations/acme/configuration?scope=global&mode=details' },
      { key: 'project', title: 'Project configuration', to: '/integrations/acme/configuration?scope=project&mode=details' },
    ] }])
    expect(wrapper.get('[aria-current="page"]').text()).toBe('Global configuration')
    expect(wrapper.findAll('[aria-current="page"]')).toHaveLength(1)
    await router.push('/integrations/acme/configuration')
    await flushPromises()
    expect(wrapper.find('[aria-current="page"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('switches between local detection and contributed configuration through the environment section', async () => {
    const { router, wrapper } = await mountNavigation('/environment', [{ title: 'Development environment', entries: [
      { key: 'local', title: 'Local detection', icon: 'builtin:terminal', to: '/environment' },
      { key: 'configuration', title: 'Configuration', icon: 'builtin:settings', to: '/integrations/acme/configuration' },
    ] }])
    expect(wrapper.get('[aria-current="page"]').text()).toBe('Local detection')
    await wrapper.get('a[href="/integrations/acme/configuration"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('integration')
    expect(router.currentRoute.value.params).toEqual({ integrationId: 'acme', viewId: 'configuration' })
    expect(wrapper.get('[aria-current="page"]').text()).toBe('Configuration')
    wrapper.unmount()
  })
})

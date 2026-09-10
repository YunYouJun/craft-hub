// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import ConfigurationSubscriptions from './ConfigurationSubscriptions.vue'
import { useI18n } from './i18n'
import { createWorkbenchRouter } from './router'

afterEach(() => vi.unstubAllGlobals())
it('adds, edits and deletes configuration sources without implicitly importing workspaces', async () => {
  useI18n().setLocale('en')
  const source = { id: '123', name: 'Team', sourceRevision: 'revision', url: 'https://git.example.com/group/repo.git', repository: 'group/repo', branch: 'main', directory: '.craft-hub' }
  let sources: typeof source[] = []
  const fetcher = vi.fn(async (path: string, options?: RequestInit) => {
    if (path === '/api/workspace-catalogs')
      return new Response('', { status: 404 })
    if (options?.method === 'POST')
      sources = [source]
    if (options?.method === 'PATCH')
      sources = [{ ...source, name: 'Renamed' }]
    if (options?.method === 'DELETE')
      sources = []
    return Response.json({ connected: true, provider: 'Git', subscriptions: sources })
  })
  vi.stubGlobal('fetch', fetcher)
  const router = createWorkbenchRouter(createMemoryHistory())
  await router.push('/subscriptions/new')
  const wrapper = mount(ConfigurationSubscriptions, { global: { plugins: [createPinia(), router] } })
  await flushPromises()
  await wrapper.get('#source-name').setValue('Team')
  await wrapper.get('#subscription-url').setValue('https://git.example.com/group/repo/tree/main/.craft-hub')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(wrapper.text()).toContain('Team')
  await router.push('/subscriptions/123?panel=settings')
  await flushPromises()
  await wrapper.get('#source-name').setValue('Renamed')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(fetcher.mock.calls.some(([path, options]) => path === '/api/config-subscriptions/123' && options?.method === 'PATCH' && JSON.parse(String(options.body)).expectedSourceRevision === 'revision')).toBe(true)
  await router.push('/subscriptions/123')
  await flushPromises()
  await wrapper.findAll('button').find(button => ['Delete source', '删除源'].includes(button.text()))!.trigger('click')
  await flushPromises()
  expect(wrapper.findAll('.subscription-item')).toHaveLength(0)
  expect(fetcher.mock.calls.some(([path]) => path.endsWith('/apply'))).toBe(false)
  wrapper.unmount()
})

it('restores detail settings and list filters from URLs without reading a remote repository', async () => {
  useI18n().setLocale('en')
  const source = { id: '123', name: 'Team', url: 'https://git.example.com/group/repo.git', repository: 'group/repo', branch: 'main', directory: '.craft-hub' }
  const fetcher = vi.fn(async () => Response.json({ connected: true, canConnect: false, provider: 'Git', subscriptions: [source] }))
  vi.stubGlobal('fetch', fetcher)
  const router = createWorkbenchRouter(createMemoryHistory())
  await router.push('/subscriptions/123?panel=settings&q=Team')
  const wrapper = mount(ConfigurationSubscriptions, { global: { plugins: [createPinia(), router] } })
  await flushPromises()
  expect(wrapper.get<HTMLInputElement>('#source-name').element.value).toBe('Team')
  expect(wrapper.get('.ui-breadcrumb [aria-current=page]').text()).toMatch(/Subscription settings|订阅设置/)
  await wrapper.get('.ui-breadcrumb a[href="/subscriptions?q=Team"]').trigger('click')
  await flushPromises()
  expect(wrapper.get<HTMLInputElement>('#source-search').element.value).toBe('Team')
  expect(wrapper.find('#source-name').exists()).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(1)
  await router.push('/subscriptions/missing')
  await flushPromises()
  expect(wrapper.get('[role=alert]').text()).toMatch(/not found|不存在/)
  expect(wrapper.find('form').exists()).toBe(false)
  wrapper.unmount()
})

it('defaults an empty account to discovery and restores preview selection from its URL', async () => {
  useI18n().setLocale('en')
  const url = 'https://git.example.com/group/repo/tree/main/craft-hub'
  const fetcher = vi.fn(async (path: string) => {
    if (path === '/api/workspace-catalogs')
      return Response.json([])
    if (path.endsWith('/preview'))
      return Response.json({ revision: 'one', subscription: { repository: 'group/repo', branch: 'main', directory: 'craft-hub' }, workspaces: [{ id: 'dev', name: 'Development', members: [] }] })
    return Response.json({ connected: true, canConnect: false, provider: 'Git', subscriptions: [] })
  })
  vi.stubGlobal('fetch', fetcher)
  const router = createWorkbenchRouter(createMemoryHistory())
  await router.push('/subscriptions')
  const wrapper = mount(ConfigurationSubscriptions, { global: { plugins: [createPinia(), router] } })
  await flushPromises()
  expect(router.currentRoute.value.name).toBe('subscriptions-discover')
  expect(wrapper.find('#source-name').exists()).toBe(false)
  await router.push({ path: '/subscriptions/preview', query: { url } })
  await flushPromises()
  expect(wrapper.get('input[type=checkbox]').element).toHaveProperty('checked', true)
  expect(wrapper.text()).toContain('Development')
  await router.push('/subscriptions')
  await flushPromises()
  expect(wrapper.find('input[type=checkbox]').exists()).toBe(false)
  expect(fetcher.mock.calls.some(([path]) => path.endsWith('/apply'))).toBe(false)
  wrapper.unmount()
})

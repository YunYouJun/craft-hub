// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { useI18n } from './i18n'
import { createWorkbenchRouter } from './router'
import WorkspaceSourceCatalog from './WorkspaceSourceCatalog.vue'

const entry = { id: 'dev', name: 'Development', publisher: 'Maintainer', configurationUrl: 'https://git.example.com/profile/config' }
afterEach(() => vi.unstubAllGlobals())

it('selects the exact source from independent catalogs without importing it', async () => {
  useI18n().setLocale('en')
  const fetch = vi.fn(async () => Response.json([
    { schemaVersion: 1, id: 'one', name: 'First market', entries: [entry] },
    { schemaVersion: 1, id: 'two', name: 'Second market', entries: [{ ...entry, configurationUrl: 'https://git.example.com/other/config' }] },
  ]))
  vi.stubGlobal('fetch', fetch)
  const router = createWorkbenchRouter(createMemoryHistory())
  await router.push('/subscriptions/discover')
  const wrapper = mount(WorkspaceSourceCatalog, { global: { plugins: [router] } })
  await flushPromises()
  expect(wrapper.text()).toContain('First market')
  expect(wrapper.text()).toContain('Second market')
  await wrapper.findAll('article button')[1]!.trigger('click')
  expect(wrapper.emitted('select')).toEqual([['https://git.example.com/other/config']])
  await wrapper.get('select').setValue('two')
  await flushPromises()
  expect(wrapper.findAll('article')).toHaveLength(1)
  expect(router.currentRoute.value.query.market).toBe('two')
  expect(fetch).toHaveBeenCalledTimes(1)
  await wrapper.setProps({ sources: [{ url: 'https://git.example.com/other/config/', applied: false }] })
  expect(wrapper.get('.source-status').text()).toBe('Saved')
  await wrapper.setProps({ sources: [{ url: 'https://git.example.com/other/config', applied: true }] })
  expect(wrapper.get('.source-status').text()).toBe('Subscribed')
  expect(wrapper.get('article button').text()).toBe('Preview updates')
  await wrapper.setProps({ disabled: true })
  expect(wrapper.get('article button').attributes('disabled')).toBeDefined()
  wrapper.unmount()
})

it('recovers from a catalog failure and shows an honest empty state', async () => {
  useI18n().setLocale('en')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(Response.json([])))
  const router = createWorkbenchRouter(createMemoryHistory())
  await router.push('/subscriptions/discover')
  const wrapper = mount(WorkspaceSourceCatalog, { global: { plugins: [router] } })
  await flushPromises()
  expect(wrapper.get('[role=alert]').text()).toContain('unavailable')
  await wrapper.get('header button').trigger('click')
  await flushPromises()
  expect(wrapper.find('[role=alert]').exists()).toBe(false)
  expect(wrapper.text()).toContain('No published workspace sources')
  wrapper.unmount()
})

it('offers one-click Team joining and changes to update preview after joining', async () => {
  useI18n().setLocale('en')
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([{ schemaVersion: 1, id: 'teams', name: 'Teams', entries: [{ ...entry, team: true }] }])))
  const router = createWorkbenchRouter(createMemoryHistory())
  await router.push('/subscriptions/discover')
  const wrapper = mount(WorkspaceSourceCatalog, { global: { plugins: [router] } })
  await flushPromises()
  expect(wrapper.get('article button').text()).toBe('Join Team')
  await wrapper.get('article button').trigger('click')
  expect(wrapper.emitted('join')).toEqual([[entry.configurationUrl]])
  expect(wrapper.emitted('select')).toBeUndefined()
  await wrapper.setProps({ sources: [{ url: entry.configurationUrl, applied: true }] })
  expect(wrapper.get('article button').text()).toBe('Preview updates')
  wrapper.unmount()
})

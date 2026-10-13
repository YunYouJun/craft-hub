// @vitest-environment happy-dom
import type { FocusEntry } from './today-focus'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { useI18n } from './i18n'
import TodayFocus from './TodayFocus.vue'

const entries: FocusEntry[] = Array.from({ length: 5 }, (_, index) => ({ source: { key: 'tasks', integrationId: 'tasks', actionId: 'list', input: {}, viewId: 'tasks', title: 'Tasks' }, item: { id: `${index}`, title: `Task ${index}` } }))
afterEach(() => vi.restoreAllMocks())

it('summarizes all sources in three focus rows and refreshes the ranked preview', async () => {
  useI18n().setLocale('en')
  const wrapper = mount(TodayFocus, { props: { entries, coverage: '2/2 sources', loading: false, wide: true } })
  await flushPromises()
  expect(wrapper.findAll('.focus-list li')).toHaveLength(3)
  expect(wrapper.get('.focus-context').text()).toContain('5 tasks')
  expect(wrapper.get('.focus-context').text()).toContain('2/2 sources')
  expect(wrapper.get('.focus-item').attributes('open')).toBeUndefined()
  await wrapper.get('.focus-detail button').trigger('click')
  expect(wrapper.emitted('handoff')![0]![0]).toMatchObject({ item: { title: 'Task 0' } })
  await wrapper.get('[aria-label="Refresh today’s focus"]').trigger('click')
  expect(wrapper.emitted('refresh')).toHaveLength(1)
  await wrapper.setProps({ entries: entries.slice(3) })
  expect(wrapper.findAll('.focus-list li')).toHaveLength(2)
  expect(wrapper.get('.focus-list').text()).not.toContain('Task 0')
  wrapper.unmount()
})

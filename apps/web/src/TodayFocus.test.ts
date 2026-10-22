// @vitest-environment happy-dom
import type { FocusEntry } from './today-focus'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
import TodayFocus from './TodayFocus.vue'

const entries: FocusEntry[] = Array.from({ length: 5 }, (_, index) => ({ source: { key: 'tasks', integrationId: 'tasks', actionId: 'list', input: {}, viewId: 'tasks', title: 'Tasks' }, item: { id: `${index}`, title: `Task ${index}` } }))
afterEach(() => vi.restoreAllMocks())
it('keeps AI recommendations compact, reveals the rest on demand and clears stale analysis after refresh', async () => {
  useI18n().setLocale('en')
  vi.spyOn(api, 'workAssistantStatus').mockResolvedValue({ available: true })
  vi.spyOn(api, 'analyzeFocus').mockImplementation(async input => ({ summary: 'Prioritize the release.', items: input.candidates.map(item => ({ key: item.key, reason: 'Release dependency', nextStep: 'Review the change' })) }))
  const wrapper = mount(TodayFocus, { props: { entries, coverage: '1/1 sources', loading: false } })
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'AI analysis')!.trigger('click')
  await flushPromises()
  expect(wrapper.findAll('.focus-list li')).toHaveLength(3)
  expect(wrapper.find('.focus-context').attributes('open')).toBeUndefined()
  expect(wrapper.find('.focus-item').attributes('open')).toBeUndefined()
  expect(wrapper.find('.focus-detail').text()).toContain('Review the change')
  await wrapper.find('.focus-more').trigger('click')
  expect(wrapper.findAll('.focus-list li')).toHaveLength(5)
  await wrapper.setProps({ entries: entries.slice(0, 2) })
  expect(wrapper.findAll('.focus-list li')).toHaveLength(2)
  expect(wrapper.find('.focus-more').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('Release dependency')
  wrapper.unmount()
})

it('summarizes all sources in three focus rows and refreshes the ranked preview', async () => {
  useI18n().setLocale('en')
  vi.spyOn(api, 'workAssistantStatus').mockResolvedValue({ available: false })
  const wrapper = mount(TodayFocus, { props: { entries, coverage: '2/2 sources', loading: false, wide: true } })
  await flushPromises()
  expect(wrapper.findAll('.focus-list li')).toHaveLength(3)
  expect(wrapper.get('.focus-context').text()).toContain('5 tasks')
  expect(wrapper.get('.focus-context').text()).toContain('2/2 sources')
  expect(wrapper.get('.focus-item').attributes('open')).toBeUndefined()
  await wrapper.findAll('.focus-heading button').find(button => button.text() === 'Quick capture')!.trigger('click')
  expect(wrapper.emitted('capture')).toHaveLength(1)
  await wrapper.get('.focus-detail button').trigger('click')
  expect(wrapper.emitted('handoff')![0]![0]).toMatchObject({ item: { title: 'Task 0' } })
  await wrapper.get('[aria-label="Refresh today’s focus"]').trigger('click')
  expect(wrapper.emitted('refresh')).toHaveLength(1)
  await wrapper.setProps({ entries: entries.slice(3) })
  expect(wrapper.findAll('.focus-list li')).toHaveLength(2)
  expect(wrapper.get('.focus-list').text()).not.toContain('Task 0')
  wrapper.unmount()
})

it('analyzes the loaded preview while other sources refresh in the background', async () => {
  useI18n().setLocale('en')
  vi.spyOn(api, 'workAssistantStatus').mockResolvedValue({ available: true })
  const analyze = vi.spyOn(api, 'analyzeFocus').mockImplementation(async input => ({ summary: 'Use the loaded preview.', items: input.candidates.map(item => ({ key: item.key, reason: 'Loaded preview recommendation', nextStep: 'Review the task' })) }))
  const wrapper = mount(TodayFocus, { props: { entries, coverage: '1/2 sources', loading: true } })
  await flushPromises()
  expect(wrapper.get('[role="status"]').text()).toBe('Updating sources…')
  expect(wrapper.findAll('.focus-list li')).toHaveLength(3)
  const button = wrapper.findAll('button').find(button => button.text() === 'AI analysis')!
  expect(button.attributes('disabled')).toBeUndefined()
  await button.trigger('click')
  await flushPromises()
  expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ candidates: expect.arrayContaining([expect.objectContaining({ title: 'Task 0' })]) }))
  expect(wrapper.get('.focus-detail').text()).toContain('Loaded preview recommendation')
  expect(wrapper.get('[role="status"]').text()).toBe('Updating sources…')
  wrapper.unmount()
})

it('allows refreshing the preview while a source request is still in progress', async () => {
  useI18n().setLocale('en')
  vi.spyOn(api, 'workAssistantStatus').mockResolvedValue({ available: false })
  const wrapper = mount(TodayFocus, { props: { entries, coverage: '1/2 sources', loading: true } })
  await flushPromises()
  const button = wrapper.get('[aria-label="Refresh today’s focus"]')
  expect(button.attributes('disabled')).toBeUndefined()
  await button.trigger('click')
  expect(wrapper.emitted('refresh')).toHaveLength(1)
  wrapper.unmount()
})

it('keeps analysis disabled until the first work items arrive', async () => {
  useI18n().setLocale('en')
  vi.spyOn(api, 'workAssistantStatus').mockResolvedValue({ available: true })
  const analyze = vi.spyOn(api, 'analyzeFocus')
  const wrapper = mount(TodayFocus, { props: { entries: [], coverage: '0/2 sources', loading: true } })
  await flushPromises()
  const button = wrapper.findAll('button').find(button => button.text() === 'AI analysis')!
  expect(button.attributes('disabled')).toBeDefined()
  await button.trigger('click')
  expect(analyze).not.toHaveBeenCalled()
  expect(wrapper.find('.focus-skeleton').exists()).toBe(true)
  expect(wrapper.find('.focus-list').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('Updating sources…')
  wrapper.unmount()
})

it('discards an analysis when another source changes the preview before it completes', async () => {
  useI18n().setLocale('en')
  vi.spyOn(api, 'workAssistantStatus').mockResolvedValue({ available: true })
  let resolveAnalysis!: () => void
  const analyze = vi.spyOn(api, 'analyzeFocus').mockImplementation(input => new Promise((resolve) => {
    resolveAnalysis = () => resolve({ summary: 'Outdated summary', items: input.candidates.map(item => ({ key: item.key, reason: 'Outdated recommendation', nextStep: 'Outdated step' })) })
  }))
  const wrapper = mount(TodayFocus, { props: { entries, coverage: '1/2 sources', loading: true } })
  await flushPromises()
  const button = wrapper.findAll('button').find(button => button.text() === 'AI analysis')!
  await button.trigger('click')
  expect(button.attributes('disabled')).toBeDefined()
  await button.trigger('click')
  expect(analyze).toHaveBeenCalledTimes(1)
  await wrapper.setProps({ entries: entries.slice(1), coverage: '2/2 sources' })
  resolveAnalysis()
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toBe('Work items changed. Analyze again.')
  expect(wrapper.get('.focus-list').text()).not.toContain('Task 0')
  expect(wrapper.text()).not.toContain('Outdated')
  expect(button.attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})

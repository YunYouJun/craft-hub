// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { VueWrapper } from '@vue/test-utils'
import type { IntegrationEntity, IntegrationEntityPage, PersonalWorkbenchHome, SettingsSnapshot } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from './api'
import { FormSelect } from './components/ui/select'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'
import WorkCollectionBrowser from './WorkCollectionBrowser.vue'

function task(id: string, containerId: string, extra: Partial<IntegrationEntity> = {}): IntegrationEntity {
  return { id, title: `Task ${id}`, sourceRef: { providerId: 'tasks', instanceId: 'tasks', accountId: 'me', containerId, kind: 'task', itemId: id }, personalMembership: { accountId: 'me', relation: 'owned' }, ...extra }
}
function snapshot(workItems?: PersonalWorkbenchHome['workItems']): SettingsSnapshot {
  return { revision: 'initial', path: '/settings.json', explicitKeys: [], settings: {
    'workbench.codex': {},
    'workbench.editor': { default: 'vscode' },
    'workbench.home': { tools: [], pinnedProjectIds: ['project'], ...(workItems ? { workItems } : {}) },
    'workbench.locale': 'en',
    'workbench.theme': 'system',
    'workbench.repositoriesRoot': '',
    'workbench.sidebar': { entries: [] },
    'workbench.shortcuts': {},
  } }
}
function fixture(): IntegrationEntityPage {
  return {
    currentUser: { id: 'me' },
    coverage: 'complete',
    collections: [{ id: 'work', title: 'Work' }, { id: 'personal', title: 'Personal' }, { id: 'empty', title: 'Empty' }],
    items: [task('1', 'work', { important: true }), task('2', 'work', { dueDate: { dateTime: '2000-01-01T00:00:00Z', timeZone: 'UTC' } }), task('3', 'work'), task('4', 'personal'), task('done', 'work', { statusCategory: 'done', important: true }), task('foreign', 'work', { personalMembership: { accountId: 'other', relation: 'owned' } })],
  }
}
let wrapper: VueWrapper | undefined
beforeEach(() => {
  setActivePinia(createPinia())
  useI18n().setLocale('en')
  useWorkbenchStore().settings = snapshot()
  vi.spyOn(api, 'updateSettings').mockImplementation(async settings => ({ ...snapshot((settings['workbench.home'] as PersonalWorkbenchHome).workItems), revision: 'saved' }))
  vi.spyOn(api, 'invokeIntegrationAction').mockRejectedValue(new Error('Display controls must not invoke remote actions'))
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  expect(api.invokeIntegrationAction).not.toHaveBeenCalled()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
function open(page = fixture()): VueWrapper {
  wrapper = mount(WorkCollectionBrowser, { props: { page, compact: true }, slots: { item: '<div class="task">{{ params.item.title }}</div>' } })
  return wrapper
}
function button(text: string) {
  return wrapper!.findAll('button').find(button => button.text() === text)!
}
function choice(title: string) {
  return wrapper!.get(`.collection-choice[title="${title}"]`)
}

it('combines native lists, smart categories and search while excluding completed and foreign tasks', async () => {
  open()
  expect(wrapper!.get('.smart-filter.all').text()).toBe('All4')
  expect(wrapper!.get('.smart-filter.important').text()).toBe('Important1')
  expect(wrapper!.get('.smart-filter.overdue').text()).toBe('Overdue1')
  expect(wrapper!.findAll('.collection-task-group')).toHaveLength(2)
  expect(wrapper!.findAll('.task')).toHaveLength(3)
  await wrapper!.get('.smart-filter.important').trigger('click')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task 1'])
  await choice('Personal').trigger('click')
  expect(wrapper!.findAll('.task')).toHaveLength(0)
  await button('Clear filters').trigger('click')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task 4'])
  await wrapper!.get('.collection-choice').trigger('click')
  await wrapper!.get('input').setValue('Personal')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task 4'])
  await wrapper!.get('input').setValue('Task 2')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task 2'])
  await wrapper!.get('input').setValue('')
  await wrapper!.get('.smart-filter.overdue').trigger('click')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task 2'])
})

function scheduledFixture(): IntegrationEntityPage {
  const due = (day: string) => ({ dateTime: `${day}T00:00:00`, timeZone: 'UTC', precision: 'date' as const })
  return {
    currentUser: { id: 'me' },
    coverage: 'complete',
    collections: [{ id: 'work', title: 'Work' }, { id: 'personal', title: 'Personal' }],
    items: [
      task('past', 'work', { dueDate: due('2026-10-12') }),
      task('due-today-work', 'work', { dueDate: due('2026-10-13'), important: true }),
      task('reminder-only', 'work', { reminderDate: due('2026-10-13') }),
      task('future', 'personal', { dueDate: due('2026-10-14') }),
      task('due-today-personal', 'personal', { dueDate: due('2026-10-13'), reminderDate: due('2026-10-13') }),
      task('undated', 'personal'),
      task('done', 'work', { dueDate: due('2026-10-13'), reminderDate: due('2026-10-13'), statusCategory: 'done' }),
      task('foreign', 'work', { dueDate: due('2026-10-13'), reminderDate: due('2026-10-13'), personalMembership: { accountId: 'other', relation: 'owned' } }),
      task('archived', 'work', { dueDate: due('2026-10-13'), archived: true }),
    ],
  }
}

function freezeTime(instant = '2026-10-13T09:00:00Z'): void {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date(instant))
}

it('counts planned due dates and reminders once and restricts today to personal unfinished due tasks', async () => {
  freezeTime()
  open(scheduledFixture())
  await wrapper!.setProps({ compact: false })
  expect(wrapper!.findAll('.category-filters .smart-filter').map(option => option.text())).toEqual(['All6', 'Important1', 'Overdue1', 'Planned5', 'Due today2'])
  await wrapper!.get('.smart-filter.planned').trigger('click')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task past', 'Task due-today-work', 'Task reminder-only', 'Task future', 'Task due-today-personal'])
  await wrapper!.get('.smart-filter.today').trigger('click')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task due-today-work', 'Task due-today-personal'])
})

it('composes planned and today with native lists and search while retaining account-wide category counts', async () => {
  freezeTime()
  open(scheduledFixture())
  await wrapper!.setProps({ compact: false })
  await wrapper!.get('.smart-filter.planned').trigger('click')
  await choice('Personal').trigger('click')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task future', 'Task due-today-personal'])
  await wrapper!.get('input').setValue('due-today')
  await wrapper!.get('.smart-filter.today').trigger('click')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task due-today-personal'])
  await choice('Work').trigger('click')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task due-today-work'])
  await wrapper!.get('input').setValue('reminder-only')
  expect(wrapper!.findAll('.task')).toHaveLength(0)
  expect(wrapper!.get('.smart-filter.planned').text()).toBe('Planned5')
  expect(wrapper!.get('.smart-filter.today').text()).toBe('Due today2')
  await button('Clear filters').trigger('click')
  expect(choice('Work').attributes('aria-pressed')).toBe('true')
  await wrapper!.get('.smart-filter.planned').trigger('click')
  await wrapper!.get('input').setValue('reminder-only')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task reminder-only'])
})

it.each(['planned', 'today'])('resets the %s category, list and search when the source account changes', async (category) => {
  freezeTime()
  open(scheduledFixture())
  await wrapper!.get(`.smart-filter.${category}`).trigger('click')
  await choice('Personal').trigger('click')
  await wrapper!.get('input').setValue('due-today')
  await wrapper!.setProps({ page: { currentUser: { id: 'new-account' }, collections: [], items: [] } })
  expect(wrapper!.get('input').element.value).toBe('')
  expect(wrapper!.get('.smart-filter.all').attributes('aria-pressed')).toBe('true')
  expect(wrapper!.get('.collection-choice').attributes('aria-pressed')).toBe('true')
  expect(wrapper!.get('.smart-filter.planned').text()).toBe('Planned0')
  expect(wrapper!.get('.smart-filter.today').text()).toBe('Due today0')
})

it('uses each deadline source timezone when selecting tasks due today', async () => {
  freezeTime('2026-10-13T01:00:00Z')
  open({ currentUser: { id: 'me' }, coverage: 'complete', collections: [{ id: 'work', title: 'Work' }], items: [
    task('honolulu-today', 'work', { dueDate: { dateTime: '2026-10-12T00:00:00', timeZone: 'Pacific/Honolulu', precision: 'date' } }),
    task('shanghai-today', 'work', { dueDate: { dateTime: '2026-10-13T00:00:00', timeZone: 'Asia/Shanghai', precision: 'date' } }),
    task('honolulu-tomorrow', 'work', { dueDate: { dateTime: '2026-10-13T00:00:00', timeZone: 'Pacific/Honolulu', precision: 'date' } }),
  ] })
  await wrapper!.get('.smart-filter.today').trigger('click')
  expect(wrapper!.get('.smart-filter.today').text()).toBe('Due today2')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task honolulu-today', 'Task shanghai-today'])
})

it('refreshes today and overdue categories on the minute clock across source-zone midnight', async () => {
  freezeTime('2026-10-13T15:59:30Z')
  open({ currentUser: { id: 'me' }, coverage: 'complete', collections: [{ id: 'work', title: 'Work' }], items: [
    task('today', 'work', { dueDate: { dateTime: '2026-10-13T00:00:00', timeZone: 'Asia/Shanghai', precision: 'date' } }),
    task('tomorrow', 'work', { dueDate: { dateTime: '2026-10-14T00:00:00', timeZone: 'Asia/Shanghai', precision: 'date' } }),
  ] })
  await wrapper!.get('.smart-filter.today').trigger('click')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task today'])
  expect(wrapper!.get('.smart-filter.overdue').text()).toBe('Overdue0')
  await vi.advanceTimersByTimeAsync(59_999)
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task today'])
  await vi.advanceTimersByTimeAsync(1)
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task tomorrow'])
  expect(wrapper!.get('.smart-filter.overdue').text()).toBe('Overdue1')
  await wrapper!.get('.smart-filter.overdue').trigger('click')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task today'])
})

it('switches all smart categories between English and Chinese without changing the selected category', async () => {
  freezeTime()
  open(scheduledFixture())
  await wrapper!.get('.smart-filter.planned').trigger('click')
  useI18n().setLocale('zh-CN')
  await wrapper!.vm.$nextTick()
  expect(wrapper!.findAll('.category-filters .smart-filter').map(option => option.text())).toEqual(['全部6', '重要1', '已逾期1', '已计划5', '今日到期2'])
  expect(wrapper!.get('.smart-filter.planned').attributes('aria-pressed')).toBe('true')
  useI18n().setLocale('en')
  await wrapper!.vm.$nextTick()
  expect(wrapper!.get('.smart-filter.planned').text()).toBe('Planned5')
  expect(wrapper!.get('.smart-filter.today').text()).toBe('Due today2')
})

it('shows additional loaded tasks, collapses groups and retains empty native lists', async () => {
  open()
  await button('Show more tasks').trigger('click')
  expect(wrapper!.findAll('.task')).toHaveLength(4)
  await wrapper!.get('.collection-group-heading').trigger('click')
  expect(wrapper!.findAll('.task')).toHaveLength(1)
  await choice('Empty').trigger('click')
  expect(wrapper!.text()).toContain('No pending work')
  expect(choice('Empty').attributes('aria-pressed')).toBe('true')
})

it('shows every match without the compact preview once a smart category or list is chosen', async () => {
  const page = fixture()
  const overdue = { dueDate: { dateTime: '2000-01-01T00:00:00Z', timeZone: 'UTC' } }
  page.items.push(task('5', 'work', overdue), task('6', 'work', overdue), task('7', 'personal', overdue))
  open(page)
  expect(wrapper!.findAll('.task')).toHaveLength(4)
  await wrapper!.get('.smart-filter.overdue').trigger('click')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task 2', 'Task 5', 'Task 6', 'Task 7'])
  expect(wrapper!.text()).not.toContain('Show more tasks')
  await wrapper!.get('.smart-filter.all').trigger('click')
  await choice('Work').trigger('click')
  expect(wrapper!.findAll('.task')).toHaveLength(5)
  await wrapper!.get('.collection-choice').trigger('click')
  expect(wrapper!.findAll('.task')).toHaveLength(4)
})

it('keeps selected lists across refresh, clears vanished lists and resets account-specific browsing', async () => {
  open()
  await choice('Personal').trigger('click')
  await wrapper!.setProps({ page: { ...fixture(), fetchedAt: new Date().toISOString() } })
  expect(choice('Personal').attributes('aria-pressed')).toBe('true')
  await wrapper!.setProps({ page: { ...fixture(), collections: [{ id: 'work', title: 'Work' }] } })
  expect(wrapper!.get('.collection-choice').attributes('aria-pressed')).toBe('true')
  await wrapper!.get('input').setValue('old account search')
  await wrapper!.get('.smart-filter.important').trigger('click')
  await wrapper!.setProps({ page: { items: [], currentUser: { id: 'new-account' }, collections: [] } })
  expect(wrapper!.get('input').element.value).toBe('')
  expect(wrapper!.get('.smart-filter.all').attributes('aria-pressed')).toBe('true')
  expect(wrapper!.findAll('.task')).toHaveLength(0)
})

it('persists display preferences with the current revision and retains unrelated home settings', async () => {
  open()
  await button('Display options').trigger('click')
  await wrapper!.get('[role="switch"][aria-label="Group by list"]').trigger('click')
  await flushPromises()
  expect(api.updateSettings).toHaveBeenCalledWith({ 'workbench.home': { tools: [], pinnedProjectIds: ['project'], workItems: { groupByList: false, density: 'comfortable', showEmptyLists: true } } }, 'initial')
  expect(wrapper!.find('.collection-group-heading').exists()).toBe(false)
  await wrapper!.get('[role="switch"][aria-label="Compact layout"]').trigger('click')
  await flushPromises()
  expect(wrapper!.classes()).toContain('is-compact')
  await wrapper!.get('[role="switch"][aria-label="Show empty lists"]').trigger('click')
  await flushPromises()
  expect(wrapper!.find('[title="Empty"]').exists()).toBe(false)
  wrapper!.unmount()
  open()
  expect(wrapper!.classes()).toContain('is-compact')
  expect(wrapper!.find('.collection-group-heading').exists()).toBe(false)
  expect(wrapper!.find('[title="Empty"]').exists()).toBe(false)
})

it('leaves preferences unchanged on a save conflict and reloads settings for a retry', async () => {
  open()
  vi.mocked(api.updateSettings).mockRejectedValue(new Error('Conflict'))
  vi.spyOn(api, 'settings').mockResolvedValue(snapshot())
  await button('Display options').trigger('click')
  await wrapper!.get('[role="switch"][aria-label="Compact layout"]').trigger('click')
  await flushPromises()
  expect(wrapper!.get('[role="alert"]').text()).toContain('not saved')
  expect(wrapper!.classes()).not.toContain('is-compact')
  expect(api.settings).toHaveBeenCalledOnce()
})

it('reveals all native lists and keeps a selected list visible when the chooser is collapsed', async () => {
  const page = fixture()
  page.collections = Array.from({ length: 8 }, (_, index) => ({ id: `list-${index}`, title: `List ${index}` }))
  page.items = page.collections.map(collection => task(collection.id, collection.id))
  page.coverage = 'partial'
  open(page)
  expect(wrapper!.findAll('.collection-choice')).toHaveLength(6)
  expect(wrapper!.text()).toContain('Category counts include loaded unfinished items only')
  await button('Show all lists (8)').trigger('click')
  expect(wrapper!.findAll('.collection-choice')).toHaveLength(9)
  await choice('List 7').trigger('click')
  await button('Show fewer lists').trigger('click')
  expect(choice('List 7').attributes('aria-pressed')).toBe('true')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task list-7'])
})

function projectFixture(): IntegrationEntityPage {
  const issue = (id: string, project: string, type = 'story', status = 'custom') => task(id, project, {
    project: { id: project, title: `Project ${project}` },
    type: { id: type, title: type === 'story' ? 'Story' : 'Bug' },
    status,
    statusLabel: status === 'custom' ? 'In review' : 'Open',
  })
  return { currentUser: { id: 'me' }, coverage: 'partial', items: [
    issue('a1', 'a'),
    issue('a2', 'a', 'bug'),
    issue('a3', 'a', 'story', 'open'),
    issue('b1', 'b'),
    { ...issue('done', 'a'), statusCategory: 'done' },
    { ...issue('other', 'a'), personalMembership: { accountId: 'other', relation: 'owned' } },
  ] }
}

it('combines project, type, native workflow and search filters without remote calls', async () => {
  open(projectFixture())
  expect(wrapper!.get('.type-filters').text()).toBe('All4Story3Bug1')
  expect(wrapper!.get('.collections-heading h3').text()).toBe('My projects 2')
  await choice('Project a').trigger('click')
  await button('Story3').trigger('click')
  const select = wrapper!.getComponent(FormSelect)
  const review = (select.props('options') as Array<{ value: string, label?: string }>).find(option => option.label === 'In review (1)')!
  select.vm.$emit('update:modelValue', review.value)
  await flushPromises()
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task a1'])
  await wrapper!.get('input').setValue('Task a3')
  expect(select.props('modelValue')).toBe(review.value)
  expect(wrapper!.text()).toContain('No pending work')
  await button('Clear filters').trigger('click')
  expect(wrapper!.get('.collection-filter-summary').text()).toContain('4 unfinished tasks')
  expect(wrapper!.get('.collection-choice').attributes('aria-pressed')).toBe('true')
  await wrapper!.get('input').setValue('Project b')
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task b1'])
})

it('isolates identical workflow codes across projects and types and preserves valid filters on refresh', async () => {
  const page = projectFixture()
  open(page)
  const select = wrapper!.getComponent(FormSelect)
  const reviews = (select.props('options') as Array<{ value: string, label?: string }>).filter(option => option.label?.startsWith('In review'))
  expect(reviews).toHaveLength(3)
  expect(new Set(reviews.map(option => option.value)).size).toBe(3)
  select.vm.$emit('update:modelValue', reviews[2]!.value)
  await flushPromises()
  expect(wrapper!.findAll('.task').map(row => row.text())).toEqual(['Task b1'])
  await wrapper!.setProps({ page: { ...page, fetchedAt: new Date().toISOString() } })
  expect(select.props('modelValue')).toBe(reviews[2]!.value)
  await wrapper!.setProps({ page: { ...page, items: page.items.filter(item => item.id !== 'b1') } })
  expect(select.props('modelValue')).toBe('all')
  await choice('Project a').trigger('click')
  await button('Bug1').trigger('click')
  await wrapper!.setProps({ page: { ...page, currentUser: { id: 'new-account' } } })
  expect(wrapper!.get('.type-filters button').attributes('aria-pressed')).toBe('true')
  expect(wrapper!.get('.collection-choice').attributes('aria-pressed')).toBe('true')
  expect(wrapper!.findAll('.task')).toHaveLength(0)
})

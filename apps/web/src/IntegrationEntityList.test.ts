// @vitest-environment happy-dom
/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FormSelect } from './components/ui/select'
import { useI18n } from './i18n'
import IntegrationEntityList from './IntegrationEntityList.vue'

describe('integration entity list', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useI18n().setLocale('en')
  })

  afterEach(() => {
    delete window.craftHubDesktop
  })

  it('groups unfinished children below completed parent context without counting or offering actions on the filtered parent', async () => {
    const parent = { id: 'parent', title: 'Completed parent', status: 'done', statusCategory: 'done' as const, url: 'https://example.com/parent' }
    const wrapper = mount(IntegrationEntityList, { global: { plugins: [getActivePinia()!] }, props: {
      statusFilter: 'active',
      workItemActions: { integrationId: 'issues' },
      items: [
        { id: 'a', title: 'Child A', status: 'open', ancestors: [parent] },
        { id: 'other', title: 'Other root', status: 'open' },
        { id: 'b', title: 'Child B', status: 'open', ancestors: [parent] },
        parent,
      ],
    } })
    const rows = () => wrapper.findAll('[role="listitem"]')
    expect(rows().map(row => row.get('strong').text())).toEqual(['Completed parent', 'Child A', 'Child B', 'Other root'])
    expect(wrapper.get('.integration-hierarchy-context').text()).toContain('done')
    expect(wrapper.get('.integration-hierarchy-context').findAll('button')).toHaveLength(1)
    expect(wrapper.get('.integration-hierarchy-context button').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.integration-hierarchy-context a').attributes('href')).toBe('https://example.com/parent')
    expect(wrapper.get('.integration-entity-toolbar').text()).toContain('3 of 4')
    expect(rows()[1]?.attributes('aria-level')).toBe('2')
    wrapper.getComponent(FormSelect).vm.$emit('update:modelValue', 'all')
    await wrapper.vm.$nextTick()
    expect(rows()).toHaveLength(4)
    expect(wrapper.find('.integration-hierarchy-context').exists()).toBe(false)
    await wrapper.get('input[type="search"]').setValue('Child B')
    expect(rows().map(row => row.get('strong').text())).toEqual(['Completed parent', 'Child B'])
    wrapper.unmount()
  })

  it('keeps hierarchy context scoped and respects the current assignee filter', async () => {
    const parent = { id: 'parent', title: 'Parent in A', status: 'done', metadata: { workspaceId: 'a' } }
    const wrapper = mount(IntegrationEntityList, { global: { plugins: [getActivePinia()!] }, props: {
      statusFilter: 'active',
      assigneeFilter: 'current-user',
      currentUser: { id: 'alice' },
      items: [
        { id: 'child', title: 'Mine', status: 'open', assignees: [{ id: 'alice' }], metadata: { workspaceId: 'a' }, ancestors: [parent] },
        { id: 'parent', title: 'Other workspace', status: 'open', assignees: [{ id: 'alice' }], metadata: { workspaceId: 'b' } },
        { id: 'hidden', title: 'Other handler', status: 'open', assignees: [{ id: 'bob' }], ancestors: [{ id: 'hidden-parent', title: 'Hidden parent' }] },
      ],
    } })
    expect(wrapper.findAll('[role="listitem"] strong').map(row => row.text())).toEqual(['Parent in A', 'Mine', 'Other workspace'])
    await wrapper.get('input[type="search"]').setValue('Parent in A')
    expect(wrapper.findAll('[role="listitem"] strong').map(row => row.text())).toEqual(['Parent in A', 'Mine'])
    await wrapper.get('input[type="search"]').setValue('unmatched')
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(0)
    wrapper.unmount()
  })

  it('collapses nested branches independently, keeps scope separate, and reveals new filter matches', async () => {
    const root = { id: 'r', title: 'Root', metadata: { workspaceId: 'one', type: 'story' } }
    const parent = { id: 'p', title: 'Parent', metadata: { workspaceId: 'one', type: 'story' } }
    const wrapper = mount(IntegrationEntityList, { props: { items: [
      { ...root, status: 'open' },
      { ...parent, status: 'open', ancestors: [root] },
      { id: 'child', title: 'Nested child', status: 'open', metadata: { workspaceId: 'one', type: 'story' }, ancestors: [root, parent] },
      { ...parent, title: 'Other workspace', metadata: { workspaceId: 'two', type: 'story' } },
    ] } })
    const titles = () => wrapper.findAll('[role="listitem"] strong').map(row => row.text())
    await wrapper.get('button[aria-label="Collapse children of Parent"]').trigger('click')
    expect(titles()).toEqual(['Root', 'Parent', 'Other workspace'])
    await wrapper.get('button[aria-label="Collapse children of Root"]').trigger('click')
    expect(titles()).toEqual(['Root', 'Other workspace'])
    expect(wrapper.get('.integration-entity-toolbar').text()).toContain('4 of 4')
    await wrapper.get('button[aria-label="Expand children of Root"]').trigger('click')
    expect(titles()).toEqual(['Root', 'Parent', 'Other workspace'])
    expect(wrapper.get('button[aria-label="Expand children of Parent"]').attributes('aria-expanded')).toBe('false')
    await wrapper.get('input').setValue('Nested child')
    expect(titles()).toEqual(['Root', 'Parent', 'Nested child'])
    expect(wrapper.findAll('button[aria-expanded="true"]')).toHaveLength(2)
    await wrapper.get('button[aria-label="Collapse children of Root"]').trigger('click')
    expect(titles()).toEqual(['Root'])
    await wrapper.get('input').setValue('')
    expect(titles()).toEqual(['Root', 'Parent', 'Nested child', 'Other workspace'])
  })

  it('shows semantic badges, separate update times, and independent contact links without raw field names', async () => {
    const wrapper = mount(IntegrationEntityList, { props: { items: [{
      id: 'a',
      title: 'Example work item',
      url: 'https://example.com/items/a',
      metadata: { type: 'story', priority: 'native-high', owner: 'alice; bob;', updatedAt: '2026-09-09 12:34:56', workspaceId: 'private-workspace' },
      priority: { label: 'High', tone: 'danger' },
      assignees: [{ id: 'alice', url: 'https://example.com/people/alice' }, { id: 'bob', url: 'team-chat://message/?username=bob', urlLabel: 'Contact Bob' }],
    }, { id: 'b', title: 'Unknown priority', metadata: { type: 'custom', priority: 'Next milestone' } }] } })
    const row = wrapper.findAll('[role="listitem"]')[0]!
    expect(row.get('.integration-type-badge').text()).toBe('STORY')
    expect(row.get('.integration-priority-badge').attributes('data-tone')).toBe('danger')
    expect(row.get('.integration-priority-badge').text()).toBe('High')
    expect(wrapper.get('.integration-entity-columns').findAll('span').map(cell => cell.text())).toEqual(['Work item', 'Priority', 'Updated', 'Status', 'Actions'])
    expect(row.find('.integration-entity-main .integration-priority-badge').exists()).toBe(false)
    expect(row.get('.integration-entity-priority').text()).toBe('High')
    expect(row.get('.integration-updated-at').text()).not.toContain('Updated')
    expect(wrapper.get(`#${row.get('.integration-updated-at').attributes('aria-labelledby')}`).text()).toBe('Updated')
    expect(wrapper.findAll('[role="listitem"]')[1]!.get('.integration-updated-at').text()).toBe('—')
    expect(row.get('.integration-updated-at time').attributes('title')).toBe('2026-09-09 12:34:56')
    expect(row.get('.integration-updated-at').text()).toContain('2026-09-09')
    expect(row.get('.integration-updated-at').text()).toContain('12:34')
    expect(row.find('.integration-entity-link .integration-updated-at').exists()).toBe(false)
    expect(row.find('.integration-entity-link .integration-assignees').exists()).toBe(false)
    expect(row.findAll('.integration-assignees a').map(a => a.attributes('href'))).toEqual(['https://example.com/people/alice', 'team-chat://message/?username=bob'])
    expect(row.find('a a').exists()).toBe(false)
    expect(row.text()).not.toMatch(/workspaceId|private-workspace|type:|priority:|owner:|updatedAt:/)
    expect(wrapper.findAll('.integration-priority-badge')[1]!.attributes('data-tone')).toBe('neutral')
    await wrapper.get('input').setValue('native-high')
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(1)
  })

  it('renders unsafe contact destinations as plain text', () => {
    const wrapper = mount(IntegrationEntityList, { props: { items: [{ id: 'a', title: 'Contacts', assignees: [
      { id: 'script', url: 'javascript://example.com/alert(1)' },
      { id: 'file', url: 'file://localhost/etc/passwd' },
      { id: 'data', url: 'data:text/html,test' },
      { id: 'credential', url: 'https://user:secret@example.com/' },
      { id: 'broken', url: 'not a URL' },
    ] }] } })
    expect(wrapper.findAll('.integration-assignees a')).toHaveLength(0)
    expect(wrapper.get('.integration-assignees').text()).toContain('script')
    expect(wrapper.get('.integration-assignees').text()).toContain('broken')
  })

  it('defaults to unfinished items and combines exact status selection with text search', async () => {
    const wrapper = mount(IntegrationEntityList, { props: {
      statusFilter: 'active',
      items: [
        { id: '1', title: 'Current', status: 'processing', statusLabel: 'In progress', statusCategory: 'active' },
        { id: '2', title: 'Fixed', status: 'resolved', statusLabel: 'Resolved', statusCategory: 'resolved', url: 'https://example.com/issues/2' },
        { id: '3', title: 'Complete', status: 'done', statusCategory: 'done' },
        { id: '4', title: 'Closed', status: 'closed', statusCategory: 'closed' },
        { id: '5', title: 'Custom', status: 'status_7', statusLabel: 'Needs review', statusCategory: 'unknown' },
      ],
    } })
    expect(wrapper.findAll('[role="listitem"]').map(row => row.get('strong').text())).toEqual(['Current', 'Custom'])
    expect(wrapper.get('.entity-status').text()).toBe('In progress')
    expect(wrapper.get('.entity-status').attributes('title')).toBe('processing')
    const select = wrapper.getComponent(FormSelect)
    select.vm.$emit('update:modelValue', 'all')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(5)
    const original = wrapper.get('a[aria-label="Open original: Fixed"]')
    expect(original.attributes()).toMatchObject({ href: 'https://example.com/issues/2', target: '_blank', rel: 'noopener noreferrer' })
    const resolved = select.props('options')!.find((option: { label?: string, value: string }) => option.label === 'Resolved (1)')!
    select.vm.$emit('update:modelValue', resolved.value)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(1)
    expect(wrapper.get('[role="listitem"] strong').text()).toBe('Fixed')
    await wrapper.get('input').setValue('no match')
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(0)
    expect(wrapper.findComponent(FormSelect).exists()).toBe(true)
    await wrapper.get('input').setValue('resolved')
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(1)
  })

  it('hides archived unfinished work by default while allowing explicit archive inspection', async () => {
    const wrapper = mount(IntegrationEntityList, { props: {
      statusFilter: 'active',
      assigneeFilter: 'current-user',
      currentUser: { id: 'alice' },
      items: [
        { id: '1', title: 'Active', status: 'open', statusCategory: 'open', archived: false, assignees: [{ id: 'alice' }] },
        { id: '2', title: 'Old work', status: 'open', statusCategory: 'open', archived: true, assignees: [{ id: 'alice' }] },
        { id: '3', title: 'Older work', archived: true, assignees: [{ id: 'bob' }] },
      ],
    } })
    const titles = () => wrapper.findAll('[role="listitem"] strong').map(item => item.text())
    const [status, assignee] = wrapper.findAllComponents(FormSelect)
    expect(titles()).toEqual(['Active'])
    expect(status!.props('options')).toEqual(expect.arrayContaining([{ value: 'archived', label: 'Archived (2)' }]))
    const open = status!.props('options')!.find((option: { label?: string }) => option.label === 'open (1)')!
    status!.vm.$emit('update:modelValue', open.value)
    await wrapper.vm.$nextTick()
    expect(titles()).toEqual(['Active'])
    status!.vm.$emit('update:modelValue', 'archived')
    await wrapper.vm.$nextTick()
    expect(titles()).toEqual(['Old work'])
    expect(wrapper.get('.entity-status.archived').text()).toBe('Archived')
    expect(wrapper.get('.entity-status.archived').attributes('title')).toBe('open')
    expect(wrapper.find('.i-lucide-archive').exists()).toBe(true)
    assignee!.vm.$emit('update:modelValue', 'all')
    await wrapper.vm.$nextTick()
    expect(titles()).toEqual(['Old work', 'Older work'])
    expect(wrapper.findAll('.entity-status.archived')).toHaveLength(2)
    status!.vm.$emit('update:modelValue', 'all')
    await wrapper.vm.$nextTick()
    expect(titles()).toHaveLength(3)
    await wrapper.get('input').setValue('archived')
    expect(titles()).toEqual(['Old work', 'Older work'])
    await wrapper.setProps({ items: [{ id: '1', title: 'Active', status: 'open' }] })
    expect(status!.props('options')!.some((option: { value: string }) => option.value === 'archived')).toBe(false)
    wrapper.unmount()
  })

  it('keeps the status selector available when every item is finished', async () => {
    const wrapper = mount(IntegrationEntityList, { props: { statusFilter: 'active', items: [
      { id: '1', title: 'Done', status: 'done', statusCategory: 'done' },
    ] } })
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(0)
    wrapper.getComponent(FormSelect).vm.$emit('update:modelValue', 'all')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(1)
  })

  it('combines exact multi-assignee matching with status and keyword filters', async () => {
    const wrapper = mount(IntegrationEntityList, { props: {
      assigneeFilter: 'current-user',
      currentUser: { id: 'alice', label: 'Alice' },
      statusFilter: 'active',
      items: [
        { id: '1', title: 'Shared testing', status: 'testing', statusCategory: 'testing', assignees: [{ id: 'alice' }, { id: 'bob' }] },
        { id: '2', title: 'Similar account', status: 'open', assignees: [{ id: 'alice-other' }] },
        { id: '3', title: 'Fixed', status: 'resolved', statusCategory: 'resolved', assignees: [{ id: 'alice' }] },
        { id: '4', title: 'Unassigned', status: 'open', assignees: [] },
      ],
    } })
    const titles = () => wrapper.findAll('[role="listitem"] strong').map(item => item.text())
    const [status, assignee] = wrapper.findAllComponents(FormSelect)
    expect(titles()).toEqual(['Shared testing'])
    status!.vm.$emit('update:modelValue', 'all')
    await wrapper.vm.$nextTick()
    expect(titles()).toEqual(['Shared testing', 'Fixed'])
    await wrapper.get('input').setValue('fixed')
    expect(titles()).toEqual(['Fixed'])
    await wrapper.get('input').setValue('')
    assignee!.vm.$emit('update:modelValue', 'account:bob')
    await wrapper.vm.$nextTick()
    expect(titles()).toEqual(['Shared testing'])
    assignee!.vm.$emit('update:modelValue', 'unassigned')
    await wrapper.vm.$nextTick()
    expect(titles()).toEqual(['Unassigned'])
    assignee!.vm.$emit('update:modelValue', 'all')
    await wrapper.vm.$nextTick()
    expect(titles()).toHaveLength(4)
    await wrapper.setProps({ currentUser: { id: 'alice-other' } })
    expect(titles()).toEqual(['Similar account'])
    wrapper.unmount()
  })

  it('falls back to all assignees when identity is unavailable and recovers after refresh', async () => {
    const wrapper = mount(IntegrationEntityList, { props: {
      assigneeFilter: 'current-user',
      items: [
        { id: '1', title: 'First', assignees: [{ id: 'alice' }] },
        { id: '2', title: 'Second', assignees: [{ id: 'bob' }] },
      ],
    } })
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(2)
    expect(wrapper.get('.integration-filter-hint').text()).toContain('Current account unavailable')
    expect(wrapper.getComponent(FormSelect).props('options')!.some((option: { value: string }) => option.value === 'current-user')).toBe(false)
    await wrapper.setProps({ currentUser: { id: 'bob' } })
    expect(wrapper.find('.integration-filter-hint').exists()).toBe(false)
    expect(wrapper.get('[role="listitem"] strong').text()).toBe('Second')
    await wrapper.setProps({ currentUser: undefined })
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(2)
    wrapper.unmount()
  })

  it('opens typed source references through the desktop bridge', async () => {
    const openIntegrationSource = vi.fn(async () => {})
    window.craftHubDesktop = { openIntegrationSource }
    const wrapper = mount(IntegrationEntityList, { props: {
      sourceContext: { integrationId: 'configuration', actionId: 'list', projectId: 'project' },
      items: [{ id: 'plugin', title: 'Plugin', details: [{ label: 'Source', value: '/project/config.toml', sourcePath: '/project/config.toml' }] }],
    } })
    await wrapper.get('a').trigger('click')
    expect(openIntegrationSource).toHaveBeenCalledWith('configuration', 'list', 'plugin', 0, 'project')
  })

  it('encodes browser source links and rejects non-file source values', () => {
    const wrapper = mount(IntegrationEntityList, { props: { items: [{ id: 'plugin', title: 'Plugin', details: [
      { label: 'Source', value: 'config', sourcePath: '/项目/a b#c/config.toml' },
      { label: 'Unsafe', value: 'unsafe', sourcePath: 'javascript:alert(1)' },
    ] }] } })
    expect(wrapper.findAll('a')).toHaveLength(1)
    expect(wrapper.get('a').attributes('href')).toBe('vscode://file/%E9%A1%B9%E7%9B%AE/a%20b%23c/config.toml')
  })

  it('renders and filters configuration details as escaped text', async () => {
    const wrapper = mount(IntegrationEntityList, { props: { items: [
      { id: 'plugin', title: 'Plugin', details: [{ label: 'Source', value: '/project/.codex/config.toml' }, { label: 'Unsafe', value: '<img src=x onerror=alert(1)>' }] },
      { id: 'other', title: 'Other' },
    ] } })
    expect(wrapper.findAll('dd')[0]?.text()).toBe('/project/.codex/config.toml')
    expect(wrapper.find('img').exists()).toBe(false)
    await wrapper.get('input').setValue('config.toml')
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(1)
  })

  it('filters loaded entities without changing provider order', async () => {
    const wrapper = mount(IntegrationEntityList, {
      props: {
        items: [
          { id: 'issue-2', title: 'Second from provider', status: 'Open', metadata: { type: 'task' } },
          { id: 'issue-1', title: 'First alphabetically', status: 'Done', metadata: { type: 'bug' } },
          { id: 'issue-3', title: 'Third from provider', status: 'Open', metadata: { type: 'story' } },
        ],
      },
    })

    expect(wrapper.findAll('[role="listitem"] strong').map(item => item.text())).toEqual([
      'Second from provider',
      'First alphabetically',
      'Third from provider',
    ])
    expect(wrapper.text()).toContain('3 of 3')

    await wrapper.get('input[type="search"]').setValue('open')

    expect(wrapper.findAll('[role="listitem"] strong').map(item => item.text())).toEqual([
      'Second from provider',
      'Third from provider',
    ])
    expect(wrapper.text()).toContain('2 of 3')
  })

  it('hides unavailable status writes while preserving the external destination', () => {
    const wrapper = mount(IntegrationEntityList, {
      props: {
        statusActions: { integrationId: 'issues', transitionsActionId: 'transitions', updateActionId: 'update' },
        items: [
          { id: 'global', title: 'Global item', status: 'Open', statusUpdateAvailable: false, url: 'https://example.com/issues/1' },
          { id: 'bound', title: 'Bound item', status: 'Open', statusUpdateAvailable: true },
        ],
      },
    })
    const rows = wrapper.findAll('[role="listitem"]')
    expect(rows[0]!.find('.integration-status-trigger').exists()).toBe(false)
    expect(rows[0]!.find('a').attributes('href')).toBe('https://example.com/issues/1')
    expect(rows[1]!.find('.integration-status-trigger').exists()).toBe(true)
  })

  it('renders rich provider descriptions as safe plain text', () => {
    const wrapper = mount(IntegrationEntityList, {
      props: {
        items: [{
          id: 'issue-1',
          title: 'Readable item',
          description: '<p>Readable <strong>summary</strong>.</p><style>.private { display: none }</style>',
        }],
      },
    })

    expect(wrapper.text()).toContain('Readable summary.')
    expect(wrapper.text()).not.toContain('<strong>')
    expect(wrapper.text()).not.toContain('.private')
    expect(wrapper.find('strong strong').exists()).toBe(false)
  })
})

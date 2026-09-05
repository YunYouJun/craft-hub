// @vitest-environment happy-dom
/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useI18n } from './i18n'
import IntegrationEntityList from './IntegrationEntityList.vue'

describe('integration entity list', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useI18n().setLocale('en')
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

    expect(wrapper.findAll('[role="listitem"]').map(item => item.text())).toEqual([
      'Second from providertype: taskOpen',
      'First alphabeticallytype: bugDone',
      'Third from providertype: storyOpen',
    ])
    expect(wrapper.text()).toContain('3 of 3')

    await wrapper.get('input[type="search"]').setValue('open')

    expect(wrapper.findAll('[role="listitem"]').map(item => item.text())).toEqual([
      'Second from providertype: taskOpen',
      'Third from providertype: storyOpen',
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

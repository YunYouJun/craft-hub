// @vitest-environment happy-dom
/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import DiagnosticsWorkbench from './DiagnosticsWorkbench.vue'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

describe('diagnostics workbench', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useI18n().setLocale('en')
  })

  it('groups current problems and routes users to the owning surface', async () => {
    const store = useWorkbenchStore()
    store.workbenchDiagnostics = {
      checkedAt: '2026-09-04T10:00:00.000Z',
      summary: { errors: 1, warnings: 1 },
      diagnostics: [
        { id: 'plugin', kind: 'marketplace-plugin', severity: 'error', subject: 'Broken plugin', message: 'Manifest is incompatible', target: { type: 'marketplace', package: '@acme/broken', sourceId: 'remote' } },
        { id: 'source', kind: 'marketplace-source', severity: 'warning', subject: 'Remote source', message: 'Using cached catalog', target: { type: 'marketplace', sourceId: 'remote' } },
      ],
    }
    const wrapper = mount(DiagnosticsWorkbench)

    expect(wrapper.get('[data-testid="diagnostics-summary"]').text()).toContain('1 error')
    expect(wrapper.findAll('.diagnostics-group')).toHaveLength(2)
    expect(wrapper.findAll('.diagnostics-group h2').map(heading => heading.text())).toEqual(['Marketplace plugins', 'Marketplace sources'])
    expect(wrapper.findAll('.diagnostic-row').map(row => row.text())).toEqual([
      'Broken pluginManifest is incompatibleOpen Marketplace',
      'Remote sourceUsing cached catalogOpen Marketplace',
    ])

    await wrapper.get('.diagnostic-row button').trigger('click')
    expect(wrapper.emitted('openTarget')?.[0]).toEqual([{ type: 'marketplace', package: '@acme/broken', sourceId: 'remote' }])
  })

  it('shows a calm healthy state when no diagnostics remain', () => {
    const store = useWorkbenchStore()
    store.workbenchDiagnostics = { checkedAt: '2026-09-04T10:00:00.000Z', diagnostics: [], summary: { errors: 0, warnings: 0 } }

    const wrapper = mount(DiagnosticsWorkbench)

    expect(wrapper.get('[data-testid="diagnostics-clear"]').text()).toContain('No issues found')
  })
})

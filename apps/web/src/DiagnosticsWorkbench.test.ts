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

  it('shows checked source versions, platforms and successful check counts', () => {
    const store = useWorkbenchStore()
    store.workbenchDiagnostics = {
      checkedAt: '2026-10-13T06:00:00.000Z',
      diagnostics: [],
      summary: { errors: 0, warnings: 0 },
      providers: [{ id: 'host:doctor', pluginId: 'host', title: 'Environment doctor', state: 'ready', checkedAt: '2026-10-13T06:00:00.000Z', summary: { errors: 0, warnings: 0, passed: 5 }, metadata: { version: '1.2.3', platform: 'win32' } }],
    }
    const wrapper = mount(DiagnosticsWorkbench)
    const source = wrapper.get('[data-testid="diagnostics-providers"]')
    expect(source.text()).toContain('Environment doctorChecks completed')
    expect(source.text()).toContain('Source: host')
    expect(source.text()).toContain('Version: 1.2.3')
    expect(source.text()).toContain('Platform: win32')
    expect(source.text()).toContain('5 passed')
    expect(source.get('time').attributes('datetime')).toBe('2026-10-13T06:00:00.000Z')
    expect(wrapper.find('[data-testid="diagnostics-clear"]').exists()).toBe(true)
  })

  it.each([
    ['empty', 'No checks returned', 'Its readiness has not been verified.'],
    ['skipped', 'Unavailable on this host', 'unavailable on a hosted workbench.'],
    ['error', 'Check failed', 'Refresh to retry.'],
  ] as const)('does not claim health when the provider is %s', (state, label, message) => {
    const store = useWorkbenchStore()
    store.workbenchDiagnostics = { checkedAt: '2026-10-13T06:00:00.000Z', diagnostics: [], summary: { errors: 0, warnings: 0 }, providers: [{ id: 'host:doctor', pluginId: 'host', title: 'Doctor', state }] }
    const wrapper = mount(DiagnosticsWorkbench)
    expect(wrapper.get('.diagnostic-provider').text()).toContain(label)
    expect(wrapper.get('.diagnostic-provider').text()).toContain(message)
    expect(wrapper.find('[data-testid="diagnostics-clear"]').exists()).toBe(false)
  })

  it('routes host diagnostic targets and translates fixed provider failures', async () => {
    useI18n().setLocale('zh-CN')
    const store = useWorkbenchStore()
    store.workbenchDiagnostics = {
      checkedAt: '2026-10-13T06:00:00.000Z',
      summary: { errors: 1, warnings: 1 },
      diagnostics: [
        { id: 'warning', kind: 'host-provider', severity: 'warning', subject: 'Environment', message: 'Choose a repository', target: { type: 'integration', integrationId: 'environment' } },
        { id: 'failure', kind: 'host-provider', severity: 'error', subject: 'Doctor', message: 'Diagnostic provider could not complete. Refresh to retry.' },
      ],
    }
    const wrapper = mount(DiagnosticsWorkbench)
    expect(wrapper.get('.diagnostics-group h2').text()).toBe('宿主诊断')
    expect(wrapper.text()).toContain('诊断来源未能完成检查，请刷新重试。')
    await wrapper.get('.diagnostic-row button').trigger('click')
    expect(wrapper.emitted('openTarget')?.[0]).toEqual([{ type: 'integration', integrationId: 'environment' }])
  })
})

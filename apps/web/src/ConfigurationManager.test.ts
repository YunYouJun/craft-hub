// @vitest-environment happy-dom
/// <reference lib="dom" />
import type { ConfigurationManagementPage, OperationSupport, ResolvedIntegrationContribution } from 'craft-hub'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { FormSelect } from './components/ui/select'
import ConfigurationManager from './ConfigurationManager.vue'
import { useI18n } from './i18n'

enableAutoUnmount(afterEach)

const contribution: ResolvedIntegrationContribution = { id: 'test', pluginId: 'test', source: 'host:test', provider: { id: 'test', requires: '^1.0.0' }, providerVersion: '1.0.0', views: [], actions: [
  { id: 'read', title: 'Read', operation: 'configuration.read', effect: 'local-read', confirmation: 'never', effectiveConfirmation: 'never' },
  { id: 'update', title: 'Update', operation: 'configuration.update', effect: 'local-write', confirmation: 'always', effectiveConfirmation: 'always' },
] }
const page: ConfigurationManagementPage = { configuration: true, items: [{ id: 'a', title: 'Sample', kind: 'mcp', owner: 'user', origin: 'private', localPath: '/fixture/home/config', sourcePath: '/fixture/repo/config', status: 'first-adoption', revision: 'revision', local: 'local display', source: 'source display', fields: ['enabled'] }] }
function operationSupport(overrides: Partial<OperationSupport> = {}): OperationSupport {
  return { state: 'available', platform: 'linux', cliVersion: '1.0.0', operations: Object.fromEntries(['inspect', 'preview', 'apply', 'restore', 'history', 'git-status', 'git-fetch', 'git-commit', 'git-publish', 'software-open'].map(operation => [operation, { supported: true }])), ...overrides }
}
beforeEach(() => {
  setActivePinia(createPinia())
  useI18n().setLocale('en')
  vi.restoreAllMocks()
})

it('requires explicit choices and sends an immutable revision to preview', async () => {
  const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ ...page, preview: { planId: 'plan', changes: [] } })
  const wrapper = mount(ConfigurationManager, { props: { page, contribution }, global: { plugins: [getActivePinia()!] } })
  expect(wrapper.findAll('button').find(button => button.text().includes('Preview selected'))!.attributes('disabled')).toBeDefined()
  wrapper.findAllComponents(FormSelect).find(select => select.props('ariaLabel') === 'Decision Sample')!.vm.$emit('update:modelValue', 'source')
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text().includes('Preview selected'))!.trigger('click')
  await flushPromises()
  expect(invoke).toHaveBeenCalledWith('test', 'update', { operation: 'preview', decisions: [{ id: 'a', revision: 'revision', choice: 'source', fields: {} }] }, undefined, true)
  expect(wrapper.emitted('updated')).toHaveLength(1)
})

it('shows failures with recovery refresh and does not erase a reviewed preview', async () => {
  vi.spyOn(api, 'invokeIntegrationAction').mockRejectedValue(new Error('Configuration changed'))
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, preview: { planId: 'plan', changes: [{ path: '/fixture/home/config', direction: 'to-local', before: 'old', after: 'new', deletion: false }] } }, contribution }, global: { plugins: [getActivePinia()!] } })
  await flushPromises()
  const body = new DOMWrapper(document.body)
  await body.findAll('button').find(button => button.text() === 'Apply reviewed plan')!.trigger('click')
  await flushPromises()
  expect(wrapper.get('.ui-alert--danger').text()).toContain('Configuration changed')
  expect(body.get('[aria-label="Change preview"]').text()).toContain('/fixture/home/config')
  expect(wrapper.get('.ui-alert--danger').text()).toContain('Refresh and inspect recovery')
})

it('preserves decisions across filters and requires every merge field', async () => {
  const wrapper = mount(ConfigurationManager, { props: { page, contribution }, global: { plugins: [getActivePinia()!] } })
  const decision = () => wrapper.findAllComponents(FormSelect).find(select => select.props('ariaLabel') === 'Decision Sample')!
  decision().vm.$emit('update:modelValue', 'merge')
  await flushPromises()
  const preview = () => wrapper.findAll('button').find(button => button.text().includes('Preview selected'))!
  expect(preview().attributes('disabled')).toBeDefined()
  wrapper.findAllComponents(FormSelect).find(select => select.props('ariaLabel') === 'Merge field enabled')!.vm.$emit('update:modelValue', 'local')
  await flushPromises()
  expect(preview().attributes('disabled')).toBeUndefined()
  await wrapper.get('input[type="search"]').setValue('nothing')
  expect(wrapper.text()).toContain('No matching configuration')
  expect(preview().text()).toContain('(1)')
  await wrapper.get('input[type="search"]').setValue('')
  expect(decision().props('modelValue')).toBe('merge')
})

it('keeps a prepared plan when closing the preview dialog', async () => {
  const invoke = vi.spyOn(api, 'invokeIntegrationAction')
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, preview: { planId: 'plan', changes: [] } }, contribution }, global: { plugins: [getActivePinia()!] } })
  await flushPromises()
  const body = new DOMWrapper(document.body)
  await body.get('[aria-label="Close preview"]').trigger('click')
  await flushPromises()
  expect(invoke).not.toHaveBeenCalled()
  await wrapper.findAll('button').find(button => button.text() === 'Review prepared plan')!.trigger('click')
  await flushPromises()
  expect(body.get('[aria-label="Change preview"]').text()).toContain('No file changes')
})

it('does not offer resolution controls for installer-owned items', () => {
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, items: [{ ...page.items[0], status: 'read-only', owner: 'installer', management: 'Use the installer' }] }, contribution }, global: { plugins: [getActivePinia()!] } })
  expect(wrapper.text()).toContain('Use the installer')
  expect(wrapper.findAllComponents(FormSelect).some(select => select.props('ariaLabel')?.startsWith('Decision'))).toBe(false)
})

it('keeps unrecognized ownership read-only even with a source and a known manager', () => {
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, items: [{ ...page.items[0], owner: 'unknown', manager: 'workstation' }] }, contribution } })
  expect(wrapper.findAllComponents(FormSelect).some(select => select.props('ariaLabel')?.startsWith('Decision'))).toBe(false)
})

it('does not present installer inventory placeholders as compared Skill content', () => {
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, items: [{ ...page.items[0], kind: 'skill', owner: 'installer', manager: 'apm', status: 'read-only', sourcePath: undefined, local: '(absent)', source: '(absent)' }] }, contribution } })
  expect(wrapper.get('.configuration-inventory-content').text()).toContain('content and updates remain with the original tool')
  expect(wrapper.findAll('[aria-label="Change preview"]')).toHaveLength(0)
  expect(wrapper.text()).not.toContain('Identical content')
})

it('filters observed clients, scopes and managers and searches provenance', async () => {
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, items: [
    { ...page.items[0], client: 'codex', scope: 'global', manager: 'workstation', provenance: { label: 'Private configuration repository', path: '/fixture/source/agent.toml' } },
    { ...page.items[0], id: 'b', title: 'Portable skill', kind: 'skill', client: 'shared', scope: 'global', manager: 'apm', provenance: { label: 'Dependency lock', path: '/fixture/apm.lock' } },
    { ...page.items[0], id: 'c', title: 'Project plugin', kind: 'skill', client: 'codex', scope: 'project', manager: 'native-plugin', provenance: { label: 'Marketplace package' } },
  ] }, contribution }, global: { plugins: [getActivePinia()!] } })
  const setFilter = async (label: string, value: string) => {
    wrapper.findAllComponents(FormSelect).find(select => select.props('ariaLabel') === label)!.vm.$emit('update:modelValue', value)
    await flushPromises()
  }
  expect(wrapper.get('.configuration-ownership').text()).toContain('Private configuration repository')
  expect(wrapper.text()).toContain('They do not confirm that a running Agent loaded them')
  await setFilter('Configuration client', 'shared')
  expect(wrapper.findAll('.configuration-item').map(row => row.text())).toEqual([expect.stringContaining('Portable skill')])
  await setFilter('Configuration client', 'all')
  await setFilter('Configuration scope', 'project')
  expect(wrapper.findAll('.configuration-item').map(row => row.text())).toEqual([expect.stringContaining('Project plugin')])
  await setFilter('Configuration scope', 'all')
  await setFilter('Configuration manager', 'apm')
  expect(wrapper.get('.configuration-ownership').text()).toContain('APM')
  await setFilter('Configuration manager', 'all')
  await wrapper.get('input[type="search"]').setValue('/fixture/apm.lock')
  expect(wrapper.findAll('.configuration-item')).toHaveLength(1)
  expect(wrapper.get('.configuration-item').text()).toContain('Portable skill')
})

it('preserves staged choices when applying metadata filters', async () => {
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, items: [{ ...page.items[0], client: 'codex', scope: 'global', manager: 'workstation' }] }, contribution }, global: { plugins: [getActivePinia()!] } })
  const select = (label: string) => wrapper.findAllComponents(FormSelect).find(component => component.props('ariaLabel') === label)!
  select('Decision Sample').vm.$emit('update:modelValue', 'source')
  await flushPromises()
  select('Configuration client').vm.$emit('update:modelValue', 'shared')
  await flushPromises()
  expect(wrapper.text()).toContain('No matching configuration')
  expect(wrapper.findAll('button').find(button => button.text().includes('Preview selected'))!.text()).toContain('(1)')
  select('Configuration client').vm.$emit('update:modelValue', 'all')
  await flushPromises()
  expect(select('Decision Sample').props('modelValue')).toBe('source')
})

it.each([
  { owner: 'installer' },
  { owner: 'external' },
  { origin: 'installer' },
  { origin: 'external' },
  { origin: 'project' },
  { manager: 'project' },
  { manager: 'external' },
  { manager: 'apm' },
  { manager: 'skills-cli' },
  { manager: 'native-plugin' },
  { manager: 'unknown' },
  { manager: 'future-tool' },
])('never stages a foreign-owned item with a source path: %j', (ownership) => {
  const invoke = vi.spyOn(api, 'invokeIntegrationAction')
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, items: [{ ...page.items[0], ...ownership }] }, contribution }, global: { plugins: [getActivePinia()!] } })
  expect(wrapper.findAllComponents(FormSelect).some(select => select.props('ariaLabel')?.startsWith('Decision'))).toBe(false)
  expect(wrapper.findAll('button').find(button => button.text().includes('Preview selected'))!.attributes('disabled')).toBeDefined()
  expect(invoke).not.toHaveBeenCalled()
})

it.each([
  [undefined, 'has not returned a Skills audit'],
  [{ state: 'unsupported' as const, findings: [], message: 'Upgrade Workstation' }, 'unavailable in this Workstation version'],
  [{ state: 'error' as const, findings: [], message: 'Audit command timed out' }, 'Skills audit failed'],
])('does not report a zero-success audit for unavailable diagnostics', async (skillsAudit, expected) => {
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, skillsAudit }, contribution }, global: { plugins: [getActivePinia()!] } })
  await wrapper.get('[role="tab"][data-state="inactive"]').trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(wrapper.get('.configuration-skills-audit').text()).toContain(expected)
  expect(wrapper.find('.configuration-audit-summary').exists()).toBe(false)
  if (skillsAudit?.message)
    expect(wrapper.get('.configuration-skills-audit').text()).toContain(skillsAudit.message)
})

it('shows audit counts, observed time and diagnostic paths without staging writes', async () => {
  const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue(page)
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, skillsAudit: {
    state: 'available',
    checkedAt: '2026-10-13T08:00:00Z',
    summary: { skillFileCount: 7, implicitSkillCount: 5, explicitOnlySkillCount: 2, warningCount: 1, errorCount: 1 },
    findings: [
      { code: 'duplicate-name', severity: 'warning', message: 'Duplicate skill name', paths: ['/fixture/a/SKILL.md', '/fixture/b/SKILL.md'] },
      { code: 'dependency-drift', severity: 'error', message: 'Dependency differs from lock', paths: ['/fixture/apm.lock'] },
    ],
  } }, contribution }, global: { plugins: [getActivePinia()!] } })
  await wrapper.findAll('[role="tab"]').find(tab => tab.text().includes('Skills audit'))!.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(wrapper.get('time').attributes('datetime')).toBe('2026-10-13T08:00:00Z')
  expect(wrapper.get('.configuration-audit-summary').text()).toContain('Skill files7')
  expect(wrapper.get('.configuration-audit-summary').text()).toContain('Explicit invocation only2')
  expect(wrapper.findAll('.configuration-audit-findings li')).toHaveLength(2)
  expect(wrapper.get('.configuration-audit-findings').text()).toContain('/fixture/b/SKILL.md')
  expect(wrapper.get('.configuration-audit-findings').text()).toContain('Dependency differs from lock')
  await wrapper.findAll('button').find(button => button.text() === 'Refresh audit')!.trigger('click')
  await flushPromises()
  expect(invoke).toHaveBeenCalledWith('test', 'read', { operation: 'inspect' }, undefined, false)
})

it('only associates an item with its declared owning tool', () => {
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, items: [{ ...page.items[0], manager: 'unknown' }], managementTools: [{ id: 'magpie', title: 'Magpie', url: 'https://usemagpie.ai/docs' }] }, contribution }, global: { plugins: [getActivePinia()!] } })
  expect(wrapper.find('.configuration-item-tool').exists()).toBe(false)
  expect(wrapper.get('.configuration-management-tools').text()).toContain('Magpie')
})

it('offers matching manager documentation and rejects unsafe tool URLs', () => {
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, items: [{ ...page.items[0], manager: 'apm' }], managementTools: [
    { id: 'apm', title: 'APM', url: 'https://example.com/apm' },
    { id: 'script', title: 'Script', url: 'javascript:alert(1)' },
    { id: 'credentials', title: 'Credentials', url: 'https://user:password@example.com/docs' },
    { id: 'relative', title: 'Relative', url: '/tools/docs' },
    { id: 'file', title: 'File', url: 'file:///fixture/docs' },
    { id: 'http', title: 'HTTP docs', url: 'http://example.com/docs' },
  ] }, contribution }, global: { plugins: [getActivePinia()!] } })
  expect(wrapper.get('.configuration-item-tool a').attributes('href')).toBe('https://example.com/apm')
  const links = wrapper.findAll('.configuration-management-tools a')
  expect(links.map(link => link.attributes('href'))).toEqual(['https://example.com/apm', 'http://example.com/docs'])
  expect(links.every(link => link.attributes('rel') === 'noopener noreferrer')).toBe(true)
})

it('launches the original application only on click without modifying configuration', async () => {
  const open = vi.spyOn(api, 'openSoftwareApplication').mockResolvedValue({ version: 1, softwareId: 'magpie', destination: 'application' })
  const invoke = vi.spyOn(api, 'invokeIntegrationAction')
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, managementTools: [{ id: 'magpie', title: 'Magpie', url: 'https://usemagpie.ai/docs', software: { sourceId: 'workstation', softwareId: 'magpie' } }] }, contribution }, global: { plugins: [getActivePinia()!] } })
  expect(open).not.toHaveBeenCalled()
  await wrapper.findAll('button').find(button => button.text() === 'Open Magpie')!.trigger('click')
  await flushPromises()
  expect(open).toHaveBeenCalledWith('workstation', 'magpie')
  expect(wrapper.get('[role="status"]').text()).toContain('Launch requested for Magpie')
  expect(invoke).not.toHaveBeenCalled()
})

it('shows original application launch failures with documentation and software center fallback', async () => {
  vi.spyOn(api, 'openSoftwareApplication').mockRejectedValue(new Error('Application not installed'))
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, managementTools: [{ id: 'magpie', title: 'Magpie', url: 'https://usemagpie.ai/docs', software: { sourceId: 'workstation', softwareId: 'magpie' } }] }, contribution }, global: { plugins: [getActivePinia()!] } })
  await wrapper.findAll('button').find(button => button.text() === 'Open Magpie')!.trigger('click')
  await flushPromises()
  expect(wrapper.get('.ui-alert--danger').text()).toContain('Application not installed')
  expect(wrapper.get('.ui-alert--danger a').attributes('href')).toBe('/software')
  expect(wrapper.get('[aria-label="Documentation Magpie"]').attributes('href')).toBe('https://usemagpie.ai/docs')
})

it('applies a reviewed plan and restores an eligible backup through the existing actions', async () => {
  const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue(page)
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, preview: { planId: 'reviewed-plan', changes: [] }, history: [{ planId: 'backup-plan', state: 'applied', paths: ['/fixture/home/config'] }] }, contribution }, global: { plugins: [getActivePinia()!] } })
  await flushPromises()
  const body = new DOMWrapper(document.body)
  await body.findAll('button').find(button => button.text() === 'Apply reviewed plan')!.trigger('click')
  await flushPromises()
  expect(invoke).toHaveBeenCalledWith('test', 'update', { operation: 'apply', planId: 'reviewed-plan' }, undefined, true)
  await body.get('[aria-label="Close preview"]').trigger('click')
  await wrapper.findAll('[role="tab"]').find(tab => tab.text().includes('Recovery history'))!.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'Restore unchanged files from backup')!.trigger('click')
  await flushPromises()
  expect(invoke).toHaveBeenCalledWith('test', 'update', { operation: 'restore', planId: 'backup-plan' }, undefined, true)
})

it('preserves configuration review on unsupported platforms and blocks staged writes and tool opening', async () => {
  const invoke = vi.spyOn(api, 'invokeIntegrationAction')
  const open = vi.spyOn(api, 'openSoftwareApplication')
  const support = operationSupport({ platform: 'win32', operations: { 'inspect': { supported: true }, 'preview': { supported: false, reason: 'unsupported-platform' }, 'apply': { supported: false, reason: 'unsupported-platform' }, 'software-open': { supported: false, reason: 'unsupported-platform' } } })
  const wrapper = mount(ConfigurationManager, { props: { contribution, page: { ...page, operationSupport: support, managementTools: [{ id: 'magpie', title: 'Magpie', url: 'https://usemagpie.ai/', software: { sourceId: 'workstation', softwareId: 'magpie' } }] } } })
  expect(wrapper.text()).toContain('local display')
  expect(wrapper.text()).toContain('win32')
  expect(wrapper.text()).toContain('unavailable on this platform')
  const decision = wrapper.findAllComponents(FormSelect).find(select => select.props('ariaLabel') === 'Decision Sample')!
  expect(decision.props('disabled')).toBe(true)
  decision.vm.$emit('update:modelValue', 'source')
  await flushPromises()
  const preview = wrapper.findAllComponents(UiButton).find(button => button.text().includes('Preview selected'))!
  expect(preview.text()).toContain('(0)')
  preview.vm.$emit('click')
  wrapper.findAllComponents(UiButton).find(button => button.text() === 'Open Magpie')!.vm.$emit('click')
  await flushPromises()
  expect(invoke).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
  expect(wrapper.get('a[aria-label="Documentation Magpie"]').attributes('href')).toBe('https://usemagpie.ai/')
})

it.each(['unsupported', 'unavailable'] as const)('keeps prepared previews and recovery records readable when negotiation is %s', async (state) => {
  const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue(page)
  const current = { ...page, preview: { planId: 'existing-plan', changes: [{ path: '/fixture/home/config', direction: 'to-local', before: 'before', after: 'after', deletion: false }] }, history: [{ planId: 'applied-plan', state: 'applied', paths: ['/fixture/home/config'] }], operationSupport: operationSupport() }
  const wrapper = mount(ConfigurationManager, { props: { contribution, page: current }, global: { plugins: [getActivePinia()!] } })
  await wrapper.setProps({ page: { ...current, operationSupport: operationSupport({ state, operations: {} }) } })
  await flushPromises()
  const body = new DOMWrapper(document.body)
  expect(body.get('[aria-label="Change preview"]').text()).toContain('/fixture/home/config')
  const apply = wrapper.findAllComponents(UiButton).find(button => button.text() === 'Apply reviewed plan')!
  expect(apply.props('disabled')).toBe(true)
  apply.vm.$emit('click')
  await flushPromises()
  expect(invoke).not.toHaveBeenCalled()
  await body.get('[aria-label="Close preview"]').trigger('click')
  await wrapper.findAll('[role="tab"]').find(tab => tab.text().includes('Recovery history'))!.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(wrapper.text()).toContain('applied-plan')
  const restore = wrapper.findAllComponents(UiButton).find(button => button.text() === 'Restore unchanged files from backup')!
  expect(restore.props('disabled')).toBe(true)
  restore.vm.$emit('click')
  await flushPromises()
  expect(invoke).not.toHaveBeenCalled()
  await wrapper.findAll('[role="tab"]').find(tab => tab.text().includes('Review configurations'))!.trigger('keydown', { key: 'Enter' })
  await wrapper.findAll('button').find(button => button.text() === 'Refresh')!.trigger('click')
  await flushPromises()
  expect(invoke).toHaveBeenCalledWith('test', 'read', { operation: 'inspect' }, undefined, false)
})

it('rechecks Git capability when confirming an already reviewed repository action', async () => {
  const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue(page)
  const actions: ResolvedIntegrationContribution = { ...contribution, actions: [...contribution.actions, { id: 'execute', title: 'Execute', operation: 'configuration.execute', effect: 'local-write', confirmation: 'always', effectiveConfirmation: 'always' }] }
  const current = { ...page, operationSupport: operationSupport(), repositories: [{ id: 'public', root: '/fixture/repo', branch: 'main', revision: 'current', paths: [] }] }
  const wrapper = mount(ConfigurationManager, { props: { contribution: actions, page: current }, global: { plugins: [getActivePinia()!] } })
  await wrapper.findAll('[role="tab"]').find(tab => tab.text().includes('Repository sync'))!.trigger('keydown', { key: 'Enter' })
  await wrapper.findAll('button').find(button => button.text() === 'Review fetch')!.trigger('click')
  await flushPromises()
  await wrapper.setProps({ page: { ...current, operationSupport: operationSupport({ operations: { ...current.operationSupport.operations, 'git-fetch': { supported: false, reason: 'unsupported-platform' } } }) } })
  const confirm = wrapper.findAllComponents(UiButton).find(button => button.text() === 'Confirm repository operation')!
  expect(confirm.props('disabled')).toBe(true)
  confirm.vm.$emit('click')
  await flushPromises()
  expect(invoke).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('unavailable on this platform')
  expect(wrapper.text()).toContain('/fixture/repo')
})

it('refreshes negotiation while inspection is unsupported and enables actions after a CLI upgrade', async () => {
  const initial = { ...page, operationSupport: operationSupport({ operations: { inspect: { supported: false, reason: 'unsupported-version' }, preview: { supported: false, reason: 'unsupported-version' }, apply: { supported: false, reason: 'unsupported-version' } } }) }
  const upgraded = { ...page, operationSupport: operationSupport({ cliVersion: '2.0.0' }) }
  const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue(upgraded)
  const wrapper = mount(ConfigurationManager, { props: { contribution, page: initial }, global: { plugins: [getActivePinia()!] } })
  expect(wrapper.get('[data-testid="configuration-operation-support"]').text()).toContain('CLI 1.0.0')
  expect(wrapper.get('[data-testid="configuration-operation-support"]').text()).not.toContain('Workstation')
  expect(wrapper.get('[data-testid="configuration-inspection-unavailable"]').text()).toContain('Refresh capabilities')
  const refresh = wrapper.findAll('button').find(button => button.text() === 'Refresh capabilities')!
  expect(refresh.attributes('disabled')).toBeUndefined()
  await refresh.trigger('click')
  await flushPromises()
  expect(invoke).toHaveBeenCalledWith('test', 'read', { operation: 'inspect' }, undefined, false)
  expect(wrapper.emitted('updated')?.[0]).toEqual([upgraded])
  await wrapper.setProps({ page: upgraded })
  expect(wrapper.find('[data-testid="configuration-inspection-unavailable"]').exists()).toBe(false)
  expect(wrapper.findAll('button').some(button => button.text() === 'Refresh')).toBe(true)
  expect(wrapper.findAllComponents(FormSelect).find(select => select.props('ariaLabel') === 'Decision Sample')!.props('disabled')).toBe(false)
  expect(wrapper.get('[data-testid="configuration-operation-support"]').text()).toContain('CLI 2.0.0')
})

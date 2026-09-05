// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { CommandCapability, ProjectRecord, SkillCapability } from 'craft-hub'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useI18n } from './i18n'
import ProjectOverviewPanel from './ProjectOverviewPanel.vue'
import { useWorkbenchStore } from './store'

const project: ProjectRecord = {
  id: 'project',
  name: 'Example',
  path: '/workspace/example',
  trust: 'trusted',
  addedAt: '2026-01-01T00:00:00.000Z',
}

const dev: CommandCapability = {
  id: 'dev',
  kind: 'command',
  name: 'dev',
  description: 'Start the web application.',
  source: 'apps/web/package.json',
  category: 'develop',
  package: { name: '@example/web', description: 'Web application.', relativePath: 'apps/web', root: false },
  invocation: { command: 'pnpm', args: ['run', 'dev'], cwd: '/workspace/example/apps/web', requiredEnv: [] },
}

const assistant: SkillCapability = {
  id: 'widget-assistant',
  kind: 'skill',
  name: 'Widget assistant',
  description: 'Help develop and ship the widget.',
  source: 'codex-skill',
  path: '/plugins/widget/SKILL.md',
  content: '# Widget assistant',
  contentHash: 'hash',
}

afterEach(() => {
  delete window.craftHubDesktop
  document.body.innerHTML = ''
})

describe('project overview panel', () => {
  it('renders package cards and routes quick actions to capability detail without running', async () => {
    useI18n().setLocale('en')
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.capabilities = [dev]
    store.commandPackagesByProject = {
      [project.id]: [
        { name: 'example', description: 'Example project.', relativePath: '.', root: true },
        dev.package!,
      ],
    }
    store.projectOverview = {
      projectId: project.id,
      package: store.commandPackages[0]!,
      readme: { status: 'found', path: 'README.md', content: '# Example' },
    }
    const selectPackage = vi.spyOn(store, 'selectPackage').mockResolvedValue()
    const wrapper = mount(ProjectOverviewPanel, { global: { plugins: [pinia] } })

    expect(wrapper.get('.overview-description').text()).toBe('Example project.')
    expect(wrapper.get('.overview-heading [data-testid="open-readme-drawer"]').text()).toContain('README')
    expect(wrapper.get('.package-card').text()).toContain('@example/web')
    expect(wrapper.find('.markdown-preview').exists()).toBe(false)
    await wrapper.get('[data-testid="open-readme-drawer"]').trigger('click')
    await nextTick()
    expect(document.body.querySelector('[data-testid="readme-drawer"]')?.textContent).toContain('Example')

    await wrapper.get('.package-card-main').trigger('click')
    expect(selectPackage).toHaveBeenCalledWith('apps/web')

    await wrapper.get('.package-card footer button').trigger('click')
    expect(store.selectedCapabilityId).toBe(dev.id)
    expect(store.selectedPackagePath).toBe('apps/web')
    expect(store.run).toBeUndefined()
  })

  it('shows a package-contributed skill action and opens its interactive detail', async () => {
    useI18n().setLocale('en')
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.selectedPackagePath = 'apps/web'
    store.capabilities = [dev, assistant]
    store.commandPackagesByProject = {
      [project.id]: [
        { name: 'example', relativePath: '.', root: true },
        { ...dev.package!, quickActions: ['codex-skill:Widget assistant'] },
      ],
    }
    store.projectOverview = {
      projectId: project.id,
      package: store.commandPackages[1]!,
      readme: { status: 'missing' },
    }
    const wrapper = mount(ProjectOverviewPanel, { global: { plugins: [pinia] } })

    expect(wrapper.get('.overview-actions').text()).toContain('Widget assistant')
    expect(wrapper.get('.overview-actions .i-ri-sparkling-2-line')).toBeTruthy()
    const quickAction = wrapper.get('[data-testid="quick-action-widget-assistant"]')
    expect(quickAction.get('strong').text()).toBe('Widget assistant')
    expect(quickAction.get('small').text()).toBe('Help develop and ship the widget.')
    await quickAction.trigger('click')
    expect(store.selectedCapabilityId).toBe(assistant.id)
    expect(store.selectedPackagePath).toBe('apps/web')
  })

  it('opens a package-contributed HTTPS destination through the desktop bridge', async () => {
    useI18n().setLocale('en')
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.selectedPackagePath = 'apps/web'
    store.capabilities = [dev]
    store.commandPackagesByProject = {
      [project.id]: [
        { name: 'example', relativePath: '.', root: true },
        {
          ...dev.package!,
          links: [{ id: 'widget-console', title: 'Widget console', url: 'https://widgets.example.com/console/widget-123', source: 'plugin:test' }],
        },
      ],
    }
    store.projectOverview = {
      projectId: project.id,
      package: store.commandPackages[1]!,
      readme: { status: 'missing' },
    }
    const openExternalUrl = vi.fn().mockResolvedValue(undefined)
    window.craftHubDesktop = { openExternalUrl } as typeof window.craftHubDesktop
    const wrapper = mount(ProjectOverviewPanel, { global: { plugins: [pinia] } })

    await wrapper.get('[data-testid="package-link-widget-console"]').trigger('click')

    expect(openExternalUrl).toHaveBeenCalledWith('https://widgets.example.com/console/widget-123')
  })

  it('renders plugin tool commands and links separately from project scripts', async () => {
    useI18n().setLocale('en')
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    const groupId = '@acme/craft-hub-plugin-widget:widget'
    const toolCommand: CommandCapability = {
      ...dev,
      id: 'widget-dev',
      name: 'Widget Dev',
      source: 'plugin:@acme/craft-hub-plugin-widget@1.0.0',
      toolGroupId: groupId,
      invocation: { command: 'pnpm', args: ['exec', 'widget', 'dev'], cwd: '/workspace/example/apps/web', requiredEnv: [] },
    }
    const commandPackage = {
      ...dev.package!,
      toolGroups: [{ id: groupId, title: 'Widget tools', description: 'Develop and ship this widget.', source: toolCommand.source }],
      links: [{ id: 'widget-console', title: 'Widget console', url: 'https://widgets.example.com/console/widget-123', source: toolCommand.source, toolGroupId: groupId }],
    }
    store.projects = [project]
    store.selectedProjectId = project.id
    store.selectedPackagePath = 'apps/web'
    store.capabilities = [dev, toolCommand]
    store.commandPackagesByProject = { [project.id]: [{ name: 'example', relativePath: '.', root: true }, commandPackage] }
    store.projectOverview = { projectId: project.id, package: commandPackage, readme: { status: 'missing' } }
    const wrapper = mount(ProjectOverviewPanel, { global: { plugins: [pinia] } })

    const toolGroup = wrapper.get(`[data-testid="package-tool-group-${groupId}"]`)
    expect(toolGroup.text()).toContain('Widget tools')
    expect(toolGroup.text()).toContain('Widget Dev')
    expect(toolGroup.text()).toContain('Widget console')
    expect(wrapper.get('.overview-actions:not(.overview-tool-group)').text()).toContain('dev')

    await toolGroup.get('button').trigger('click')
    expect(store.selectedCapabilityId).toBe(toolCommand.id)
    expect(store.packageCapabilityDrawerOpen).toBe(true)
  })

  it('shows trust only in project details and revokes it without another confirmation', async () => {
    useI18n().setLocale('en')
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.commandPackagesByProject = { [project.id]: [{ name: 'example', relativePath: '.', root: true }] }
    store.projectOverview = {
      projectId: project.id,
      package: store.commandPackages[0]!,
      readme: { status: 'missing' },
    }
    const revokeProjectTrustById = vi.spyOn(store, 'revokeProjectTrustById').mockImplementation(async () => {
      store.projects = [{ ...project, trust: 'untrusted' }]
      return true
    })
    const wrapper = mount(ProjectOverviewPanel, { global: { plugins: [pinia] } })

    const trustSettings = wrapper.get('[data-testid="project-trust-settings"]')
    expect(trustSettings.text()).toContain('Trusted project')
    expect(trustSettings.text()).toContain(project.path)
    await trustSettings.get('[data-testid="revoke-project-trust"]').trigger('click')

    expect(revokeProjectTrustById).toHaveBeenCalledWith(project.id)
    expect(wrapper.text()).toContain('Project trust revoked')
    expect(wrapper.find('[data-testid="revoke-project-trust"]').exists()).toBe(false)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
})

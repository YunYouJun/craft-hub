import type { IntegrationContribution } from 'craft-hub'
import { describe, expect, it } from 'vitest'
import { classifyWorkbenchSection, isEnvironmentView } from './workbench-navigation'

describe('workbench navigation sections', () => {
  it.each([
    ['overview', 'home'],
    ['workbench', 'projects'],
    ['subscriptions', 'projects'],
    ['subscriptions-discover', 'projects'],
    ['subscriptions-new', 'projects'],
    ['subscriptions-preview', 'projects'],
    ['subscriptions-detail', 'projects'],
    ['tools', 'tools'],
    ['navigation', 'tools'],
    ['software', 'tools'],
    ['environment', 'environment'],
    ['workbenches', 'workbenches'],
    ['plugin-workbench', 'workbenches'],
    ['integration', 'workbenches'],
  ] as const)('keeps the %s route in the %s section', (routeName, section) => {
    expect(classifyWorkbenchSection(routeName)).toBe(section)
  })

  it.each(['marketplace', 'plugin-detail', 'diagnostics', 'settings', '', undefined, null, Symbol('route')])('leaves auxiliary routes outside the main sections', (routeName) => {
    expect(classifyWorkbenchSection(routeName)).toBeUndefined()
  })

  it('groups any provider with a configuration manager under development environment', () => {
    const view: IntegrationContribution['views'][number] = {
      id: 'settings',
      title: 'Configuration',
      icon: 'builtin:settings',
      placement: 'primary-sidebar',
      scope: 'global',
      blocks: [
        { id: 'connection', type: 'connection-status', actionId: 'status' },
        { id: 'configuration', type: 'configuration-manager', actionId: 'read' },
      ],
    }
    expect(isEnvironmentView(view)).toBe(true)
    expect(classifyWorkbenchSection('integration', view)).toBe('environment')
    expect(classifyWorkbenchSection('plugin-workbench', view)).toBe('workbenches')
  })

  it('keeps connection and resource views in workbenches', () => {
    const view = {
      blocks: [
        { id: 'connection', type: 'connection-status' as const, actionId: 'status' },
        { id: 'resources', type: 'resource-browser' as const, actionId: 'read' },
      ],
    }
    expect(isEnvironmentView(view)).toBe(false)
    expect(classifyWorkbenchSection('integration', view)).toBe('workbenches')
    expect(isEnvironmentView({ blocks: [] })).toBe(false)
    expect(isEnvironmentView()).toBe(false)
  })
})

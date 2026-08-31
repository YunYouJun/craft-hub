import type { InstalledIntegrationContribution, IntegrationProvider } from '../src/integrations'
import { describe, expect, it } from 'vitest'
import { integrationContributionSchema, IntegrationRegistry } from '../src/integrations'

function provider(overrides: Partial<IntegrationProvider> = {}): IntegrationProvider {
  return {
    id: 'example',
    apiVersion: '1.2.0',
    connectionStatus: async () => ({ connected: true }),
    workItems: {
      search: async () => ({ items: [] }),
      list: async () => ({ items: [] }),
    },
    ...overrides,
  }
}

function contribution(overrides: Partial<InstalledIntegrationContribution> = {}): InstalledIntegrationContribution {
  return {
    id: 'example-tools',
    pluginId: '@acme/craft-hub-plugin-example',
    source: 'plugin:@acme/craft-hub-plugin-example@1.0.0',
    provider: { id: 'example', requires: '^1.0.0' },
    actions: [
      {
        id: 'search',
        title: 'Search work items',
        operation: 'work-items.search',
        effect: 'remote-read',
        confirmation: 'never',
      },
    ],
    views: [{
      id: 'overview',
      title: 'Example',
      icon: 'i-lucide-box',
      placement: 'primary-sidebar',
      scope: 'project',
      blocks: [{ id: 'search', type: 'entity-search', actionId: 'search' }],
    }],
    ...overrides,
  }
}

describe('integration contracts', () => {
  it('validates action references in declarative views', () => {
    expect(() => integrationContributionSchema.parse({
      ...contribution(),
      views: [{ ...contribution().views[0], blocks: [{ id: 'missing', type: 'entity-list', actionId: 'missing' }] }],
    })).toThrow(/Unknown integration action/)
  })

  it('resolves compatible providers and enforces the host write-confirmation floor', () => {
    const registry = new IntegrationRegistry([provider({
      mergeRequests: {
        list: async () => ({ items: [] }),
        create: async () => ({ id: '1', title: 'Created' }),
      },
    })])
    const result = registry.resolve([contribution({
      actions: [{
        id: 'create-mr',
        title: 'Create merge request',
        operation: 'merge-requests.create',
        effect: 'remote-write',
        confirmation: 'never',
      }],
      views: [],
    })])

    expect(result.diagnostics).toEqual([])
    expect(result.integrations[0]?.actions[0]).toMatchObject({
      confirmation: 'never',
      effectiveConfirmation: 'risk-based',
    })
  })

  it('reports missing, incompatible, and incomplete providers without exposing broken integrations', () => {
    const missing = new IntegrationRegistry().resolve([contribution()])
    expect(missing.integrations).toEqual([])
    expect(missing.diagnostics[0]?.message).toMatch(/not available/)

    const incompatible = new IntegrationRegistry([provider({ apiVersion: '2.0.0' })]).resolve([contribution()])
    expect(incompatible.integrations).toEqual([])
    expect(incompatible.diagnostics[0]?.message).toMatch(/does not satisfy/)

    const incomplete = new IntegrationRegistry([provider({ workItems: undefined })]).resolve([contribution()])
    expect(incomplete.integrations).toEqual([])
    expect(incomplete.diagnostics[0]?.message).toMatch(/does not support work-items.search/)
  })
})

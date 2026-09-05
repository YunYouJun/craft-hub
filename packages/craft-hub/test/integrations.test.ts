import type { InstalledIntegrationContribution, IntegrationProvider } from '../src/integrations'
import { describe, expect, it } from 'vitest'
import { IntegrationConfirmationRequiredError, integrationContributionSchema, IntegrationRegistry } from '../src/integrations'

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

  it('rejects write operations disguised as remote reads', () => {
    expect(() => integrationContributionSchema.parse(contribution({
      actions: [{
        id: 'update-status',
        title: 'Update status',
        operation: 'work-items.update-status',
        effect: 'remote-read',
        confirmation: 'never',
      }],
      views: [],
    }))).toThrow(/must declare the remote-write effect/)
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

  it('resolves extended work-item and workspace operations only when the provider implements them', () => {
    const actions: InstalledIntegrationContribution['actions'] = [
      { id: 'get', title: 'Get work item', operation: 'work-items.get', effect: 'remote-read', confirmation: 'never' },
      { id: 'transitions', title: 'List transitions', operation: 'work-items.transitions', effect: 'remote-read', confirmation: 'never' },
      { id: 'update', title: 'Update status', operation: 'work-items.update-status', effect: 'remote-write', confirmation: 'always' },
      { id: 'workspace', title: 'Get workspace', operation: 'workspaces.get', effect: 'remote-read', confirmation: 'never' },
    ]
    const complete = new IntegrationRegistry([provider({
      workItems: {
        get: async () => ({ id: '1', title: 'Work item' }),
        search: async () => ({ items: [] }),
        list: async () => ({ items: [] }),
        transitions: async () => ({ currentStatus: 'open', transitions: [] }),
        updateStatus: async () => ({ id: '1', title: 'Work item', status: 'done' }),
      },
      workspaces: {
        get: async () => ({ id: '123', title: 'Workspace' }),
      },
    })]).resolve([contribution({ actions, views: [] })])

    expect(complete.diagnostics).toEqual([])
    expect(complete.integrations).toHaveLength(1)

    const incomplete = new IntegrationRegistry([provider()]).resolve([contribution({ actions, views: [] })])
    expect(incomplete.integrations).toEqual([])
    expect(incomplete.diagnostics[0]?.message).toMatch(/does not support work-items.get/)
  })

  it('dispatches declarative block input through the trusted provider', async () => {
    const queries: Record<string, unknown>[] = []
    const registry = new IntegrationRegistry([provider({
      workItems: {
        search: async (_context, query) => {
          queries.push(query)
          return { items: [{ id: 'todo-1', title: 'Review the proposal' }] }
        },
        list: async () => ({ items: [] }),
      },
    })])
    const resolved = registry.resolve([contribution()]).integrations[0]!

    await expect(registry.invoke({
      contribution: resolved,
      actionId: 'search',
      context: { projectId: 'project-1', projectPath: '/project' },
      input: { mode: 'assigned', limit: 60 },
    })).resolves.toEqual({ items: [{ id: 'todo-1', title: 'Review the proposal' }] })
    expect(queries).toEqual([{ mode: 'assigned', limit: 60, keyword: undefined, cursor: undefined }])
  })

  it('requires host-level confirmation before dispatching a remote write', async () => {
    let calls = 0
    let confirmedContext = false
    const registry = new IntegrationRegistry([provider({
      mergeRequests: {
        list: async () => ({ items: [] }),
        create: async (context) => {
          calls++
          confirmedContext = context.confirmed === true
          return { id: '1', title: 'Created' }
        },
      },
    })])
    const resolved = registry.resolve([contribution({
      actions: [{
        id: 'create',
        title: 'Create',
        operation: 'merge-requests.create',
        effect: 'remote-write',
        confirmation: 'always',
      }],
      views: [],
    })]).integrations[0]!

    await expect(
      registry.invoke({ contribution: resolved, actionId: 'create' }),
    )
      .rejects
      .toBeInstanceOf(IntegrationConfirmationRequiredError)
    expect(calls).toBe(0)
    await expect(
      registry.invoke({ contribution: resolved, actionId: 'create', confirmed: true }),
    )
      .resolves
      .toMatchObject({ id: '1' })
    expect(calls).toBe(1)
    expect(confirmedContext).toBe(true)
  })
})

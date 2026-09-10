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
  it('accepts status filtering only on readable entity blocks', () => {
    const declaration = contribution()
    declaration.views[0]!.blocks = [{ id: 'items', type: 'entity-list', actionId: 'list', statusFilter: 'active' }]
    // Use an existing read action from this fixture.
    declaration.views[0]!.blocks[0]!.actionId = declaration.actions.find(action => action.effect === 'remote-read')!.id
    expect(integrationContributionSchema.parse(declaration).views[0]?.blocks[0]?.statusFilter).toBe('active')
    declaration.views[0]!.blocks[0]!.type = 'connection-status'
    expect(() => integrationContributionSchema.parse(declaration)).toThrow(/Status filters require/)
  })

  it('accepts assignee filtering only on readable entity blocks', () => {
    const declaration = contribution()
    declaration.views[0]!.blocks = [{ id: 'items', type: 'entity-list', actionId: declaration.actions.find(action => action.effect === 'remote-read')!.id, assigneeFilter: 'current-user' }]
    expect(integrationContributionSchema.parse(declaration).views[0]?.blocks[0]?.assigneeFilter).toBe('current-user')
    declaration.views[0]!.blocks[0]!.type = 'connection-status'
    expect(() => integrationContributionSchema.parse(declaration)).toThrow(/Assignee filters require/)
  })

  it('rejects auto-loaded write blocks while accepting an explicit review form', () => {
    const declaration = contribution({
      actions: [{ id: 'create', title: 'Create review', operation: 'merge-requests.create', effect: 'remote-write', confirmation: 'always' }],
      views: [{ ...contribution().views[0]!, blocks: [{ id: 'create', type: 'entity-list', actionId: 'create' }] }],
    })
    expect(() => integrationContributionSchema.parse(declaration)).toThrow(/explicit action form/)
    declaration.views[0]!.blocks = [{ id: 'create', type: 'action-form', actionId: 'create', collapsible: true, requiresProject: true, fields: [{ id: 'sourceBranch', label: 'Source branch', type: 'text', required: true }] }]
    expect(integrationContributionSchema.parse(declaration).views[0]?.blocks[0]?.fields?.[0]?.required).toBe(true)
    expect(integrationContributionSchema.parse(declaration).views[0]?.blocks[0]).toMatchObject({ collapsible: true, requiresProject: true })
  })

  it('limits form presentation options to explicit action forms', () => {
    const declaration = contribution()
    declaration.views[0]!.blocks[0]!.collapsible = true
    expect(() => integrationContributionSchema.parse(declaration)).toThrow(/require an action form/)
  })

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

describe('connection setup', () => {
  const setup = () => contribution({ actions: [{ id: 'connect', title: 'Connect account', operation: 'connection.update', effect: 'local-write', confirmation: 'never' }], views: [] })

  it('rejects connection writes declared as reads and diagnoses unsupported providers', () => {
    expect(() => integrationContributionSchema.parse({ ...setup(), actions: [{ ...setup().actions[0], effect: 'remote-read' }] })).toThrow(/must declare local-write/)
    expect(new IntegrationRegistry([provider()]).resolve([setup()]).diagnostics[0]?.message).toContain('connection.update')
  })

  it('requires confirmation and binds a one-time callback to the original project', async () => {
    const completed: unknown[] = []
    const registry = new IntegrationRegistry([provider({ connection: {
      update: async () => ({ connected: false, authorizationUrl: 'https://example.com/oauth?state=random-state' }),
      complete: async (context, input) => {
        completed.push({ context, input })
        return { connected: true }
      },
    } })])
    const resolved = registry.resolve([setup()]).integrations[0]!
    await expect(registry.invoke({ contribution: resolved, actionId: 'connect' })).rejects.toBeInstanceOf(IntegrationConfirmationRequiredError)
    const context = { projectId: 'original', projectPath: '/project', callbackUrl: 'http://127.0.0.1:4318/api/integrations/example-tools/callback' }
    await registry.invoke({ contribution: resolved, actionId: 'connect', context, confirmed: true })
    await expect(registry.completeConnection(resolved, { state: 'unknown', code: 'code' })).rejects.toThrow(/invalid or expired/)
    await expect(registry.completeConnection({ ...resolved, id: 'other' }, { state: 'random-state', code: 'code' })).rejects.toThrow(/invalid or expired/)
    await registry.completeConnection(resolved, { state: 'random-state', code: 'code', projectId: 'attacker' })
    expect(completed).toEqual([{ context: { ...context, confirmed: true }, input: { state: 'random-state', code: 'code', projectId: 'attacker' } }])
    await expect(registry.completeConnection(resolved, { state: 'random-state', code: 'code' })).rejects.toThrow(/invalid or expired/)
  })
})

import type { InstalledIntegrationContribution, IntegrationEntity, IntegrationProvider } from '../src/integrations'
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
    expect(completed).toEqual([{ context: { ...context, integrationId: resolved.id, confirmed: true }, input: { state: 'random-state', code: 'code', projectId: 'attacker' } }])
    await expect(registry.completeConnection(resolved, { state: 'random-state', code: 'code' })).rejects.toThrow(/invalid or expired/)
  })
})

describe('work-item result boundary', () => {
  const ref = { providerId: 'example', instanceId: 'example-tools', accountId: 'account-1', containerId: 'list-1', kind: 'task', itemId: 'item-1' }
  const item: IntegrationEntity = {
    id: 'display-1',
    title: 'Review proposal',
    sourceRef: ref,
    personalMembership: { accountId: 'account-1', relation: 'owned' },
    dueDate: { dateTime: '2026-10-15T18:00:00', timeZone: 'UTC' },
    updatedAt: '2026-10-12T05:00:00Z',
  }
  const actions: InstalledIntegrationContribution['actions'] = [
    { id: 'get', title: 'Get work item', operation: 'work-items.get', effect: 'remote-read', confirmation: 'never' },
    { id: 'list', title: 'List work items', operation: 'work-items.list', effect: 'remote-read', confirmation: 'never' },
    { id: 'search', title: 'Search work items', operation: 'work-items.search', effect: 'remote-read', confirmation: 'never' },
  ]

  function setup(result: IntegrationEntity = item, pageFields: Record<string, unknown> = {}) {
    const page = { items: [result], currentUser: { id: 'account-1' }, ...pageFields }
    const registry = new IntegrationRegistry([provider({ workItems: { get: async () => result, search: async () => page, list: async () => page } })])
    return { registry, resolved: registry.resolve([contribution({ actions, views: [] })]).integrations[0]! }
  }

  it('supplies the actual host integration instance to reusable providers and overrides caller context', async () => {
    let instanceId: string | undefined
    const registry = new IntegrationRegistry([provider({ workItems: {
      search: async () => ({ items: [] }),
      list: async (context) => {
        instanceId = context.integrationId
        return { items: [{ ...item, sourceRef: { ...ref, instanceId: context.integrationId! } }] }
      },
    } })])
    const resolved = registry.resolve([contribution({ id: 'second-installation', actions: actions.filter(action => action.id === 'list'), views: [] })]).integrations[0]!
    const result = await registry.invoke({ contribution: resolved, actionId: 'list', context: { integrationId: 'forged-instance' }, input: { integrationId: 'forged-input' } })
    expect(instanceId).toBe('second-installation')
    expect(result).toMatchObject({ items: [{ sourceRef: { ...ref, instanceId: 'second-installation' } }] })
  })

  it.each(['get', 'list', 'search'])('validates source and presentation fields for %s without changing provider identities', async (actionId) => {
    const { registry, resolved } = setup(item, { nextCursor: 'opaque://native/page?value=1', coverage: 'partial', fetchedAt: '2026-10-12T06:00:00+01:00' })
    const result = await registry.invoke({ contribution: resolved, actionId })
    expect(result).toEqual(actionId === 'get'
      ? item
      : {
          items: [item],
          currentUser: { id: 'account-1' },
          nextCursor: 'opaque://native/page?value=1',
          coverage: 'partial',
          fetchedAt: '2026-10-12T06:00:00+01:00',
        })
    expect(item.id).toBe('display-1')
    expect(item.sourceRef?.itemId).toBe('item-1')
    expect(item.assignees).toBeUndefined()
  })

  it.each(['get', 'list', 'search'])('rejects a forged provider or integration instance from %s', async (actionId) => {
    for (const sourceRef of [{ ...ref, providerId: 'other' }, { ...ref, instanceId: 'other-tools' }]) {
      const { registry, resolved } = setup({ ...item, sourceRef })
      await expect(registry.invoke({ contribution: resolved, actionId })).rejects.toThrow(/provider and integration instance/)
    }
  })

  it('rejects invalid identities, membership, deadlines and page fields at the trusted adapter boundary', async () => {
    const invalidItems = [
      { ...item, sourceRef: { ...ref, containerId: 'list\nother' } },
      { ...item, personalMembership: { accountId: 'other-account', relation: 'owned' as const } },
      { ...item, dueDate: { dateTime: 'invalid', timeZone: 'UTC' } },
      { ...item, updatedAt: 'invalid' },
      { ...item, ancestors: [{ id: 'parent', title: 'Parent', sourceRef: { ...ref, instanceId: 'other-tools' } }] },
    ]
    for (const invalid of invalidItems) {
      const { registry, resolved } = setup(invalid)
      await expect(registry.invoke({ contribution: resolved, actionId: 'list' })).rejects.toThrow()
    }
    for (const fields of [{ coverage: 'all' }, { fetchedAt: 'yesterday' }, { nextCursor: 123 }]) {
      const { registry, resolved } = setup(item, fields)
      await expect(registry.invoke({ contribution: resolved, actionId: 'search' })).rejects.toThrow()
    }
  })

  it('validates updated work-item identities through the same boundary as reads', async () => {
    const registry = new IntegrationRegistry([provider({ workItems: {
      get: async () => item,
      search: async () => ({ items: [] }),
      list: async () => ({ items: [] }),
      updateStatus: async () => ({ ...item, sourceRef: { ...ref, instanceId: 'other-tools' } }),
    } })])
    const resolved = registry.resolve([contribution({ actions: [{ id: 'update', title: 'Update', operation: 'work-items.update-status', effect: 'remote-write', confirmation: 'always' }], views: [] })]).integrations[0]!
    await expect(registry.invoke({ contribution: resolved, actionId: 'update', confirmed: true })).rejects.toThrow(/provider and integration instance/)
  })

  it('retains legacy provider output without inventing source references, page coverage or membership', async () => {
    const legacy = { id: '1', title: 'Legacy task', assignees: [{ id: 'account-1' }] }
    const { registry, resolved } = setup(legacy)
    const result = await registry.invoke({ contribution: resolved, actionId: 'list' })
    expect(result).toEqual({ items: [legacy], currentUser: { id: 'account-1' } })
    expect(result).not.toHaveProperty('coverage')
    expect(legacy).not.toHaveProperty('sourceRef')
    expect(legacy).not.toHaveProperty('personalMembership')
  })

  it('keeps discovery side-effect free and does not confer project trust or execute writes during a read', async () => {
    let reads = 0
    let writes = 0
    let connections = 0
    const project = { id: 'project-1', name: 'Example', path: '/example', trust: 'untrusted' as const }
    const registry = new IntegrationRegistry([provider({
      connectionStatus: async () => {
        connections++
        return { connected: true }
      },
      workItems: {
        get: async () => item,
        search: async () => ({ items: [] }),
        list: async () => {
          reads++
          return { items: [item] }
        },
        updateStatus: async () => {
          writes++
          return item
        },
      },
    })])
    const resolved = registry.resolve([contribution({ actions, views: [] })]).integrations[0]!
    expect([reads, writes, connections]).toEqual([0, 0, 0])
    await registry.invoke({ contribution: resolved, actionId: 'list', context: { projectId: project.id, projectPath: project.path, projects: [project] } })
    expect([reads, writes, connections]).toEqual([1, 0, 0])
    expect(project.trust).toBe('untrusted')
  })
})

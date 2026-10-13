import type { IntegrationEntityPage, ResolvedIntegrationContribution } from 'craft-hub'
import { describe, expect, it } from 'vitest'
import { homeWorkSources, personalActiveWork, workHandoffText } from './personal-workbench'

function contribution(id = 'issues'): ResolvedIntegrationContribution {
  return {
    id,
    pluginId: `plugin-${id}`,
    source: `host:${id}`,
    provider: { id, requires: '^1.0.0' },
    providerVersion: '1.0.0',
    actions: [{ id: 'list', title: 'List work', operation: 'work-items.list', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' }],
    views: [{ id: 'my-work', title: 'My work', icon: 'builtin:list', placement: 'primary-sidebar', scope: 'global', blocks: [{ id: 'items', type: 'entity-list', actionId: 'list', input: { limit: 20 } }] }],
  }
}

describe('personal workbench data', () => {
  it('admits only global work-item reads that need neither a project nor confirmation', () => {
    const safe = contribution('safe')
    safe.views[0]!.scope = 'global-and-project'
    const write = contribution('write')
    write.actions[0]!.effect = 'remote-write'
    const confirmed = contribution('confirmed')
    confirmed.actions[0]!.effectiveConfirmation = 'always'
    const riskBased = contribution('risk-based')
    riskBased.actions[0]!.effectiveConfirmation = 'risk-based'
    const projectScope = contribution('project-scope')
    projectScope.views[0]!.scope = 'project'
    const projectRequired = contribution('project-required')
    projectRequired.views[0]!.blocks[0]!.requiresProject = true
    const search = contribution('search')
    search.actions[0]!.operation = 'work-items.search'

    expect(homeWorkSources([safe, write, confirmed, riskBased, projectScope, projectRequired, search], 'en').map(source => source.integrationId)).toEqual(['safe'])
  })

  it('deduplicates the same read across views without combining distinct inputs or providers', () => {
    const first = contribution('first')
    first.translations = { en: { myWork: 'My assigned work' } }
    first.views[0]!.title = 'myWork'
    first.views[0]!.blocks[0]!.input = { limit: 20, mode: 'assigned' }
    first.views.push({ ...first.views[0]!, id: 'another-view', blocks: [{ id: 'duplicate', type: 'entity-list', actionId: 'list', input: { mode: 'assigned', limit: 20 } }, { id: 'different-query', type: 'entity-list', actionId: 'list', input: { limit: 10 } }] })
    const second = contribution('second')

    const sources = homeWorkSources([first, second], 'en')

    expect(sources).toHaveLength(3)
    expect(sources[0]).toMatchObject({ integrationId: 'first', viewId: 'my-work', title: 'My assigned work', input: { limit: 20, mode: 'assigned', locale: 'en' } })
    expect(sources[1]).toMatchObject({ integrationId: 'first', input: { limit: 10, locale: 'en' } })
    expect(sources[2]).toMatchObject({ integrationId: 'second', input: { limit: 20 } })
    expect(new Set(sources.map(source => source.key)).size).toBe(3)
  })

  it('includes only connection checks that can run globally without confirmation or writes', () => {
    const safe = contribution('safe')
    safe.actions.push({ id: 'status', title: 'Connection', operation: 'connection.status', effect: 'local-read', confirmation: 'never', effectiveConfirmation: 'never' })
    safe.views[0]!.blocks.unshift({ id: 'connection', type: 'connection-status', actionId: 'status', input: { account: 'personal' } })
    expect(homeWorkSources([safe], 'zh-CN')[0]!.connection).toEqual({ actionId: 'status', input: { account: 'personal', locale: 'zh-CN' } })

    const confirmed = structuredClone(safe)
    confirmed.actions[1]!.effectiveConfirmation = 'always'
    const write = structuredClone(safe)
    write.actions[1]!.effect = 'local-write'
    const projectRequired = structuredClone(safe)
    projectRequired.views[0]!.blocks[0]!.requiresProject = true
    const missing = structuredClone(safe)
    missing.actions.pop()
    for (const source of [confirmed, write, projectRequired, missing])
      expect(homeWorkSources([source], 'en')[0]!.connection).toBeUndefined()
  })

  it('uses localized block titles for grouped lists and falls back to the action title', () => {
    const source = contribution()
    source.translations = { 'zh-CN': { 'My work': '我的工作', 'Project todos': '项目待办', 'Work items': '工作项' } }
    source.views[0]!.blocks[0]!.title = 'Project todos'
    source.actions.push({ ...source.actions[0]!, id: 'work-items', title: 'Work items' })
    source.views[0]!.blocks.push({ id: 'work-items', type: 'entity-list', actionId: 'work-items' })

    expect(homeWorkSources([source], 'zh-CN')).toMatchObject([
      { title: '我的工作', sectionTitle: '项目待办' },
      { title: '我的工作', sectionTitle: '工作项' },
    ])
  })

  it('requires an exact account ID and omits archived and terminal work', () => {
    const page: IntegrationEntityPage = {
      currentUser: { id: 'user-1', label: 'Alice' },
      items: [
        { id: 'active', title: 'Assigned work', statusCategory: 'active', assignees: [{ id: 'user-1' }] },
        { id: 'shared', title: 'Shared work', assignees: [{ id: 'user-2' }, { id: 'user-1' }] },
        { id: 'similar', title: 'Similar account ID', assignees: [{ id: 'user-10' }] },
        { id: 'label-only', title: 'Matching label only', assignees: [{ id: 'other', label: 'Alice' }] },
        { id: 'unassigned', title: 'Unassigned work' },
        { id: 'archive', title: 'Archived open work', archived: true, statusCategory: 'open', assignees: [{ id: 'user-1' }] },
        { id: 'resolved', title: 'Resolved work', statusCategory: 'resolved', assignees: [{ id: 'user-1' }] },
        { id: 'done', title: 'Completed work', status: 'Provider-specific state', statusCategory: 'done', assignees: [{ id: 'user-1' }] },
        { id: 'closed', title: 'Closed work', statusCategory: 'closed', assignees: [{ id: 'user-1' }] },
        { id: 'cancelled', title: 'Cancelled work', statusCategory: 'cancelled', assignees: [{ id: 'user-1' }] },
      ],
    }

    expect(personalActiveWork(page).map(item => item.id)).toEqual(['active', 'shared'])
    expect(personalActiveWork({ items: page.items })).toEqual([])
    expect(personalActiveWork({ ...page, currentUser: { id: '' } })).toEqual([])
  })

  it('deduplicates provider-local entities while retaining equal IDs from distinct workspaces or types', () => {
    const first = { id: '42', title: 'Workspace one task', assignees: [{ id: 'me' }], metadata: { workspaceId: 'one', type: 'task' } }
    const page: IntegrationEntityPage = {
      currentUser: { id: 'me' },
      items: [first, { ...first, title: 'Repeated task' }, { ...first, title: 'Workspace two task', metadata: { workspaceId: 'two', type: 'task' } }, { ...first, title: 'Workspace one defect', metadata: { workspaceId: 'one', type: 'defect' } }],
    }

    expect(personalActiveWork(page).map(item => item.title)).toEqual(['Workspace one task', 'Workspace two task', 'Workspace one defect'])
  })

  it('preserves provider identity and only includes a project explicitly selected for handoff', () => {
    const source = homeWorkSources([contribution('issues')], 'en')[0]!
    const work = { source, item: { id: '42', title: 'Fix navigation', url: 'https://example.com/items/42', statusLabel: 'In progress', metadata: { workspaceId: 'workspace-a', type: 'issue', projectId: 'not-a-local-binding', accessToken: 'must-not-copy' } } }
    const unbound = workHandoffText({ locale: 'en', work })
    expect(unbound).toContain('Source: My work (issues)')
    expect(unbound).toContain('workspaceId: workspace-a')
    expect(unbound).toContain('No project selected')
    expect(unbound).not.toContain('not-a-local-binding')
    expect(unbound).not.toContain('must-not-copy')
    const bound = workHandoffText({ locale: 'en', work, project: { id: 'local-project', name: 'Workbench', path: '/repos/workbench' }, objective: '  Keep old plugins compatible  ' })
    expect(bound).toContain('Local path: /repos/workbench')
    expect(bound).toContain('Objective:\nKeep old plugins compatible')
    expect(bound).toContain('confirm any status update in the original source')
  })

  it('omits credential-bearing or executable provider URLs from copied context', () => {
    const source = homeWorkSources([contribution()], 'en')[0]!
    for (const url of ['https://user:secret@example.com/', 'javascript:alert(1)', 'file:///private/path', 'invalid']) {
      const text = workHandoffText({ locale: 'zh-CN', work: { source, item: { id: '1', title: '事项', url } } })
      expect(text).not.toContain('原始链接')
      expect(text).not.toContain(url)
    }
  })
})

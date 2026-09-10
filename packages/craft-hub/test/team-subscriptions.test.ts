import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'

it('joins multiple isolated Teams, follows new revisions, and retains cached data on permission failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'team-sources-'))
  let revision = 'one'
  let denied = false
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), workspaceRepositoryProviders: [{
    id: 'fixture',
    name: 'Fixture',
    accepts: () => true,
    read: async (url) => {
      if (denied)
        throw new Error('Permission revoked')
      return { repository: url, branch: 'main', directory: '.craft-hub', revision, files: { 'source.json': JSON.stringify({ schemaVersion: 1, id: 'source', name: 'Shared Team', workspaces: [{ schemaVersion: 1, id: 'app', name: revision, members: [{ project: 'https://example.com/team/app' }] }] }) } }
    },
  }] })
  try {
    const first = await runtime.workspaceSubscriptions.joinTeam('https://example.com/one')
    const second = await runtime.workspaceSubscriptions.joinTeam('https://example.com/two')
    expect(first.id).not.toBe(second.id)
    expect((await runtime.workspaceSubscriptions.joinTeam('https://example.com/one')).id).toBe(first.id)
    expect(await runtime.ownerScopes.list()).toHaveLength(3)
    expect(await runtime.workspaces.list()).toHaveLength(0)
    const workspace = (await runtime.workspaces.list(first.id))[0]!
    expect(workspace.subscription).toMatchObject({ revision: 'one' })
    expect(workspace.members[0]?.resolved).toBe(false)
    expect(await runtime.projects.list()).toEqual([])
    await expect(runtime.workspaces.save({ manifest: workspace })).rejects.toThrow()
    revision = 'two'
    expect((await runtime.workspaceSubscriptions.followTeams()).every(item => !item.error)).toBe(true)
    expect((await runtime.workspaces.list(first.id))[0]).toMatchObject({ id: workspace.id, name: 'two', subscription: { revision: 'two' } })
    denied = true
    expect((await runtime.workspaceSubscriptions.followTeams())[0]?.error).toBe('Permission revoked')
    expect((await runtime.workspaces.list(first.id))[0]?.name).toBe('two')
    await runtime.workspaceSubscriptions.remove((await runtime.workspaceSubscriptions.list()).find(item => item.ownerScopeId === first.id)!.id)
    expect(await runtime.workspaces.list(second.id)).toHaveLength(1)
  }
  finally { await runtime.close() }
})

import { execFile } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'

const execFileAsync = promisify(execFile)

describe('team lifecycle', () => {
  it('renames by stable id and safely deletes all local scope state while retaining the Git snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-teams-'))
    const repositoryPath = join(root, 'shared')
    await execFileAsync('git', ['init', repositoryPath])
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const team = await runtime.teams.create({ name: 'Acme', repositoryPath })
    const workspace = await runtime.workspaces.create('Shared App', team.id)
    const group = await runtime.workspaces.createGroup('Products', team.id)
    await runtime.workspaces.assignGroup(workspace.id, group.id, team.id)
    await runtime.workspaces.updateUiState({ expandedWorkspaceIds: [workspace.id], selectedWorkspaceId: workspace.id }, team.id)

    await expect(runtime.teams.rename(team.id, 'Acme Platform')).resolves.toEqual({ ...team, name: 'Acme Platform' })
    await expect(runtime.teamGitSync.status(team.id)).resolves.toMatchObject({ state: 'local-ahead' })
    await expect(runtime.teams.delete(team.id, 'Acme')).rejects.toThrow('Type the Team name exactly')
    await expect(runtime.workspaces.list(team.id)).resolves.toHaveLength(1)

    const result = await runtime.teams.delete(team.id, 'Acme Platform')

    expect(result).toMatchObject({
      team: { id: team.id, name: 'Acme Platform' },
      deletedWorkspaceCount: 1,
      deletedGroupCount: 1,
    })
    expect(result.retainedSnapshotPath?.replaceAll('\\', '/')).toMatch(new RegExp(`shared/.craft-hub/teams/${team.id}/${team.id}\\.snapshot\\.json$`))
    await expect(readFile(result.retainedSnapshotPath!, 'utf8')).resolves.toContain(`"id": "${team.id}"`)
    await expect(runtime.ownerScopes.get(team.id)).rejects.toThrow('Unknown owner scope')
    await expect(runtime.workspaces.list(team.id)).resolves.toEqual([])
    await expect(runtime.workspaces.groups(team.id)).resolves.toEqual([])
    await expect(runtime.workspaces.uiState(team.id)).resolves.toEqual({ expandedWorkspaceIds: [], selectedWorkspaceId: undefined, selectedProjectId: undefined })
  })
})

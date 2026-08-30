import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { CraftHubStore, OwnerScopeService, ProjectRegistry, TeamGitSyncService, WorkspaceService } from '../src/index'

const execFileAsync = promisify(execFile)

describe('team Git sync', () => {
  it('writes only the selected Team snapshot and keeps Personal workspaces isolated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-team-sync-'))
    const repositoryPath = join(root, 'shared')
    await execFileAsync('git', ['init', repositoryPath])
    const dataDir = join(root, 'data')
    const configDir = join(root, 'config')
    const projectPath = join(root, 'project')
    await mkdir(projectPath)
    const store = new CraftHubStore(dataDir)
    const projects = new ProjectRegistry(store)
    const project = await projects.add(projectPath)
    const scopes = new OwnerScopeService(configDir, dataDir)
    const workspaces = new WorkspaceService(configDir, dataDir, projects)
    const team = await scopes.createTeam('Acme')
    await workspaces.create('Personal App')
    const teamWorkspace = await workspaces.create('Shared App', team.id)
    await workspaces.addProject(teamWorkspace.id, project.id, team.id)
    const sync = new TeamGitSyncService(dataDir, scopes, workspaces)

    await expect(sync.configure(team.id, { repositoryPath })).resolves.toMatchObject({ ownerScopeId: team.id, state: 'local-ahead' })
    await expect(sync.synchronize(team.id)).resolves.toMatchObject({ state: 'clean' })
    const snapshot = JSON.parse(await readFile(join(repositoryPath, '.craft-hub', 'teams', team.id, `${team.id}.snapshot.json`), 'utf8')) as { ownerScope: { id: string }, workspaces: { workspaces: Array<{ name: string }> } }
    expect(snapshot.ownerScope.id).toBe(team.id)
    expect(snapshot.workspaces.workspaces.map(workspace => workspace.name)).toEqual(['Shared App'])
    await expect(workspaces.list()).resolves.toMatchObject([{ name: 'Personal App' }])
  })

  it('does not allow Personal to use Team synchronization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-team-sync-'))
    const dataDir = join(root, 'data')
    const configDir = join(root, 'config')
    const store = new CraftHubStore(dataDir)
    const scopes = new OwnerScopeService(configDir, dataDir)
    const workspaces = new WorkspaceService(configDir, dataDir, new ProjectRegistry(store))
    const sync = new TeamGitSyncService(dataDir, scopes, workspaces)

    await expect(sync.status('personal')).rejects.toThrow('requires a Team')
  })

  it('rejects a sync directory that resolves outside the repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-team-sync-'))
    const repositoryPath = join(root, 'shared')
    const outside = join(root, 'outside')
    await Promise.all([
      execFileAsync('git', ['init', repositoryPath]),
      mkdir(join(outside, 'craft-hub'), { recursive: true }),
    ])
    await symlink(outside, join(repositoryPath, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const dataDir = join(root, 'data')
    const configDir = join(root, 'config')
    const scopes = new OwnerScopeService(configDir, dataDir)
    const team = await scopes.createTeam('Acme')
    const sync = new TeamGitSyncService(dataDir, scopes, new WorkspaceService(configDir, dataDir, new ProjectRegistry(new CraftHubStore(dataDir))))

    await expect(sync.configure(team.id, { repositoryPath, directory: 'linked/craft-hub' })).rejects.toThrow('outside the selected repository')
  })
})

import type { AgentTaskProvider } from '../src/agent-tasks'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentTaskManager, CraftHubStore, ProjectRegistry, WorkspaceConflictError, WorkspaceService } from '../src/index'

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-workspaces-'))
  const dataDir = join(root, 'data')
  const configDir = join(root, 'config')
  const projectPath = join(root, 'project')
  await mkdir(projectPath)
  const store = new CraftHubStore(dataDir)
  const projects = new ProjectRegistry(store)
  const project = await projects.add(projectPath)
  return { configDir, dataDir, project, projects, root, store, workspaces: new WorkspaceService(configDir, dataDir, projects) }
}

describe('portable workspaces', () => {
  it('isolates Personal and Team workspaces, groups, project grouping, and UI state', async () => {
    const fixture = await setup()
    const personal = await fixture.workspaces.create('Personal App')
    const personalGroup = await fixture.workspaces.createGroup('Personal Group')
    const team = await fixture.workspaces.create('Team App', 'tencent')
    const teamGroup = await fixture.workspaces.createGroup('Team Group', 'tencent')
    const workspaceProjectPath = join(fixture.root, 'workspace-project')
    await mkdir(workspaceProjectPath)
    const workspaceProject = await fixture.projects.add(workspaceProjectPath)

    await fixture.workspaces.assignGroup(personal.id, personalGroup.id, 'personal')
    await fixture.workspaces.assignGroup(team.id, teamGroup.id, 'tencent')
    await fixture.workspaces.addProject(team.id, workspaceProject.id, 'tencent')
    await fixture.workspaces.assignProjectGroup(fixture.project.id, teamGroup.id, 'tencent')
    await fixture.workspaces.updateUiState({ expandedWorkspaceIds: [team.id], selectedWorkspaceId: team.id }, 'tencent')

    await expect(fixture.workspaces.list()).resolves.toMatchObject([{ id: personal.id, ownerScopeId: 'personal' }])
    await expect(fixture.workspaces.list('tencent')).resolves.toMatchObject([{ id: team.id, ownerScopeId: 'tencent' }])
    await expect(fixture.workspaces.groups()).resolves.toMatchObject([{ id: personalGroup.id }])
    await expect(fixture.workspaces.groups('tencent')).resolves.toMatchObject([{ id: teamGroup.id, ownerScopeId: 'tencent' }])
    await expect(fixture.workspaces.projectGroupAssignments()).resolves.toEqual({})
    await expect(fixture.workspaces.projectGroupAssignments('tencent')).resolves.toEqual({ [fixture.project.id]: teamGroup.id })
    await expect(fixture.workspaces.projectOwnerScopes(['personal', 'tencent'])).resolves.toEqual({
      [fixture.project.id]: ['tencent'],
      [workspaceProject.id]: ['tencent'],
    })
    await expect(fixture.workspaces.uiState()).resolves.toEqual({ expandedWorkspaceIds: [] })
    await expect(fixture.workspaces.uiState('tencent')).resolves.toEqual({ expandedWorkspaceIds: [team.id], selectedWorkspaceId: team.id })
    await expect(fixture.workspaces.assignGroup(team.id, personalGroup.id, 'tencent')).rejects.toThrow('same owner scope')
    await expect(fixture.workspaces.get(team.id, 'personal')).rejects.toThrow('does not belong')
  })

  it('treats legacy manifests and groups without an owner scope as Personal', async () => {
    const fixture = await setup()
    const workspace = await fixture.workspaces.create('Legacy')
    const group = await fixture.workspaces.createGroup('Legacy Group')

    expect(workspace.ownerScopeId).toBe('personal')
    expect(group.ownerScopeId).toBeUndefined()
    await expect(fixture.workspaces.list('personal')).resolves.toHaveLength(1)
    await expect(fixture.workspaces.list('team')).resolves.toEqual([])
  })

  it('rejects a Team snapshot whose group id belongs to another owner scope', async () => {
    const fixture = await setup()
    const personalGroup = await fixture.workspaces.createGroup('Shared')

    await expect(fixture.workspaces.replacePortableSnapshot({
      schemaVersion: 1,
      workspaces: [],
      workspaceOrder: [],
      groups: [{ id: personalGroup.id, name: 'Foreign group' }],
      workspaceGroups: {},
    }, 'tencent')).rejects.toThrow('belongs to another owner scope')
    await expect(fixture.workspaces.groups()).resolves.toHaveLength(1)
    await expect(fixture.workspaces.groups('tencent')).resolves.toEqual([])
  })
  it('owns editable groups separately from workspace manifests', async () => {
    const fixture = await setup()
    const workspace = await fixture.workspaces.create('Grouped')
    const group = await fixture.workspaces.createGroup('Cover')

    await expect(fixture.workspaces.assignGroup(workspace.id, group.id)).resolves.toMatchObject({ groupId: group.id })
    await expect(fixture.workspaces.assignProjectGroup(fixture.project.id, group.id)).resolves.toEqual({ [fixture.project.id]: group.id })
    await expect(fixture.workspaces.setGroupIcon(group.id, 'emoji:🧧')).resolves.toEqual({ id: group.id, name: 'Cover', icon: 'emoji:🧧' })
    await expect(fixture.workspaces.renameGroup(group.id, 'Cover Hub')).resolves.toEqual({ id: group.id, name: 'Cover Hub', icon: 'emoji:🧧' })
    expect(await readFile(join(fixture.configDir, 'config.yaml'), 'utf8')).toContain('icon: emoji:🧧')
    expect(await readFile(join(fixture.configDir, 'workspaces', 'grouped.yaml'), 'utf8')).not.toContain(group.id)

    await fixture.workspaces.deleteGroup(group.id)
    await expect(fixture.workspaces.list()).resolves.toEqual([expect.objectContaining({ id: workspace.id, groupId: undefined })])
    await expect(fixture.workspaces.projectGroupAssignments()).resolves.toEqual({})
  })

  it('keeps portable membership separate from machine-local project bindings', async () => {
    const fixture = await setup()
    const created = await fixture.workspaces.create('My Workspace')
    const workspace = await fixture.workspaces.addProject(created.id, fixture.project.id)

    expect(workspace.primaryProject).toBe('project')
    expect(workspace.members).toEqual([{ project: 'project', projectId: fixture.project.id, resolved: true }])
    const manifest = await readFile(join(fixture.configDir, 'workspaces', 'my-workspace.yaml'), 'utf8')
    expect(manifest).toContain('project: project')
    expect(manifest).not.toContain(fixture.project.path)
    expect(manifest).not.toContain(fixture.project.id)
  })

  it('detects concurrent manifest updates by revision', async () => {
    const fixture = await setup()
    const workspace = await fixture.workspaces.create('Conflict')
    const manifest = { schemaVersion: 1 as const, id: workspace.id, name: 'Changed', members: [] }
    await fixture.workspaces.save({ manifest, revision: workspace.revision })
    await expect(fixture.workspaces.save({ manifest: { ...manifest, name: 'Stale' }, revision: workspace.revision }))
      .rejects
      .toBeInstanceOf(WorkspaceConflictError)
  })

  it('persists portable workspace visual metadata', async () => {
    const fixture = await setup()
    const workspace = await fixture.workspaces.create('Visual')
    const saved = await fixture.workspaces.save({
      manifest: {
        schemaVersion: 1,
        id: workspace.id,
        name: workspace.name,
        icon: 'emoji:🎨',
        color: 'purple',
        members: [],
      },
      revision: workspace.revision,
    })

    expect(saved).toMatchObject({ icon: 'emoji:🎨', color: 'purple' })
    const manifest = await readFile(join(fixture.configDir, 'workspaces', 'visual.yaml'), 'utf8')
    expect(manifest).toContain('icon: emoji:🎨')
    expect(manifest).toContain('color: purple')
  })

  it('stores a workspace-scoped project label without changing the project name', async () => {
    const fixture = await setup()
    const created = await fixture.workspaces.create('Localized labels')
    const workspace = await fixture.workspaces.addProject(created.id, fixture.project.id)
    const member = workspace.members[0]!
    const saved = await fixture.workspaces.save({
      manifest: {
        schemaVersion: 1,
        id: workspace.id,
        name: workspace.name,
        members: [{ project: member.project, label: '中文项目' }],
        primaryProject: member.project,
      },
      revision: workspace.revision,
    })

    expect(saved.members[0]).toMatchObject({ label: '中文项目', projectId: fixture.project.id })
    expect((await fixture.projects.get(fixture.project.id)).name).toBe('project')
  })

  it('removes unresolved members by portable project key', async () => {
    const fixture = await setup()
    const workspace = await fixture.workspaces.create('Unresolved')
    const withMissing = await fixture.workspaces.save({
      manifest: {
        schemaVersion: 1,
        id: workspace.id,
        name: workspace.name,
        primaryProject: 'missing-project',
        members: [{ project: 'missing-project' }],
      },
      revision: workspace.revision,
    })

    const removed = await fixture.workspaces.removeProject(workspace.id, 'missing-project')
    expect(removed.members).toEqual([])
    expect(removed.primaryProject).toBeUndefined()
    expect(withMissing.members[0]).toMatchObject({ project: 'missing-project', resolved: false })
  })

  it('stores navigation state with local bindings instead of portable manifests', async () => {
    const fixture = await setup()
    const workspace = await fixture.workspaces.create('Navigation')
    await fixture.workspaces.updateUiState({
      expandedWorkspaceIds: [workspace.id, workspace.id],
      selectedWorkspaceId: workspace.id,
    })

    await expect(fixture.workspaces.uiState()).resolves.toEqual({
      expandedWorkspaceIds: [workspace.id],
      selectedWorkspaceId: workspace.id,
      selectedProjectId: undefined,
    })
    expect(await readFile(join(fixture.configDir, 'workspaces', 'navigation.yaml'), 'utf8')).not.toContain('selectedWorkspace')
  })

  it('exports portable state without paths, bindings, trust, or UI state', async () => {
    const fixture = await setup()
    const workspace = await fixture.workspaces.create('Cloud')
    await fixture.workspaces.addProject(workspace.id, fixture.project.id)
    await fixture.projects.setTrust(fixture.project.id, 'trusted')
    await fixture.workspaces.updateUiState({ expandedWorkspaceIds: [workspace.id], selectedProjectId: fixture.project.id })

    const snapshot = await fixture.workspaces.portableSnapshot()
    const serialized = JSON.stringify(snapshot)
    expect(snapshot).toMatchObject({ schemaVersion: 1, workspaceOrder: [workspace.id] })
    expect(snapshot.workspaces[0]?.members[0]).toEqual({ project: 'project' })
    expect(serialized).not.toContain(fixture.project.path)
    expect(serialized).not.toContain(fixture.project.id)
    expect(serialized).not.toContain('trusted')
    expect(serialized).not.toContain('selectedProject')
    await expect(fixture.workspaces.resolveProjectKey('project')).resolves.toBe(fixture.project.id)
    await expect(fixture.workspaces.resolveProjectKey('missing')).resolves.toBeUndefined()
  })
})

describe('agent tasks', () => {
  it('passes a trusted primary cwd and additional project roots to the provider', async () => {
    const fixture = await setup()
    const secondPath = join(fixture.root, 'second')
    await mkdir(secondPath)
    const second = await fixture.projects.add(secondPath)
    await fixture.projects.setTrust(fixture.project.id, 'trusted')
    await fixture.projects.setTrust(second.id, 'trusted')
    const run = vi.fn<AgentTaskProvider['run']>(async (input) => {
      await input.onThread('123e4567-e89b-42d3-a456-426614174000')
      return { finalResponse: 'done' }
    })
    const manager = new AgentTaskManager(fixture.store, fixture.projects, { id: 'codex', run })
    const task = await manager.start({
      prompt: 'Update both projects',
      projectIds: [fixture.project.id, second.id],
      primaryProjectId: fixture.project.id,
    })
    await vi.waitFor(async () => expect((await fixture.store.getAgentTask(task.id))?.status).toBe('completed'))

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      primaryProjectPath: fixture.project.path,
      projectPaths: [fixture.project.path, second.path],
    }))
    expect((await fixture.store.getAgentTask(task.id))?.externalThreadId).toBe('123e4567-e89b-42d3-a456-426614174000')
  })

  it('rejects tasks that include an untrusted project', async () => {
    const fixture = await setup()
    const manager = new AgentTaskManager(fixture.store, fixture.projects, { id: 'codex', run: vi.fn() })
    await expect(manager.start({ prompt: 'Change it', projectIds: [fixture.project.id], primaryProjectId: fixture.project.id }))
      .rejects
      .toThrow('Trust every selected project')
  })
})

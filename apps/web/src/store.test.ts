// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { Capability, CommandCapability, ProjectRecord, RunRecord, WorkspaceManifest } from 'craft-hub'
import { projectConfigSchemaRevision } from 'craft-hub'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbenchStore } from './store'

const project: ProjectRecord = {
  id: 'project',
  name: 'Project',
  path: '/project',
  trust: 'untrusted',
  addedAt: '2026-01-01T00:00:00.000Z',
}

function skill(id: string, description: string): Capability {
  return {
    id,
    kind: 'skill',
    name: 'release',
    description,
    source: 'agent-skill',
    path: '/project/.agents/skills/release/SKILL.md',
    contentHash: id,
    content: description,
  }
}

describe('workbench refresh', () => {
  let capabilities: Capability[]
  let projectRequests: number
  let capabilityRequests: number

  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
    capabilities = [skill('skill-old', 'Old description')]
    projectRequests = 0
    capabilityRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/projects')
        projectRequests += 1
      else if (path.endsWith('/capability-discovery'))
        capabilityRequests += 1
      const body = path === '/api/projects'
        ? [project]
        : path.includes('/agent-actions')
          ? []
          : path.endsWith('/pins')
            ? { projectId: project.id, capabilityIds: [] }
            : capabilities
      return new Response(JSON.stringify(body), { status: 200 })
    }))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('refreshes changed files while keeping the logical capability selected', async () => {
    const store = useWorkbenchStore()
    await store.loadProjects()
    store.selectedCapabilityId = 'skill-old'
    capabilities = [skill('skill-new', 'Updated description')]

    await expect(store.refreshProject({ projectId: 'project', scopes: ['capabilities'] })).resolves.toBe(true)

    expect(store.selectedCapabilityId).toBe('skill-new')
    expect(store.selectedCapability?.description).toBe('Updated description')
    expect(store.recentlyUpdated).toBe(true)
    expect(projectRequests).toBe(1)
    expect(capabilityRequests).toBe(2)
  })

  it('coalesces concurrent full refresh requests', async () => {
    let releaseProjects!: () => void
    const projectsReady = new Promise<void>((resolve) => {
      releaseProjects = resolve
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/projects') {
        projectRequests += 1
        await projectsReady
        return new Response(JSON.stringify([project]), { status: 200 })
      }
      if (path.includes('/agent-actions'))
        return new Response(JSON.stringify([]), { status: 200 })
      if (path.endsWith('/pins'))
        return new Response(JSON.stringify({ projectId: project.id, capabilityIds: [] }), { status: 200 })
      return new Response(JSON.stringify({ capabilities, diagnostics: [] }), { status: 200 })
    }))
    const store = useWorkbenchStore()

    const first = store.refreshProjects()
    const second = store.refreshProjects()
    await Promise.resolve()

    expect(projectRequests).toBe(1)

    releaseProjects()
    await Promise.all([first, second])
    expect(projectRequests).toBe(1)
  })

  it('persists the most recently selected project for the quick switcher', async () => {
    const store = useWorkbenchStore()
    await store.loadProjects()

    expect(store.recentProjectIds).toEqual(['project'])
    expect(window.localStorage.getItem('craft-hub-recent-projects')).toBe('["project"]')

    setActivePinia(createPinia())
    expect(useWorkbenchStore().recentProjectIds).toEqual(['project'])
  })

  it('keeps the last successful project catalog when a refresh fails', async () => {
    const store = useWorkbenchStore()
    await store.loadProjects()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'runtime unavailable' }), { status: 500 })))

    await expect(store.refreshProjects()).rejects.toThrow('runtime unavailable')

    expect(store.projects).toEqual([project])
    expect(store.projectsLoadState).toBe('error')
    expect(store.projectsLoadError).toBe('runtime unavailable')
  })

  it('loads project-local configuration diagnostics without dropping the project', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/projects') {
        return new Response(JSON.stringify({
          projects: [project],
          diagnostics: [{
            projectId: project.id,
            source: 'project-config',
            targetPath: '.craft-hub/project.jsonc',
            path: '/unknown',
            line: 3,
            column: 14,
            message: 'Unrecognized key: "unknown"',
          }],
        }), { status: 200 })
      }
      if (path.includes('/agent-actions'))
        return new Response(JSON.stringify([]), { status: 200 })
      if (path.endsWith('/pins'))
        return new Response(JSON.stringify({ projectId: project.id, capabilityIds: [] }), { status: 200 })
      return new Response(JSON.stringify({ capabilities, diagnostics: [] }), { status: 200 })
    }))
    const store = useWorkbenchStore()

    await store.loadProjects()

    expect(store.projects).toEqual([project])
    expect(store.projectCatalogDiagnostics).toEqual([
      expect.objectContaining({ projectId: project.id, line: 3, path: '/unknown' }),
    ])
    expect(store.selectedProjectDiagnostics).toHaveLength(1)
  })

  it('reports a stale Runtime schema while retaining the project catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/health')
        return new Response(JSON.stringify({ status: 'ok', projectConfigSchemaRevision: 'sha256:old' }), { status: 200 })
      if (path === '/api/projects')
        return new Response(JSON.stringify({ projects: [project], diagnostics: [] }), { status: 200 })
      if (path.includes('/agent-actions'))
        return new Response(JSON.stringify([]), { status: 200 })
      if (path.endsWith('/pins'))
        return new Response(JSON.stringify({ projectId: project.id, capabilityIds: [] }), { status: 200 })
      return new Response(JSON.stringify({ capabilities, diagnostics: [] }), { status: 200 })
    }))
    const store = useWorkbenchStore()

    await store.loadProjects()

    expect(store.projects).toEqual([project])
    expect(store.runtimeSchemaMismatch).toEqual({
      actual: 'sha256:old',
      expected: projectConfigSchemaRevision,
    })
  })

  it('keeps workspace projects available when another project capability scan fails', async () => {
    const brokenProject = { ...project, id: 'broken', name: 'Broken', path: '/broken' }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/projects')
        return new Response(JSON.stringify([project, brokenProject]), { status: 200 })
      if (path.includes('/agent-actions'))
        return new Response(JSON.stringify([]), { status: 200 })
      if (path.includes('/projects/broken/'))
        return new Response(JSON.stringify({ error: 'broken workspace metadata' }), { status: 500 })
      if (path.endsWith('/pins'))
        return new Response(JSON.stringify({ projectId: project.id, capabilityIds: [] }), { status: 200 })
      return new Response(JSON.stringify({ capabilities, diagnostics: [] }), { status: 200 })
    }))
    const store = useWorkbenchStore()
    store.workspaces = [{
      schemaVersion: 1,
      id: 'workspace',
      name: 'Workspace',
      members: [{ project: 'project', projectId: project.id, resolved: true }],
      revision: 'revision',
    }]

    await expect(store.loadProjects()).resolves.toBeUndefined()

    expect(store.projects.map(item => item.id)).toEqual(['project', 'broken'])
    expect(store.workspaceProjects(store.workspaces[0]!)).toEqual([project])
  })

  it('keeps the active workspace selected across a full project refresh', async () => {
    const store = useWorkbenchStore()
    store.projects = [project]
    store.workspaces = [{
      schemaVersion: 1,
      id: 'workspace',
      name: 'Workspace',
      members: [{ project: 'project', projectId: project.id, resolved: true }],
      revision: 'revision',
    }]
    store.selectedWorkspaceId = 'workspace'
    store.selectedProjectId = ''

    await store.refreshProjects()

    expect(store.selectedWorkspace?.id).toBe('workspace')
    expect(store.selectedProjectId).toBe('')
    expect(store.selectedProject).toBeUndefined()
    expect(store.paletteItems.map(item => item.project.id)).toEqual([project.id])
  })

  it('falls back to the first project when a stale workspace selection no longer resolves', async () => {
    const store = useWorkbenchStore()
    store.selectedWorkspaceId = 'deleted-workspace'

    await store.refreshProjects()

    expect(store.selectedWorkspace).toBeUndefined()
    expect(store.selectedProject?.id).toBe(project.id)
  })

  it('migrates the legacy locale only when the file has no explicit locale', async () => {
    window.localStorage.setItem('craft-hub-locale', 'zh-CN')
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/settings' && init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toMatchObject({ settings: { 'workbench.locale': 'zh-CN' } })
        return new Response(JSON.stringify({
          explicitKeys: ['workbench.locale'],
          path: '/settings.json',
          revision: 'updated',
          settings: { 'workbench.locale': 'zh-CN', 'workbench.theme': 'system' },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        explicitKeys: [],
        path: '/settings.json',
        revision: 'initial',
        settings: { 'workbench.locale': 'en', 'workbench.theme': 'system' },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = useWorkbenchStore()
    await store.loadSettings()

    expect(store.settings?.settings['workbench.locale']).toBe('zh-CN')
    expect(window.localStorage.getItem('craft-hub-locale')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refreshes localized capabilities after the locale changes', async () => {
    let locale: 'en' | 'zh-CN' = 'en'
    let capabilityRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/settings' && init?.method === 'PATCH') {
        locale = 'zh-CN'
        return new Response(JSON.stringify({
          explicitKeys: ['workbench.locale'],
          path: '/settings.json',
          revision: 'zh-CN',
          settings: { 'workbench.locale': locale, 'workbench.theme': 'system' },
        }), { status: 200 })
      }
      if (path === '/api/settings') {
        return new Response(JSON.stringify({
          explicitKeys: [],
          path: '/settings.json',
          revision: 'en',
          settings: { 'workbench.locale': locale, 'workbench.theme': 'system' },
        }), { status: 200 })
      }
      if (path === '/api/projects')
        return new Response(JSON.stringify([project]), { status: 200 })
      if (path === '/api/health')
        return new Response(JSON.stringify([]), { status: 200 })
      if (path.endsWith('/pins'))
        return new Response(JSON.stringify({ projectId: project.id, capabilityIds: [] }), { status: 200 })
      if (path.includes('/agent-actions'))
        return new Response(JSON.stringify([]), { status: 200 })
      if (path.includes('/overview?')) {
        return new Response(JSON.stringify({
          projectId: project.id,
          package: { name: project.name, relativePath: '.', root: true },
          readme: { status: 'missing' },
        }), { status: 200 })
      }
      capabilityRequests += 1
      return new Response(JSON.stringify([skill('release', locale === 'zh-CN' ? '准备安全发布。' : 'Prepare a safe release.')]), { status: 200 })
    }))

    const store = useWorkbenchStore()
    await store.loadSettings()
    await store.loadProjects()
    expect(store.selectedCapabilityId).toBe('')
    store.selectedCapabilityId = 'release'
    expect(store.selectedCapability?.description).toBe('Prepare a safe release.')

    await store.updateLocale('zh-CN')

    expect(store.selectedCapability?.description).toBe('准备安全发布。')
    expect(capabilityRequests).toBe(2)
  })

  it('derives first-run progress from projects, command selection, trust, and successful runs', () => {
    const store = useWorkbenchStore()
    expect(store.firstRunStage).toBe('add-project')

    store.projects = [project]
    store.selectedProjectId = project.id
    expect(store.firstRunStage).toBe('no-capabilities')

    const command: CommandCapability = {
      id: 'test',
      kind: 'command',
      name: 'test',
      source: 'package.json',
      invocation: { command: 'pnpm', args: ['run', 'test'], cwd: project.path, requiredEnv: [] },
    }
    store.capabilities = [command]
    expect(store.firstRunStage).toBe('select-command')

    store.selectedCapabilityId = command.id
    expect(store.firstRunStage).toBe('trust')

    store.projects = [{ ...project, trust: 'trusted' }]
    expect(store.firstRunStage).toBe('run')

    store.runs = [{
      id: 'completed',
      projectId: project.id,
      capabilityId: command.id,
      command: 'pnpm',
      args: ['run', 'test'],
      cwd: project.path,
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      exitCode: 0,
      stdout: 'ok\n',
      stderr: '',
      status: 'completed',
    }]
    expect(store.firstRunStage).toBe('complete')
    expect(store.projectRuns).toHaveLength(1)
  })

  it('loads persisted runs and reopens their output', async () => {
    const persisted: RunRecord = {
      id: 'persisted',
      projectId: project.id,
      capabilityId: 'test',
      command: 'pnpm',
      args: ['run', 'test'],
      cwd: project.path,
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      exitCode: 0,
      stdout: 'persisted output\n',
      stderr: '',
      status: 'completed',
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([persisted]), { status: 200 })))
    const store = useWorkbenchStore()

    await store.loadRuns()
    store.openRun(persisted)

    expect(store.runs).toEqual([persisted])
    expect(store.run).toEqual(persisted)
    expect(store.terminalVisible).toBe(true)
  })

  it('persists pin toggles in project order without using portable settings', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBe('/api/projects/project/pins')
      expect(init?.method).toBe('PUT')
      expect(JSON.parse(String(init?.body))).toEqual({ capabilityIds: ['first', 'second'] })
      return new Response(JSON.stringify({ projectId: 'project', capabilityIds: ['first', 'second'] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = useWorkbenchStore()
    store.capabilityPinsByProject = { project: ['first'] }

    await expect(store.toggleCapabilityPin('second', 'project')).resolves.toBe(true)

    expect(store.capabilityPinsByProject.project).toEqual(['first', 'second'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('updates the active run while command output is still streaming', async () => {
    const trustedProject = { ...project, trust: 'trusted' as const }
    const command: CommandCapability = {
      id: 'command',
      kind: 'command',
      name: 'dev',
      source: 'package.json',
      invocation: { command: 'pnpm', args: ['run', 'dev'], cwd: project.path, requiredEnv: [] },
    }
    const running: RunRecord = {
      id: 'run',
      projectId: project.id,
      capabilityId: command.id,
      command: 'pnpm',
      args: ['run', 'dev'],
      cwd: project.path,
      startedAt: '2026-01-01T00:00:00.000Z',
      stdout: '',
      stderr: '',
      status: 'running',
    }
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'start', run: running })}\n`))
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'output', stream: 'stdout', chunk: 'server-ready\n' })}\n`))
      },
    }), { headers: { 'content-type': 'application/x-ndjson' } })))

    const store = useWorkbenchStore()
    store.projects = [trustedProject]
    store.selectedProjectId = trustedProject.id
    store.capabilities = [command]
    store.selectedCapabilityId = command.id

    const completion = store.runSelected()
    await vi.waitFor(() => {
      expect(store.busy).toBe(true)
      expect(store.run?.status).toBe('running')
      expect(store.run?.stdout).toBe('server-ready\n')
    })

    const completed = { ...running, stdout: 'server-ready\n', status: 'completed' as const, exitCode: 0 }
    streamController.enqueue(encoder.encode(`${JSON.stringify({ type: 'complete', run: completed })}\n`))
    streamController.close()
    await completion

    expect(store.busy).toBe(false)
    expect(store.run).toEqual(completed)
  })

  it('stops an active run before allowing the terminal to close', async () => {
    const running: RunRecord = {
      id: 'run',
      projectId: project.id,
      capabilityId: 'command',
      command: 'pnpm',
      args: ['run', 'dev'],
      cwd: project.path,
      startedAt: '2026-01-01T00:00:00.000Z',
      stdout: '',
      stderr: '',
      status: 'running',
    }
    const cancelled = { ...running, status: 'cancelled' as const, exitCode: 0 }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(cancelled), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const store = useWorkbenchStore()
    store.run = running
    store.busy = true

    store.closeTerminal()
    expect(store.terminalVisible).toBe(true)
    expect(store.run).toEqual(running)

    await store.stopRun()
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/run', expect.objectContaining({ method: 'DELETE' }))
    expect(store.run?.status).toBe('cancelled')

    store.busy = false
    store.closeTerminal()
    expect(store.terminalVisible).toBe(false)
    expect(store.run).toBeUndefined()
  })
})

describe('owner scope navigation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('switches to an isolated Team workspace tree and restores its selected workspace', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/owner-scopes/state' && init?.method === 'PUT')
        return new Response(JSON.stringify({ activeScopeId: 'acme' }))
      if (path === '/api/workspaces?ownerScopeId=acme')
        return new Response(JSON.stringify([{ schemaVersion: 1, id: 'team-app', ownerScopeId: 'acme', name: 'Team App', members: [], revision: 'r' }]))
      if (path === '/api/workspace-groups?ownerScopeId=acme' || path === '/api/workspace-groups/project-assignments?ownerScopeId=acme')
        return new Response(JSON.stringify(path.includes('project-assignments') ? {} : []))
      if (path === '/api/workspaces/state?ownerScopeId=acme')
        return new Response(JSON.stringify({ expandedWorkspaceIds: ['team-app'], selectedWorkspaceId: 'team-app' }))
      if (path === '/api/owner-scopes/acme/git-sync')
        return new Response(JSON.stringify({ ownerScopeId: 'acme', state: 'clean' }))
      throw new Error(`Unexpected request: ${String(init?.method ?? 'GET')} ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = useWorkbenchStore()
    store.ownerScopes = [
      { id: 'personal', kind: 'personal', name: 'Personal' },
      { id: 'acme', kind: 'team', name: 'Acme' },
    ]

    await store.switchOwnerScope('acme')

    expect(store.activeOwnerScopeId).toBe('acme')
    expect(store.workspaces.map(workspace => workspace.name)).toEqual(['Team App'])
    expect(store.selectedWorkspaceId).toBe('team-app')
    expect(store.unassignedProjects).toEqual([])
  })

  it('shows only standalone projects explicitly grouped in the active Team', () => {
    const store = useWorkbenchStore()
    const teamProject = { ...project, id: 'team-project', name: 'Team project' }
    const globalProject = { ...project, id: 'global-project', name: 'Global project' }
    store.activeOwnerScopeId = 'acme'
    store.projects = [teamProject, globalProject]
    store.projectGroupAssignments = { [teamProject.id]: 'wxfed' }
    store.teamProjectOwnerScopes = { [teamProject.id]: ['acme'] }

    expect(store.unassignedProjects.map(item => item.name)).toEqual(['Team project'])
  })

  it('keeps projects owned by any Team out of Personal', () => {
    const store = useWorkbenchStore()
    const teamProject = { ...project, id: 'team-project', name: 'Team project' }
    const personalProject = { ...project, id: 'personal-project', name: 'Personal project' }
    store.activeOwnerScopeId = 'personal'
    store.projects = [teamProject, personalProject]
    store.teamProjectOwnerScopes = { [teamProject.id]: ['acme'] }

    expect(store.unassignedProjects.map(item => item.name)).toEqual(['Personal project'])
  })

  it('uses Personal only for an older server and surfaces other owner-scope failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })))
    const legacyStore = useWorkbenchStore()
    await expect(legacyStore.loadOwnerScopes()).resolves.toBeUndefined()
    expect(legacyStore.ownerScopes).toEqual([{ id: 'personal', kind: 'personal', name: 'Personal' }])

    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Owner scope catalog is corrupt' }), { status: 500 })))
    const brokenStore = useWorkbenchStore()
    await expect(brokenStore.loadOwnerScopes()).rejects.toThrow('Owner scope catalog is corrupt')
    expect(brokenStore.ownerScopeError).toBe('Owner scope catalog is corrupt')
  })

  it('restores the active Team sync status during startup', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/owner-scopes')
        return new Response(JSON.stringify([{ id: 'personal', kind: 'personal', name: 'Personal' }, { id: 'acme', kind: 'team', name: 'Acme' }]))
      if (path === '/api/owner-scopes/state')
        return new Response(JSON.stringify({ activeScopeId: 'acme' }))
      if (path === '/api/projects/owner-scopes')
        return new Response(JSON.stringify({ project: ['acme'] }))
      if (path === '/api/owner-scopes/acme/git-sync')
        return new Response(JSON.stringify({ ownerScopeId: 'acme', state: 'local-ahead' }))
      throw new Error(`Unexpected request: ${path}`)
    }))
    const store = useWorkbenchStore()

    await store.loadOwnerScopes()

    expect(store.activeOwnerScopeId).toBe('acme')
    expect(store.activeTeamSyncStatus).toMatchObject({ ownerScopeId: 'acme', state: 'local-ahead' })
    expect(store.teamProjectOwnerScopes).toEqual({ project: ['acme'] })
  })
})

describe('workspace creation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.clear()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('registers selected folders and adds their projects to the new workspace', async () => {
    const selectedProjects: ProjectRecord[] = [
      { ...project, id: 'client', name: 'client', path: '/projects/client' },
      { ...project, id: 'shared', name: 'shared', path: '/projects/shared' },
    ]
    const memberRequests: string[] = []
    const savedLabels: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/workspaces' && init?.method === 'POST') {
        return new Response(JSON.stringify({
          schemaVersion: 1,
          id: 'client-work',
          name: 'Client work',
          members: [],
          revision: 'created',
        }), { status: 201 })
      }
      if (path === '/api/projects' && init?.method === 'POST') {
        const projectPath = (JSON.parse(String(init.body)) as { path: string }).path
        return new Response(JSON.stringify(selectedProjects.find(project => project.path === projectPath)), { status: 201 })
      }
      if (path === '/api/projects')
        return new Response(JSON.stringify(selectedProjects), { status: 200 })
      if (path.endsWith('/capabilities') || path.includes('/agent-actions'))
        return new Response(JSON.stringify([]), { status: 200 })
      if (path.endsWith('/pins')) {
        const projectId = path.split('/')[3]
        return new Response(JSON.stringify({ projectId, capabilityIds: [] }), { status: 200 })
      }
      if (path.endsWith('/members') && init?.method === 'POST') {
        memberRequests.push((JSON.parse(String(init.body)) as { projectId: string }).projectId)
        return new Response(JSON.stringify({
          schemaVersion: 1,
          id: 'client-work',
          name: 'Client work',
          members: memberRequests.map(projectId => ({ project: projectId, projectId, resolved: true })),
          revision: `member-${memberRequests.length}`,
        }), { status: 200 })
      }
      if (path === '/api/workspaces/client-work' && init?.method === 'PUT') {
        const manifest = (JSON.parse(String(init.body)) as { manifest: WorkspaceManifest }).manifest
        savedLabels.push(...manifest.members.map(member => member.label ?? ''))
        return new Response(JSON.stringify({
          ...manifest,
          members: manifest.members.map(member => ({ ...member, projectId: member.project, resolved: true })),
          revision: 'labeled',
        }), { status: 200 })
      }
      if (path === '/api/workspaces') {
        return new Response(JSON.stringify([{
          schemaVersion: 1,
          id: 'client-work',
          name: 'Client work',
          members: selectedProjects.map(project => ({ project: project.name, projectId: project.id, resolved: true })),
          revision: 'complete',
        }]), { status: 200 })
      }
      if (path === '/api/workspaces/state')
        return new Response(JSON.stringify({ expandedWorkspaceIds: ['client-work'] }), { status: 200 })
      if (path === '/api/workspace-groups')
        return new Response(JSON.stringify([]), { status: 200 })
      if (path === '/api/workspace-groups/project-assignments')
        return new Response(JSON.stringify({}), { status: 200 })
      throw new Error(`Unexpected request: ${String(init?.method ?? 'GET')} ${path}`)
    }))

    const store = useWorkbenchStore()
    await store.createWorkspace('Client work', ['/projects/client', '/projects/shared', '/projects/client'], {
      '/projects/client': '客户端',
    })

    expect(memberRequests).toEqual(['client', 'shared'])
    expect(savedLabels).toContain('客户端')
    expect(store.projects.map(project => project.id)).toEqual(['client', 'shared'])
    expect(store.workspaces[0]?.members).toHaveLength(2)
    expect(store.expandedWorkspaceIds).toContain('client-work')
    expect(store.selectedWorkspaceId).toBe('client-work')
  })
})

describe('owned workspace groups', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.unstubAllGlobals())

  it('loads editable groups with their owned workspaces', async () => {
    const workspace = {
      schemaVersion: 1 as const,
      id: 'pair',
      name: 'Pair',
      groupId: 'product-group',
      revision: 'revision',
      members: [{ project: 'project', label: 'Project label', resolved: true, projectId: project.id }],
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/projects')
        return new Response(JSON.stringify([project]))
      if (path === '/api/workspaces')
        return new Response(JSON.stringify([workspace]))
      if (path === '/api/workspace-groups')
        return new Response(JSON.stringify([{ id: 'product-group', name: 'Product group' }]))
      if (path === '/api/workspace-groups/project-assignments')
        return new Response(JSON.stringify({ [project.id]: 'product-group' }))
      if (path.endsWith('/capabilities') || path.includes('/agent-actions'))
        return new Response(JSON.stringify([]))
      if (path.endsWith('/pins'))
        return new Response(JSON.stringify({ projectId: project.id, capabilityIds: [] }))
      throw new Error(`Unexpected request: ${path}`)
    }))
    const store = useWorkbenchStore()
    await Promise.all([store.loadProjects(), store.loadWorkspaces()])

    expect(store.allWorkspaces[0]).toMatchObject({
      id: 'pair',
      groupId: 'product-group',
      members: [{ label: 'Project label', resolved: true }],
    })
    expect(store.workspaceGroups).toEqual([{ id: 'product-group', name: 'Product group' }])
    expect(store.projectGroupAssignments).toEqual({ [project.id]: 'product-group' })
  })

  it('creates a group and assigns a workspace through the workspace interface', async () => {
    const requests: Array<{ method: string, path: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      requests.push({ method, path })
      if (path === '/api/workspace-groups' && method === 'POST')
        return new Response(JSON.stringify({ id: 'release', name: 'Release' }))
      if (path === '/api/workspaces/pair/group' && method === 'PUT')
        return new Response(JSON.stringify({ id: 'pair', groupId: 'release' }))
      if (path === '/api/workspaces')
        return new Response(JSON.stringify([]))
      if (path === '/api/workspace-groups')
        return new Response(JSON.stringify([{ id: 'release', name: 'Release' }]))
      if (path === '/api/workspace-groups/project-assignments')
        return new Response(JSON.stringify({}))
      throw new Error(`Unexpected request: ${method} ${path}`)
    }))
    const store = useWorkbenchStore()

    await expect(store.createWorkspaceGroup('Release')).resolves.toEqual({ id: 'release', name: 'Release' })
    await store.assignWorkspaceGroup('pair', 'release')

    expect(requests).toEqual(expect.arrayContaining([
      { method: 'POST', path: '/api/workspace-groups' },
      { method: 'PUT', path: '/api/workspaces/pair/group' },
    ]))
  })

  it('updates a workspace group icon as portable appearance', async () => {
    const requests: Array<{ body?: string, method: string, path: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'
      requests.push({ body: init?.body?.toString(), method, path })
      if (path === '/api/workspace-groups/product-group' && method === 'PATCH')
        return new Response(JSON.stringify({ id: 'product-group', name: 'Product group', icon: 'emoji:📦' }))
      if (path === '/api/workspaces')
        return new Response(JSON.stringify([]))
      if (path === '/api/workspace-groups')
        return new Response(JSON.stringify([{ id: 'product-group', name: 'Product group', icon: 'emoji:📦' }]))
      if (path === '/api/workspace-groups/project-assignments')
        return new Response(JSON.stringify({}))
      throw new Error(`Unexpected request: ${method} ${path}`)
    }))
    const store = useWorkbenchStore()

    await store.setWorkspaceGroupAppearance('product-group', 'emoji:📦')

    expect(requests).toContainEqual({
      body: JSON.stringify({ icon: 'emoji:📦' }),
      method: 'PATCH',
      path: '/api/workspace-groups/product-group',
    })
    expect(store.workspaceGroups).toEqual([{ id: 'product-group', name: 'Product group', icon: 'emoji:📦' }])
  })
})

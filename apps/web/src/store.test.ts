// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { Capability, CommandCapability, ProjectRecord, RunRecord, WorkspaceManifest } from 'craft-hub'
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
      if (path.endsWith('/pins'))
        return new Response(JSON.stringify({ projectId: project.id, capabilityIds: [] }), { status: 200 })
      if (path.includes('/agent-actions'))
        return new Response(JSON.stringify([]), { status: 200 })
      capabilityRequests += 1
      return new Response(JSON.stringify([skill('release', locale === 'zh-CN' ? '准备安全发布。' : 'Prepare a safe release.')]), { status: 200 })
    }))

    const store = useWorkbenchStore()
    await store.loadSettings()
    await store.loadProjects()
    expect(store.selectedCapability?.description).toBe('Prepare a safe release.')

    await store.updateLocale('zh-CN')

    expect(store.selectedCapability?.description).toBe('准备安全发布。')
    expect(capabilityRequests).toBe(2)
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
})

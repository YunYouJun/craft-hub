// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { AgentActionSummary, AgentTaskRecord, ProjectRecord } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18n } from './i18n'
import ProjectAgentActionDialog from './ProjectAgentActionDialog.vue'
import { useWorkbenchStore } from './store'

const project: ProjectRecord = {
  id: 'project',
  name: 'Example',
  path: '/project',
  trust: 'untrusted',
  addedAt: '2026-01-01T00:00:00.000Z',
}
const action: AgentActionSummary = {
  id: 'improve-project-config',
  targetPath: '.craft-hub/project.jsonc',
  missingCommandCount: 3,
  missingPackageCount: 0,
  commandFingerprint: 'commands-v1',
}

describe('project agent action dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setActivePinia(createPinia())
    useI18n().setLocale('zh-CN')
  })

  afterEach(() => vi.unstubAllGlobals())

  it('explains trust and starts the scoped built-in action', async () => {
    const task: AgentTaskRecord = {
      id: 'task',
      provider: 'codex',
      actionId: 'improve-project-config',
      projectIds: [project.id],
      primaryProjectId: project.id,
      prompt: 'built by runtime',
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'running',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = input.toString()
      if (path.endsWith('/trust'))
        return new Response(JSON.stringify({ ...project, trust: 'trusted' }), { status: 200 })
      if (path === '/api/agent-tasks')
        return new Response(JSON.stringify([]), { status: 200 })
      if (init?.method === 'POST')
        return new Response(JSON.stringify(task), { status: 202 })
      return new Response(JSON.stringify([action]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.agentActions = [action]

    mount(ProjectAgentActionDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    expect(document.body.textContent).toContain('.craft-hub/project.jsonc')
    expect(document.body.textContent).toContain('命令3')
    expect(document.body.querySelector('.agent-action-trust')?.textContent).toContain('只读')
    expect(document.body.querySelector('[data-testid="start-agent-action"]')?.textContent).toContain('信任并启动')

    document.body.querySelector<HTMLButtonElement>('[data-testid="start-agent-action"]')!.click()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project/trust', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project/agent-actions/improve-project-config?locale=zh-CN', expect.objectContaining({ method: 'POST' }))
    expect(store.agentTasks[0]).toMatchObject({ id: 'task', actionId: 'improve-project-config' })
  })

  it('reviews, edits, and applies structured description suggestions', async () => {
    const trusted = { ...project, trust: 'trusted' as const }
    const task: AgentTaskRecord = {
      id: 'proposal-task',
      provider: 'codex',
      actionId: 'improve-project-config',
      projectIds: [project.id],
      primaryProjectId: project.id,
      prompt: 'analysis only',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:01:00.000Z',
      status: 'completed',
      actionResult: {
        outcome: 'proposed',
        proposal: {
          analysisRevision: 'analysis',
          configRevision: 'config',
          locale: 'zh-CN',
          suggestions: [{
            id: 'command:dev',
            target: 'command',
            key: 'package.json:dev',
            status: 'suggested',
            description: { 'default': 'Start development.', 'zh-CN': '启动开发环境。' },
            evidence: [{ path: 'package.json', startLine: 4, kind: 'command-definition' }],
            reason: 'Derived from the dev script.',
          }],
        },
      },
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = input.toString()
      if (path.endsWith('/apply'))
        return new Response(JSON.stringify({ appliedCount: 1, previousRevision: 'config', revision: 'next', targetPath: '.craft-hub/project.jsonc' }), { status: 200 })
      if (path === '/api/agent-tasks')
        return new Response(JSON.stringify([task]), { status: 200 })
      if (path.includes('/capability-discovery'))
        return new Response(JSON.stringify({ capabilities: [], diagnostics: [], packages: [] }), { status: 200 })
      if (path.endsWith('/pins'))
        return new Response(JSON.stringify({ projectId: project.id, capabilityIds: [] }), { status: 200 })
      if (path.includes('/agent-actions'))
        return new Response(JSON.stringify([action]), { status: 200 })
      throw new Error(`Unexpected request: ${String(init?.method ?? 'GET')} ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = useWorkbenchStore()
    store.projects = [trusted]
    store.selectedProjectId = project.id
    store.agentActions = [action]
    store.agentTasks = [task]

    mount(ProjectAgentActionDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    expect(document.body.textContent).toContain('package.json:dev')
    const textareas = document.body.querySelectorAll<HTMLTextAreaElement>('textarea')
    expect(textareas).toHaveLength(2)
    textareas[1]!.value = '启动本地开发工作台。'
    textareas[1]!.dispatchEvent(new Event('input'))
    document.body.querySelector<HTMLButtonElement>('[data-testid="apply-description-proposal"]')!.click()
    await flushPromises()

    const applyCall = fetchMock.mock.calls.find(([input]) => input.toString().endsWith('/apply'))
    expect(JSON.parse(String(applyCall?.[1]?.body))).toMatchObject({
      taskId: task.id,
      changes: [{ key: 'package.json:dev', description: { 'zh-CN': '启动本地开发工作台。' } }],
    })
  })
})

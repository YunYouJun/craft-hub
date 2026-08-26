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
  targetPath: '.craft-hub/project.yaml',
  missingCommandCount: 3,
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

    expect(document.body.textContent).toContain('.craft-hub/project.yaml')
    expect(document.body.textContent).toContain('有 3 个命令')
    expect(document.body.querySelector('.agent-action-trust')?.textContent).toContain('workspace-write')
    expect(document.body.querySelector('.primary-button')?.textContent).toContain('信任并启动')

    document.body.querySelector<HTMLButtonElement>('.primary-button')!.click()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project/trust', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project/agent-actions/improve-project-config?locale=zh-CN', expect.objectContaining({ method: 'POST' }))
    expect(store.agentTasks[0]).toMatchObject({ id: 'task', actionId: 'improve-project-config' })
  })
})

// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { GitIntegrationPlan, GitIntegrationResult, ProjectRecord } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GitIntegrationDialog from './GitIntegrationDialog.vue'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const project: ProjectRecord = {
  id: 'project-id',
  name: 'Example',
  path: '/workspace/example',
  trust: 'trusted',
  addedAt: '2026-01-01T00:00:00.000Z',
}

const plan: GitIntegrationPlan = {
  projectId: project.id,
  repositoryRoot: project.path,
  sourceBranch: 'feature',
  targetBranch: 'main',
  localBranches: ['feature', 'main'],
  sourceRevision: 'source-revision',
  targetRevision: 'target-revision',
  clean: true,
  relation: 'fast-forward',
  deleteSourceBranch: true,
  revision: 'plan-revision',
  steps: [
    { kind: 'switch-target', command: 'git', args: ['switch', '--', 'main'] },
    { kind: 'merge-source', command: 'git', args: ['merge', '--ff-only', '--', 'feature'] },
    { kind: 'delete-source', command: 'git', args: ['branch', '-d', '--', 'feature'] },
  ],
  blockers: [],
  warnings: [],
}

const result: GitIntegrationResult = {
  projectId: project.id,
  repositoryRoot: project.path,
  sourceBranch: 'feature',
  targetBranch: 'main',
  relation: 'fast-forward',
  deletedSourceBranch: true,
  finalBranch: 'main',
  finalRevision: 'source-revision',
  appliedRevision: plan.revision,
  steps: plan.steps,
}

describe('git integration dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    useI18n().setLocale('en')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('reviews structured local Git steps before applying the exact Plan revision', async () => {
    const requests: Array<{ path: string, body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ path, body })
      const response = path.endsWith('/apply') ? result : plan
      return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } })
    }))
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    const wrapper = mount(GitIntegrationDialog, {
      attachTo: document.body,
      global: { plugins: [pinia] },
      props: { open: true, projectId: project.id, projectName: project.name, trusted: true },
    })
    await flushPromises()

    const dialog = document.querySelector<HTMLElement>('[data-testid="git-integration-dialog"]')!
    expect(dialog.textContent).toContain('Can fast-forward')
    expect(dialog.textContent).toContain('git merge --ff-only -- feature')
    expect(dialog.textContent).toContain('git branch -d -- feature')

    document.querySelector<HTMLButtonElement>('[data-testid="git-integration-apply"]')!.click()
    await flushPromises()

    expect(requests).toEqual([
      { path: `/api/projects/${project.id}/git-integration/plan`, body: { deleteSourceBranch: true } },
      {
        path: `/api/projects/${project.id}/git-integration/apply`,
        body: { expectedRevision: plan.revision, targetBranch: 'main', deleteSourceBranch: true },
      },
    ])
    expect(dialog.textContent).toContain('Git integration complete')
    expect(dialog.textContent).toContain('Deleted local branch feature.')
    wrapper.unmount()
  })

  it('renders blockers and keeps apply disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...plan,
      clean: false,
      steps: [],
      blockers: [{ code: 'dirty-worktree', message: 'dirty' }],
    }), { headers: { 'content-type': 'application/json' } })))
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(GitIntegrationDialog, {
      attachTo: document.body,
      global: { plugins: [pinia] },
      props: { open: true, projectId: project.id, projectName: project.name, trusted: true },
    })
    await flushPromises()

    expect(document.body.textContent).toContain('Commit or discard working-tree changes before integrating.')
    expect(document.querySelector<HTMLButtonElement>('[data-testid="git-integration-apply"]')!.disabled).toBe(true)
    wrapper.unmount()
  })
})

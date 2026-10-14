// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { VueWrapper } from '@vue/test-utils'
import type { IntegrationEntity, ProjectRecord, ResolvedWorkItemProjectAssociation, SettingsSnapshot, WorkItemProjectSnapshot, WorkItemProjectTarget, WorkItemSourceRef } from 'craft-hub'
import type { HomeWorkSource } from './personal-workbench'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiRequestError } from './api'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'
import WorkHandoffDialog from './WorkHandoffDialog.vue'

const sourceRef: WorkItemSourceRef = { providerId: 'tasks', instanceId: 'tasks-personal', accountId: 'me', containerId: 'list-1', kind: 'task', itemId: 'task-1' }
const { itemId: _itemId, ...containerRef } = sourceRef
const itemTarget: WorkItemProjectTarget = { type: 'item', ref: sourceRef }
const containerTarget: WorkItemProjectTarget = { type: 'container', ref: containerRef }

function project(id: string): ProjectRecord {
  return { id, name: `Project ${id}`, path: `/repos/${id}`, trust: 'untrusted', addedAt: '2026-10-12T00:00:00Z' }
}

function work(ref = sourceRef): { source: HomeWorkSource, item: IntegrationEntity } {
  return {
    source: { key: 'tasks-personal-list', integrationId: 'tasks-personal', viewId: 'work', title: 'My tasks', actionId: 'list', input: {} },
    item: { id: 'display-task-1', title: 'Review proposal', sourceRef: ref, personalMembership: { accountId: ref.accountId, relation: 'owned' } },
  }
}

function savedLink(target: WorkItemProjectTarget, projectId: string | null): ResolvedWorkItemProjectAssociation {
  return {
    target,
    projectId,
    resolution: projectId === null ? { status: 'unlinked' } : { status: 'available', project: { id: projectId, name: project(projectId).name, trust: 'untrusted' } },
  }
}

function snapshot(associations: ResolvedWorkItemProjectAssociation[] = [], revision = 'a'.repeat(64)): WorkItemProjectSnapshot {
  return { version: 1, revision, associations }
}

function settings(): SettingsSnapshot {
  return {
    explicitKeys: ['workbench.home'],
    path: '/settings.json',
    revision: 'settings',
    settings: {
      'workbench.codex': {},
      'workbench.editor': { default: 'vscode' },
      'workbench.home': { tools: [{ id: 'launcher', title: 'Launcher', url: 'https://example.com/', group: 'Tools', launch: { application: 'orca' } }] },
      'workbench.locale': 'en',
      'workbench.repositoriesRoot': '',
      'workbench.sidebar': { entries: [] },
      'workbench.shortcuts': {},
      'workbench.theme': 'system',
    },
  }
}

describe('shared work handoff dialog', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    document.body.innerHTML = ''
    window.localStorage.clear()
    setActivePinia(createPinia())
    useI18n().setLocale('en')
    const store = useWorkbenchStore()
    store.projects = [project('a'), project('b'), project('c')]
    store.settings = settings()
    store.selectedProjectId = 'c'
    window.craftHubDesktop = {
      copyText: vi.fn().mockResolvedValue(undefined),
      openWorkbenchTool: vi.fn().mockResolvedValue({ destination: 'application', application: 'orca', contextTransferred: false }),
    }
    vi.spyOn(api, 'workItemProjects').mockResolvedValue(snapshot())
    vi.spyOn(api, 'updateWorkItemProject').mockResolvedValue(snapshot([], 'b'.repeat(64)))
    vi.spyOn(api, 'removeWorkItemProject').mockResolvedValue(snapshot([], 'c'.repeat(64)))
    vi.spyOn(api, 'invokeIntegrationAction').mockRejectedValue(new Error('Unexpected source mutation'))
    vi.spyOn(api, 'trust').mockRejectedValue(new Error('Unexpected trust operation'))
    vi.spyOn(api, 'run').mockRejectedValue(new Error('Unexpected command execution'))
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    expect(api.trust).not.toHaveBeenCalled()
    expect(api.run).not.toHaveBeenCalled()
    expect(api.invokeIntegrationAction).not.toHaveBeenCalled()
    expect(useWorkbenchStore().projects.every(project => project.trust === 'untrusted')).toBe(true)
    expect(useWorkbenchStore().selectedProjectId).toBe('c')
    document.body.innerHTML = ''
    delete window.craftHubDesktop
    vi.restoreAllMocks()
  })

  async function open(extra: Partial<InstanceType<typeof WorkHandoffDialog>['$props']> = {}): Promise<void> {
    wrapper = mount(WorkHandoffDialog, { props: { open: true, work: work(), ...extra }, attachTo: document.body })
    await flushPromises()
  }

  function projectSelector(): HTMLElement {
    return document.body.querySelector<HTMLElement>('[data-testid="handoff-project"]')!
  }

  function preview(): HTMLTextAreaElement {
    return document.body.querySelector<HTMLTextAreaElement>('.home-handoff-preview')!
  }

  async function chooseProject(id: string): Promise<void> {
    await chooseOption('handoff-project', id ? `Project ${id} · /repos/${id}` : 'No project needed')
  }

  async function chooseOption(testId: string, label: string): Promise<void> {
    const trigger = document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent?.trim() === label)
    if (!option)
      throw new Error(`Missing dialog option: ${label}`)
    option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
  }

  async function click(label: string): Promise<void> {
    const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === label)
    if (!button)
      throw new Error(`Missing dialog button: ${label}`)
    button.click()
    await flushPromises()
  }

  it('requires an explicit project choice and keeps complete context in a collapsed, labelled preview', async () => {
    await open()

    expect(projectSelector().textContent).toContain('Choose a project')
    expect(document.body.querySelector(`label[for="${projectSelector().id}"]`)?.textContent).toBe('Target project')
    const scope = document.body.querySelector<HTMLElement>('[data-testid="handoff-scope"]')!
    expect(document.body.querySelector(`label[for="${scope.id}"]`)?.textContent).toBe('Link scope')
    const objective = document.body.querySelector<HTMLTextAreaElement>('textarea:not([readonly])')!
    expect(document.body.querySelector(`label[for="${objective.id}"]`)?.textContent).toBe('Objective (optional)')
    expect(document.body.querySelector(`label[for="${preview().id}"]`)?.textContent).toBe('Handoff preview')
    expect(new Set([projectSelector().id, scope.id, objective.id, preview().id]).size).toBe(4)
    expect(document.body.querySelector<HTMLDetailsElement>('.handoff-preview-disclosure')?.open).toBe(false)
    expect(preview().value).toContain(`Complete source identity: ${JSON.stringify(sourceRef)}`)
    const save = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Save project link')!
    expect(save.disabled).toBe(true)
    await click('Save project link')
    expect(api.updateWorkItemProject).not.toHaveBeenCalled()
    document.body.querySelector<HTMLElement>('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(wrapper!.emitted('update:open')).toContainEqual([false])
  })

  it('keeps source account identifiers out of the persistent summary while preserving exact handoff identity', async () => {
    const ref = { ...sourceRef, accountId: 'account-native-017' }
    const currentWork = work(ref)
    currentWork.item.statusLabel = 'In progress'
    await open({ work: currentWork })

    const summary = document.body.querySelector<HTMLElement>('.handoff-source-summary')!
    expect(summary.textContent).toContain('My tasks')
    expect(summary.textContent).toContain('In progress')
    expect(summary.textContent).not.toContain(ref.accountId)
    expect(summary.querySelector('span')?.title).toBe(`Account: ${ref.accountId}`)
    expect(preview().value).toContain(`Complete source identity: ${JSON.stringify(ref)}`)
    await click('Copy context')
    expect(window.craftHubDesktop!.copyText).toHaveBeenCalledWith(preview().value)
  })

  it('restores an exact item association ahead of a container default and keeps preparation separate from execution', async () => {
    vi.mocked(api.workItemProjects).mockResolvedValue(snapshot([savedLink(containerTarget, 'a'), savedLink(itemTarget, 'b')]))
    await open({ initialProjectId: 'c' })

    expect(projectSelector().textContent).toContain('Project b · /repos/b')
    expect(preview().value).toContain('Selected project: Project b')
    expect(preview().value).toContain('Local path: /repos/b')
    expect(preview().value).toContain(`Complete source identity: ${JSON.stringify(sourceRef)}`)
    expect(document.body.textContent).toContain('Saved project link restored')
    expect(api.updateWorkItemProject).not.toHaveBeenCalled()
    await click('Copy context')
    expect(window.craftHubDesktop!.copyText).toHaveBeenCalledWith(preview().value)
    const tool = document.body.querySelector<HTMLAnchorElement>('.home-handoff-tools a')!
    tool.click()
    await flushPromises()

    expect(window.craftHubDesktop!.openWorkbenchTool).toHaveBeenCalledWith('launcher')
    expect(document.body.textContent).toContain('Application opening requested')
    expect(api.updateWorkItemProject).not.toHaveBeenCalled()
  })

  it('restores the container default when the item has no override and ignores another account with the same native ID', async () => {
    const otherAccount: WorkItemProjectTarget = { type: 'item', ref: { ...sourceRef, accountId: 'other' } }
    vi.mocked(api.workItemProjects).mockResolvedValue(snapshot([savedLink(otherAccount, 'c'), savedLink(containerTarget, 'a')]))
    await open()

    expect(projectSelector().textContent).toContain('Project a · /repos/a')
    expect(preview().value).toContain('Source account: me')
    expect(preview().value).toContain('Project ID: a')
  })

  it('restores an explicit no-project item override ahead of a container default and initial project', async () => {
    vi.mocked(api.workItemProjects).mockResolvedValue(snapshot([savedLink(containerTarget, 'a'), savedLink(itemTarget, null)]))
    await open({ initialProjectId: 'c' })

    expect(projectSelector().textContent).toContain('No project needed')
    expect(preview().value).toContain('No project selected')
    expect(document.body.textContent).toContain('explicitly linked to no project')
  })

  it('saves an explicit null with its source identity and revision without changing the original work item', async () => {
    const original = work()
    vi.mocked(api.workItemProjects).mockResolvedValue(snapshot([savedLink(containerTarget, 'a')]))
    vi.mocked(api.updateWorkItemProject).mockResolvedValue(snapshot([savedLink(containerTarget, 'a'), savedLink(itemTarget, null)], 'b'.repeat(64)))
    await open({ work: original })
    await chooseProject('')
    await click('Save no project')

    expect(api.updateWorkItemProject).toHaveBeenCalledWith({ revision: 'a'.repeat(64), target: itemTarget, projectId: null })
    expect(document.body.textContent).toContain('Project link saved')
    expect(document.body.textContent).toContain('explicitly linked to no project')
    expect(original.item.personalMembership).toEqual({ accountId: 'me', relation: 'owned' })
    expect(original.item.sourceRef).toEqual(sourceRef)
  })

  it('saves a container default only when that scope is selected and removal restores the remaining fallback', async () => {
    vi.mocked(api.workItemProjects).mockResolvedValue(snapshot([savedLink(containerTarget, 'a'), savedLink(itemTarget, 'b')]))
    vi.mocked(api.updateWorkItemProject).mockResolvedValue(snapshot([savedLink(containerTarget, 'c'), savedLink(itemTarget, 'b')], 'b'.repeat(64)))
    vi.mocked(api.removeWorkItemProject).mockResolvedValue(snapshot([savedLink(containerTarget, 'c')], 'c'.repeat(64)))
    await open()
    await chooseOption('handoff-scope', 'This list or container')
    await chooseProject('c')
    await click('Save project link')

    expect(api.updateWorkItemProject).toHaveBeenCalledWith({ revision: 'a'.repeat(64), target: containerTarget, projectId: 'c' })
    await chooseOption('handoff-scope', 'This item')
    await click('Clear link')

    expect(api.removeWorkItemProject).toHaveBeenCalledWith({ revision: 'b'.repeat(64), target: itemTarget })
    expect(projectSelector().textContent).toContain('Project c · /repos/c')
    expect(document.body.textContent).toContain('Project link cleared')
  })

  it('reloads a conflicting revision while preserving the selected project and objective for a reviewed retry', async () => {
    vi.mocked(api.workItemProjects)
      .mockResolvedValueOnce(snapshot([savedLink(itemTarget, 'a')]))
      .mockResolvedValueOnce(snapshot([savedLink(itemTarget, 'c')], 'c'.repeat(64)))
    vi.mocked(api.updateWorkItemProject)
      .mockRejectedValueOnce(new ApiRequestError('Changed elsewhere', 409))
      .mockResolvedValueOnce(snapshot([savedLink(itemTarget, 'b')], 'd'.repeat(64)))
    await open()
    await chooseProject('b')
    const objective = document.body.querySelector<HTMLTextAreaElement>('textarea:not([readonly])')!
    objective.value = 'Review the rendering change'
    objective.dispatchEvent(new Event('input', { bubbles: true }))
    await click('Save project link')

    expect(api.workItemProjects).toHaveBeenCalledTimes(2)
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('changed elsewhere and were reloaded')
    expect(projectSelector().textContent).toContain('Project b · /repos/b')
    expect(objective.value).toBe('Review the rendering change')
    expect(preview().value).toContain('Project ID: b')
    await click('Save project link')
    expect(api.updateWorkItemProject).toHaveBeenLastCalledWith({ revision: 'c'.repeat(64), target: itemTarget, projectId: 'b' })
  })

  it('does not overwrite a project selected while the saved association is still loading', async () => {
    let finish!: (result: WorkItemProjectSnapshot) => void
    vi.mocked(api.workItemProjects).mockImplementationOnce(() => new Promise(resolve => finish = resolve))
    await open()
    await chooseProject('b')
    finish(snapshot([savedLink(itemTarget, 'a')]))
    await flushPromises()

    expect(projectSelector().textContent).toContain('Project b · /repos/b')
    expect(preview().value).toContain('Project ID: b')
  })

  it('ignores a late association read after changing the work account', async () => {
    let finishOld!: (result: WorkItemProjectSnapshot) => void
    const nextRef = { ...sourceRef, accountId: 'other' }
    vi.mocked(api.workItemProjects)
      .mockImplementationOnce(() => new Promise(resolve => finishOld = resolve))
      .mockResolvedValueOnce(snapshot([savedLink({ type: 'item', ref: nextRef }, 'b')], 'b'.repeat(64)))
    await open()
    await wrapper!.setProps({ work: work(nextRef) })
    await flushPromises()
    finishOld(snapshot([savedLink(itemTarget, 'a')]))
    await flushPromises()

    expect(projectSelector().textContent).toContain('Project b · /repos/b')
    expect(preview().value).toContain('Source account: other')
    await click('Save project link')
    expect(api.updateWorkItemProject).toHaveBeenCalledWith({ revision: 'b'.repeat(64), target: { type: 'item', ref: nextRef }, projectId: 'b' })
  })

  it('keeps an unavailable item override visible without silently falling back to its container', async () => {
    const unavailable: ResolvedWorkItemProjectAssociation = {
      target: itemTarget,
      projectId: 'missing',
      resolution: { status: 'unavailable', reason: 'project-unregistered', message: 'Project removed' },
    }
    vi.mocked(api.workItemProjects).mockResolvedValue(snapshot([savedLink(containerTarget, 'a'), unavailable]))
    await open({ initialProjectId: 'c' })

    expect(projectSelector().textContent).toContain('Choose a project')
    expect(document.body.textContent).toContain('linked project is unavailable')
    expect(preview().value).not.toContain('Project ID: a')
  })

  it('allows legacy manual handoff without requesting or persisting a fabricated source identity', async () => {
    const legacy = work()
    delete legacy.item.sourceRef
    await open({ work: legacy, initialProjectId: 'a' })

    expect(api.workItemProjects).not.toHaveBeenCalled()
    expect(document.body.querySelector('.binding-controls')).toBeNull()
    expect(document.body.textContent).toContain('no complete work-item identity')
    await click('Copy context')
    expect(window.craftHubDesktop!.copyText).toHaveBeenCalledWith(preview().value)
    expect(api.updateWorkItemProject).not.toHaveBeenCalled()
    expect(api.removeWorkItemProject).not.toHaveBeenCalled()
  })

  it('does not report a new preview as copied when a previous clipboard operation finishes late', async () => {
    let finishCopy!: () => void
    vi.mocked(window.craftHubDesktop!.copyText!).mockImplementation(() => new Promise<void>((resolve) => {
      finishCopy = resolve
    }))
    await open({ initialProjectId: 'a' })
    await click('Copy context')
    await chooseProject('b')
    finishCopy()
    await flushPromises()
    expect(preview().value).toContain('Project ID: b')
    expect(document.body.textContent).not.toContain('Context copied.')
  })

  it('reveals the complete preview for manual copying when clipboard access fails', async () => {
    vi.mocked(window.craftHubDesktop!.copyText!).mockRejectedValue(new Error('Clipboard unavailable'))
    await open({ initialProjectId: 'a' })
    await click('Copy context')

    expect(document.body.querySelector<HTMLDetailsElement>('.handoff-preview-disclosure')?.open).toBe(true)
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Clipboard unavailable')
    expect(preview().value).toContain(`Complete source identity: ${JSON.stringify(sourceRef)}`)
    expect(document.body.textContent).not.toContain('Context copied.')
  })

  it('keeps modified tool clicks available as genuine website links', async () => {
    await open()
    const tool = document.body.querySelector<HTMLAnchorElement>('.home-handoff-tools a')!
    expect(tool.href).toBe('https://example.com/')
    expect(tool.target).toBe('_blank')
    expect(tool.rel).toBe('noopener noreferrer')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
    tool.dispatchEvent(event)
    await flushPromises()

    expect(event.defaultPrevented).toBe(false)
    expect(window.craftHubDesktop!.openWorkbenchTool).not.toHaveBeenCalled()
  })

  it('ignores an old tool response after switching to another source account', async () => {
    let finishOpen!: (value: { destination: 'application', contextTransferred: false }) => void
    vi.mocked(window.craftHubDesktop!.openWorkbenchTool!).mockImplementation(() => new Promise((resolve) => {
      finishOpen = resolve
    }))
    await open()
    document.body.querySelector<HTMLAnchorElement>('.home-handoff-tools a')!.click()
    await wrapper!.setProps({ work: work({ ...sourceRef, accountId: 'other' }) })
    finishOpen({ destination: 'application', contextTransferred: false })
    await flushPromises()
    expect(preview().value).toContain('Source account: other')
    expect(document.body.textContent).not.toContain('Application opening requested')
  })
})

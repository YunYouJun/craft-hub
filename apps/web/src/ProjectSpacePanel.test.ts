// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { CommandCapability, ProjectSpaceSnapshot } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
import ProjectSpacePanel from './ProjectSpacePanel.vue'
import { useWorkbenchStore } from './store'

const report: ProjectSpaceSnapshot = {
  projectId: 'project',
  checkedAt: '2026-11-04T10:00:00.000Z',
  durationMs: 12,
  status: 'partial',
  totalBytes: 4096,
  fileCount: 4,
  scannedEntries: 8,
  skippedSymlinks: 2,
  skippedSpecialFiles: 0,
  duplicateFiles: 1,
  categories: [
    { category: 'dependencies', bytes: 2048, fileCount: 2 },
    { category: 'build', bytes: 1024, fileCount: 1 },
    { category: 'cache', bytes: 0, fileCount: 0 },
    { category: 'git', bytes: 0, fileCount: 0 },
    { category: 'other', bytes: 1024, fileCount: 1 },
  ],
  entries: [{ path: 'apps', kind: 'directory', bytes: 4096, fileCount: 4, incomplete: true }],
  omittedEntries: 2,
  issues: [{ path: 'apps/private', reason: 'unreadable' }],
  omittedIssues: 0,
  limits: { maxEntries: 50_000, maxDurationMs: 5000, maxDepth: 48 },
}
const clean: CommandCapability = {
  id: 'clean-web',
  kind: 'command',
  name: 'clean:cache',
  source: 'apps/web/package.json',
  package: { relativePath: 'apps/web', name: 'Web', root: false },
  invocation: { command: 'pnpm', args: ['run', 'clean:cache'], cwd: '/project/apps/web', requiredEnv: [] },
}

function fixture() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useI18n().setLocale('en')
  const store = useWorkbenchStore()
  store.projects = [{ id: 'project', name: 'Project', path: '/project', trust: 'untrusted', addedAt: '' }]
  store.selectedProjectId = 'project'
  store.capabilities = [clean, { ...clean, id: 'build', name: 'build' }, { ...clean, id: 'cleanroom', name: 'cleanroom' }]
  const wrapper = mount(ProjectSpacePanel, { global: { plugins: [pinia] } })
  return { store, wrapper }
}

afterEach(() => vi.restoreAllMocks())

describe('project space and maintenance', () => {
  it('scans only on demand, shows partial accounting and reviews an untrusted maintenance command without running it', async () => {
    const scan = vi.spyOn(api, 'projectSpace').mockResolvedValue(report)
    const { store, wrapper } = fixture()
    const run = vi.spyOn(store, 'runSelected')
    expect(scan).not.toHaveBeenCalled()
    expect(wrapper.findAll('.space-command')).toHaveLength(1)
    await wrapper.get('[data-testid="analyze-project-space"]').trigger('click')
    await flushPromises()
    expect(scan).toHaveBeenCalledWith('project', expect.any(AbortSignal))
    const result = wrapper.get('[data-testid="project-space-report"]')
    expect(result.text()).toContain('4 KiB')
    expect(result.text()).toContain('This scan is incomplete')
    expect(result.text()).toContain('Could not read metadata')
    expect(result.text()).toContain('2 smaller entries')
    expect(result.text()).toContain('not allocated disk space')
    await wrapper.get('[data-testid="maintenance-command-clean-web"]').trigger('click')
    expect(store.selectedCapabilityId).toBe(clean.id)
    expect(store.selectedPackagePath).toBe('apps/web')
    expect(store.selectedProject?.trust).toBe('untrusted')
    expect(run).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('aborts and discards late results after cancellation, project switch and unmount', async () => {
    let resolve!: (value: ProjectSpaceSnapshot) => void
    const scan = vi.spyOn(api, 'projectSpace').mockImplementation(() => new Promise((done) => {
      resolve = done
    }))
    const { store, wrapper } = fixture()
    await wrapper.get('[data-testid="analyze-project-space"]').trigger('click')
    const cancelledSignal = scan.mock.calls[0]![1]!
    await wrapper.get('.space-heading button').trigger('click')
    expect(cancelledSignal.aborted).toBe(true)
    resolve(report)
    await flushPromises()
    expect(wrapper.find('[data-testid="project-space-report"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Scan cancelled')
    await wrapper.get('[data-testid="analyze-project-space"]').trigger('click')
    const switchedSignal = scan.mock.calls[1]![1]!
    store.projects.push({ id: 'other', name: 'Other', path: '/other', trust: 'trusted', addedAt: '' })
    store.selectedProjectId = 'other'
    expect(switchedSignal.aborted).toBe(true)
    resolve(report)
    await flushPromises()
    expect(wrapper.find('[data-testid="project-space-report"]').exists()).toBe(false)
    await wrapper.get('[data-testid="analyze-project-space"]').trigger('click')
    const unmountedSignal = scan.mock.calls[2]![1]!
    wrapper.unmount()
    expect(unmountedSignal.aborted).toBe(true)
    resolve(report)
    await flushPromises()
  })

  it('keeps the previous dated result on a failed refresh and supports retry', async () => {
    const scan = vi.spyOn(api, 'projectSpace').mockResolvedValueOnce(report).mockRejectedValueOnce(new Error('Directory unavailable')).mockResolvedValueOnce({ ...report, status: 'complete', issues: [] })
    const { wrapper } = fixture()
    await wrapper.get('[data-testid="analyze-project-space"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="analyze-project-space"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Directory unavailable')
    expect(wrapper.get('time').attributes('datetime')).toBe(report.checkedAt)
    await wrapper.get('[data-testid="analyze-project-space"]').trigger('click')
    await flushPromises()
    expect(scan).toHaveBeenCalledTimes(3)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('.space-partial').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows hosted and missing-command states without offering local analysis or invented commands', async () => {
    const scan = vi.spyOn(api, 'projectSpace')
    const { store, wrapper } = fixture()
    store.hostEnvironment = { kind: 'hosted', capabilities: { localProjectDirectories: false, localGitSync: false } }
    store.capabilities = []
    await flushPromises()
    expect(wrapper.find('[data-testid="analyze-project-space"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Open the local workbench')
    expect(wrapper.text()).toContain('No clean or cleanup commands')
    expect(scan).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

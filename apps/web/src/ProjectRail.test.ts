// @vitest-environment happy-dom
/// <reference lib="dom" />

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Select } from './components/ui/select'
import { useI18n } from './i18n'
import ProjectRail from './ProjectRail.vue'
import { useWorkbenchStore } from './store'

const stylesPath = ['apps/web/src/styles.css', 'src/styles.css']
  .map(candidate => resolve(process.cwd(), candidate))
  .find(existsSync)
const styles = readFileSync(stylesPath!, 'utf8')

describe('project rail', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    delete window.craftHubDesktop
    setActivePinia(createPinia())
    useI18n().setLocale('en')
  })

  it('opens an in-app project path dialog when Add project is clicked', async () => {
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    await wrapper.get('[data-testid="add-project"]').trigger('click')

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.querySelector('input[name="project-path"]')).not.toBeNull()
  })

  it('creates a Git-backed Team from the owner scope switcher', async () => {
    const store = useWorkbenchStore()
    store.ownerScopes = [{ id: 'personal', kind: 'personal', name: 'Personal' }]
    const createTeam = vi.fn(async () => ({ id: 'acme', kind: 'team' as const, name: 'Acme' }))
    store.createTeam = createTeam
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    await wrapper.get('.owner-scope-switcher > button:last-child').trigger('click')
    const name = document.body.querySelector<HTMLInputElement>('input[name="team-name"]')!
    const repository = document.body.querySelector<HTMLInputElement>('input[name="team-repository-path"]')!
    name.value = 'Acme'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    repository.value = '/repos/acme-workbench'
    repository.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.querySelector<HTMLFormElement>('[data-testid="create-team-form"]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(createTeam).toHaveBeenCalledWith('Acme', '/repos/acme-workbench', undefined)
  })

  it('chooses a Team Git repository from the configured repositories root', async () => {
    const selectProjectDirectory = vi.fn(async () => '/repos/acme-workbench')
    window.craftHubDesktop = { selectProjectDirectory }
    const store = useWorkbenchStore()
    store.ownerScopes = [{ id: 'personal', kind: 'personal', name: 'Personal' }]
    store.settings = {
      explicitKeys: ['workbench.repositoriesRoot'],
      path: '/settings.json',
      revision: 'settings',
      settings: {
        'workbench.codex': {},
        'workbench.editor': { default: 'vscode' },
        'workbench.locale': 'en',
        'workbench.repositoriesRoot': '/repos',
        'workbench.shortcuts': { 'workbench.showCommandPalette': 'Mod+K' },
        'workbench.theme': 'system',
      },
    }
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    await wrapper.get('.owner-scope-switcher > button:last-child').trigger('click')
    document.body.querySelector<HTMLButtonElement>('[data-testid="choose-team-repository"]')!.click()
    await flushPromises()

    expect(selectProjectDirectory).toHaveBeenCalledWith('/repos')
    expect(document.body.querySelector<HTMLInputElement>('input[name="team-repository-path"]')!.value).toBe('/repos/acme-workbench')
    expect(styles).toContain('.add-project-dialog input { width: 100%; height: var(--control-height-default);')
    expect(styles).toContain('.team-create-form { display: grid; gap: var(--space-3); }')
  })

  it('shows compact semantic icons and switches owner scope from the custom selector', async () => {
    const store = useWorkbenchStore()
    store.ownerScopes = [
      { id: 'personal', kind: 'personal', name: 'Personal' },
      { id: 'acme', kind: 'team', name: 'Acme' },
    ]
    store.activeOwnerScopeId = 'personal'
    store.switchOwnerScope = vi.fn(async () => {})
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.element.querySelector('[data-testid="owner-scope-trigger"] .i-ri-user-line')).not.toBeNull()
    expect(wrapper.get('[data-testid="owner-scope-trigger"]').text()).toBe('Personal')
    store.activeOwnerScopeId = 'acme'
    await wrapper.vm.$nextTick()
    expect(wrapper.element.querySelector('[data-testid="owner-scope-trigger"] .i-ri-team-line')).not.toBeNull()
    expect(wrapper.get('[data-testid="owner-scope-trigger"]').text()).toBe('Acme')
    expect(styles).toContain('.owner-scope-trigger { width: 100%; height: 30px;')
    expect(styles).toContain('font-size: var(--font-size-body); font-weight: 600;')

    wrapper.getComponent(Select).vm.$emit('update:modelValue', 'acme')
    await flushPromises()
    expect(store.switchOwnerScope).toHaveBeenCalledWith('acme')
  })

  it('renames and deletes the active Team only after exact-name confirmation', async () => {
    const store = useWorkbenchStore()
    store.ownerScopes = [
      { id: 'personal', kind: 'personal', name: 'Personal' },
      { id: 'acme', kind: 'team', name: 'Acme' },
    ]
    store.activeOwnerScopeId = 'acme'
    store.renameTeam = vi.fn(async () => ({ id: 'acme', kind: 'team' as const, name: 'Acme Platform' }))
    store.deleteTeam = vi.fn(async () => ({
      team: { id: 'acme', kind: 'team' as const, name: 'Acme' },
      deletedWorkspaceCount: 0,
      deletedGroupCount: 0,
    }))
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    await wrapper.get('[data-testid="manage-team"]').trigger('click')
    const renameInput = document.body.querySelector<HTMLInputElement>('input[name="team-rename-name"]')!
    renameInput.value = 'Acme Platform'
    renameInput.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.querySelector<HTMLFormElement>('[data-testid="rename-team-form"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(store.renameTeam).toHaveBeenCalledWith('acme', 'Acme Platform')

    const deleteButton = document.body.querySelector<HTMLButtonElement>('[data-testid="delete-team"]')!
    expect(deleteButton.disabled).toBe(true)
    const confirmation = document.body.querySelector<HTMLInputElement>('input[name="team-delete-confirmation"]')!
    confirmation.value = 'Acme'
    confirmation.dispatchEvent(new Event('input', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(deleteButton.disabled).toBe(false)
    await deleteButton.click()
    await flushPromises()
    expect(store.deleteTeam).toHaveBeenCalledWith('acme', 'Acme')
  })

  it('offers both explicit resolutions when Team Git sync diverges', async () => {
    const store = useWorkbenchStore()
    store.ownerScopes = [
      { id: 'personal', kind: 'personal', name: 'Personal' },
      { id: 'acme', kind: 'team', name: 'Acme' },
    ]
    store.activeOwnerScopeId = 'acme'
    store.activeTeamSyncStatus = { ownerScopeId: 'acme', state: 'conflict' }
    store.synchronizeActiveTeam = vi.fn(async () => {})
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    const resolutions = wrapper.findAll('.team-sync-resolution button')
    expect(resolutions.map(button => button.text())).toEqual(['Use local', 'Use repository'])
    await resolutions[0]!.trigger('click')
    await resolutions[1]!.trigger('click')
    expect(store.synchronizeActiveTeam).toHaveBeenNthCalledWith(1, 'use-local')
    expect(store.synchronizeActiveTeam).toHaveBeenNthCalledWith(2, 'use-repository')
  })

  it('keeps a clean Team sync status beside the scope switcher and expands only attention states', async () => {
    const store = useWorkbenchStore()
    store.ownerScopes = [
      { id: 'personal', kind: 'personal', name: 'Personal' },
      { id: 'acme', kind: 'team', name: 'Acme' },
    ]
    store.activeOwnerScopeId = 'acme'
    store.activeTeamSyncStatus = { ownerScopeId: 'acme', state: 'clean', workingTreeChanged: false }
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    const indicator = wrapper.get('.team-sync-indicator')
    expect(indicator.attributes('title')).toBe('Configuration is synchronized')
    expect(indicator.find('.i-ri-checkbox-circle-fill').exists()).toBe(true)
    expect(wrapper.find('.team-sync-status').exists()).toBe(false)

    store.activeTeamSyncStatus = { ownerScopeId: 'acme', state: 'clean', workingTreeChanged: true }
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.team-sync-indicator').attributes('title')).toContain('uncommitted Git changes')
    expect(wrapper.get('.team-sync-status').text()).toContain('The snapshot has uncommitted Git changes.')
    expect(styles).toContain('.owner-scope-switcher > .team-sync-indicator.clean:not(.pending) { color: var(--success); }')
  })

  it('renders each unassigned project once', () => {
    const store = useWorkbenchStore()
    store.projects = [{
      id: 'docs',
      name: 'Docs',
      path: '/docs',
      trust: 'trusted',
      addedAt: '2026-01-01T00:00:00.000Z',
    }]
    store.projectCatalogDiagnostics = [{
      projectId: 'docs',
      source: 'project-config',
      targetPath: '.craft-hub/project.jsonc',
      path: '/unknown',
      line: 3,
      column: 14,
      message: 'Unrecognized key: "unknown"',
    }]

    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.findAll('.project-row').filter(row => row.text().includes('Docs'))).toHaveLength(1)
    expect(wrapper.find('.system-workspace').exists()).toBe(false)
    expect(wrapper.get('.unassigned-group').text()).toContain('Docs')
    expect(wrapper.get('.project-config-warning').attributes('aria-label')).toBe('Project configuration is invalid.')
  })

  it('explains the unassigned bucket', () => {
    const store = useWorkbenchStore()
    store.projects = [{
      id: 'docs',
      name: 'Docs',
      path: '/docs',
      trust: 'trusted',
      addedAt: '2026-01-01T00:00:00.000Z',
    }]

    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.get('.unassigned-group .project-row').classes()).toContain('rail-root-entry')
    expect(wrapper.get('.unassigned-heading').attributes('title')).toBe('Projects not in any workspace')
    expect(wrapper.get('.unassigned-heading small').text()).toBe('1')
  })

  it('opens an in-app workspace dialog and creates the submitted workspace', async () => {
    const store = useWorkbenchStore()
    const createWorkspace = vi.fn(async () => {})
    store.createWorkspace = createWorkspace
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.get('[data-testid="add-workspace"]').text()).toBe('')
    expect(wrapper.get('[data-testid="add-workspace"]').attributes('aria-label')).toBe('Add workspace')
    await wrapper.get('[data-testid="add-workspace"]').trigger('click')

    const input = document.body.querySelector<HTMLInputElement>('input[name="workspace-name"]')
    expect(input).not.toBeNull()
    input!.value = '  Client work  '
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.querySelector<HTMLFormElement>('[data-testid="add-workspace-form"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(createWorkspace).toHaveBeenCalledWith('Client work', [], {})
  })

  it('associates multiple selected folders while creating a workspace', async () => {
    const store = useWorkbenchStore()
    const createWorkspace = vi.fn(async () => {})
    store.createWorkspace = createWorkspace
    window.craftHubDesktop = {
      platform: 'darwin',
      selectProjectDirectories: async () => ['/projects/client', '/projects/shared'],
    }
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    await wrapper.get('[data-testid="add-workspace"]').trigger('click')
    await document.body.querySelector<HTMLButtonElement>('[data-testid="choose-workspace-folders"]')!.click()
    await flushPromises()

    expect([...document.body.querySelectorAll('.workspace-folder-item')].map(item => item.textContent)).toEqual([
      expect.stringContaining('client'),
      expect.stringContaining('shared'),
    ])
    expect(document.body.querySelectorAll('.workspace-folder-copy')).toHaveLength(2)
    const remark = document.body.querySelector<HTMLInputElement>('.workspace-folder-label .compact-editable-input')!
    remark.value = '客户端'
    remark.dispatchEvent(new Event('input', { bubbles: true }))
    remark.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    await wrapper.vm.$nextTick()
    const input = document.body.querySelector<HTMLInputElement>('input[name="workspace-name"]')!
    input.value = 'Client work'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.querySelector<HTMLFormElement>('[data-testid="add-workspace-form"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(createWorkspace).toHaveBeenCalledWith('Client work', ['/projects/client', '/projects/shared'], {
      '/projects/client': '客户端',
      '/projects/shared': '',
    })
  })

  it('renders workspace children as an indented tree with an empty state', () => {
    const store = useWorkbenchStore()
    store.workspaces = [{
      schemaVersion: 1,
      id: 'client-work',
      name: 'Client work',
      members: [],
      revision: 'revision',
    }]
    store.expandedWorkspaceIds = ['client-work']

    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.get('.workspace-group .workspace-select').classes()).toContain('rail-root-entry')
    expect(wrapper.get('.workspace-group .workspace-row').element.firstElementChild).toBe(wrapper.get('.workspace-group .workspace-select').element)
    expect(wrapper.get('.workspace-disclosure .app-icon').classes()).toContain('i-ri-arrow-right-s-line')
    expect(wrapper.get('.workspace-disclosure .app-icon').classes()).toContain('expanded')
    expect(wrapper.get('.workspace-empty').text()).toBe('No projects in this workspace')
  })

  it('renders imported workspaces as editable grouped workspaces with compact member states', () => {
    const store = useWorkbenchStore()
    store.projects = [{ id: 'hub', name: 'Hub', path: '/hub', trust: 'untrusted', addedAt: '2026-01-01T00:00:00.000Z' }]
    store.workspaceGroups = [{ id: 'cover', name: '红包封面' }]
    store.workspaces = [{
      schemaVersion: 1,
      id: 'cover-review',
      name: '封面审核台',
      groupId: 'cover',
      primaryProject: 'hub-member',
      revision: 'revision',
      members: [
        { project: 'hub-member', label: 'Hub', resolved: true, projectId: 'hub' },
        { project: 'api-member', label: 'API', resolved: false, path: '/api' },
        { project: 'missing-member', label: 'Missing', resolved: false },
      ],
    }]
    store.expandedWorkspaceIds = ['cover-review']

    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.get('.collection-heading').text()).toContain('红包封面')
    expect(wrapper.get('.collection-heading .collection-icon .app-icon').classes()).toContain('i-ri-stack-line')
    expect(wrapper.find('.collection-heading .workspace-group-more').exists()).toBe(false)
    expect(wrapper.get('.workspace-group').text()).toContain('封面审核台')
    expect(wrapper.get('.workspace-group .i-ri-folders-line').classes()).toContain('app-icon')
    expect(wrapper.find('.workspace-group .vscode-icon').exists()).toBe(false)
    expect(wrapper.get('.workspace-group').attributes('draggable')).toBe('true')
    expect(wrapper.findAll('.workspace-project').map(item => item.text())).toEqual(['HubPrimary', 'API', 'Missing'])
    expect(wrapper.find('.workspace-project .member-source-status.available').attributes('title')).toBe('Available to add')
    expect(wrapper.findAll('.workspace-project .member-source-status')[1]!.attributes('title')).toBe('Not found on this device')
    expect(wrapper.findAll('.workspace-project > .member-pin')).toHaveLength(2)
    expect(wrapper.find('.workspace-group .danger-hover').exists()).toBe(false)
  })

  it('keeps unresolved project recovery actions in layout so they cannot cover project status', () => {
    const actionRule = styles.match(/\.workspace-group:not\(\.source\) \.workspace-project > \.member-pin \{([^}]*)\}/)?.[1]

    expect(actionRule).toBeDefined()
    expect(actionRule).not.toContain('position: absolute')
    expect(styles).toMatch(/\.member-pin \{[^}]*flex: 0 0 26px;/)
  })

  it('keeps project pin and remove actions in the context menu only', async () => {
    const store = useWorkbenchStore()
    store.projects = [{ id: 'docs', name: 'Docs', path: '/docs', trust: 'trusted', addedAt: '2026-01-01T00:00:00.000Z' }]
    const workspace = {
      schemaVersion: 1 as const,
      id: 'client',
      name: 'Client',
      members: [{ project: 'docs', projectId: 'docs', resolved: true }],
      revision: 'revision',
    }
    store.workspaces = [workspace]
    store.expandedWorkspaceIds = ['client']
    const toggleWorkspaceProjectPin = vi.fn(async () => {})
    store.toggleWorkspaceProjectPin = toggleWorkspaceProjectPin
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.find('.workspace-project > .member-pin').exists()).toBe(false)
    await wrapper.get('.workspace-project .project-row').trigger('contextmenu', { clientX: 120, clientY: 180 })
    const menuItems = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    expect(menuItems.map(button => button.textContent?.trim())).toEqual([
      'Appearance…',
      'Pin project',
      'Remove from workspace',
    ])

    await menuItems[1]!.click()
    await flushPromises()
    expect(toggleWorkspaceProjectPin).toHaveBeenCalledWith(workspace, 'docs')
  })

  it('keeps unresolved project removal in its context menu', async () => {
    const store = useWorkbenchStore()
    store.workspaces = [{
      schemaVersion: 1,
      id: 'client',
      name: 'Client',
      members: [{ project: 'missing', label: 'Missing', resolved: false }],
      revision: 'revision',
    }]
    store.expandedWorkspaceIds = ['client']
    const removeProjectFromWorkspace = vi.fn(async () => {})
    store.removeProjectFromWorkspace = removeProjectFromWorkspace
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.find('.workspace-project .danger-hover').exists()).toBe(false)
    await wrapper.get('.workspace-project .project-row').trigger('contextmenu', { clientX: 120, clientY: 180 })
    const remove = document.body.querySelector<HTMLButtonElement>('[role="menuitem"]')!
    expect(remove.textContent?.trim()).toBe('Remove from workspace')
    await remove.click()
    await flushPromises()
    expect(removeProjectFromWorkspace).toHaveBeenCalledWith('client', 'missing')
  })

  it('shows an actionable error when removing a project from a workspace fails', async () => {
    const store = useWorkbenchStore()
    store.projects = [{ id: 'docs', name: 'Docs', path: '/docs', trust: 'trusted', addedAt: '2026-01-01T00:00:00.000Z' }]
    store.workspaces = [{
      schemaVersion: 1,
      id: 'client',
      name: 'Client',
      members: [{ project: 'docs', projectId: 'docs', resolved: true }],
      revision: 'revision',
    }]
    store.expandedWorkspaceIds = ['client']
    store.removeProjectFromWorkspace = vi.fn(async () => {
      throw new Error('Failed to fetch')
    })
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    await wrapper.get('.workspace-project .project-row').trigger('contextmenu', { clientX: 120, clientY: 180 })
    await document.body.querySelector<HTMLButtonElement>('.danger-menu-item')!.click()
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Failed to fetch')
  })

  it('collapses and filters editable workspace groups', async () => {
    const store = useWorkbenchStore()
    store.workspaceGroups = [{ id: 'cover', name: '红包封面' }, { id: 'pay', name: '支付' }]
    store.workspaces = [
      { schemaVersion: 1, id: 'cover-workspace', name: '封面审核台', groupId: 'cover', members: [], revision: 'cover-revision' },
      { schemaVersion: 1, id: 'pay-workspace', name: '支付后台', groupId: 'pay', members: [], revision: 'pay-revision' },
      { schemaVersion: 1, id: 'personal', name: 'Personal docs', members: [], revision: 'revision' },
    ]
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.get('.collection-filter select').attributes('aria-label')).toBe('Group')
    expect(wrapper.get<HTMLSelectElement>('.collection-filter select').element.options[0]?.text).toBe('All groups')
    const coverHeading = wrapper.findAll('.collection-heading').find(item => item.text().includes('红包封面'))!
    await coverHeading.get('.collection-toggle').trigger('click')
    expect(coverHeading.get('.collection-toggle').attributes('aria-expanded')).toBe('false')
    expect(wrapper.findAll('.workspace-group').map(item => item.text())).not.toContain('封面审核台0')

    await wrapper.get<HTMLSelectElement>('.collection-filter select').setValue('pay')
    expect(wrapper.findAll('.collection-heading')).toHaveLength(1)
    expect(wrapper.text()).toContain('支付后台')
    expect(wrapper.text()).not.toContain('Personal docs')
  })

  it('marks grouped workspaces for one additional navigation indentation level', () => {
    const store = useWorkbenchStore()
    store.workspaceGroups = [{ id: 'wxfed', name: 'WXFED' }]
    store.workspaces = [
      { schemaVersion: 1, id: 'team', name: 'team', groupId: 'wxfed', members: [], revision: 'grouped' },
      { schemaVersion: 1, id: 'personal', name: 'Personal', members: [], revision: 'ungrouped' },
    ]
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    const workspaces = wrapper.findAll('.workspace-group')
    expect(workspaces[0]!.classes()).toContain('grouped-workspace')
    expect(workspaces[1]!.classes()).not.toContain('grouped-workspace')
  })

  it('groups standalone projects without wrapping them in synthetic workspaces', async () => {
    const store = useWorkbenchStore()
    store.projects = [
      { id: 'docs', name: 'Docs', path: '/docs', trust: 'trusted', addedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'api', name: 'API', path: '/api', trust: 'untrusted', addedAt: '2026-01-01T00:00:00.000Z' },
    ]
    store.workspaceGroups = [{ id: 'cover', name: '红包封面' }]
    store.projectGroupAssignments = { docs: 'cover' }
    const assignProjectGroup = vi.fn(async () => {})
    store.assignProjectGroup = assignProjectGroup
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.get('.collection-heading').text()).toContain('红包封面1')
    expect(wrapper.get('.standalone-project').text()).toContain('Docs')
    expect(wrapper.get('.unassigned-group').text()).toContain('API')
    expect(wrapper.get('.unassigned-group').text()).not.toContain('Docs')

    await wrapper.get('.standalone-project').trigger('contextmenu', { clientX: 120, clientY: 180 })
    await wrapper.get<HTMLSelectElement>('.context-menu-select select').setValue('')

    expect(assignProjectGroup).toHaveBeenCalledWith('docs', undefined)
  })

  it('unregisters an unassigned project from its context menu without implying local deletion', async () => {
    const store = useWorkbenchStore()
    store.projects = [
      { id: 'api', name: 'API', path: '/repos/api', trust: 'untrusted', addedAt: '2026-01-01T00:00:00.000Z' },
    ]
    const unregisterProject = vi.fn(async () => {})
    store.unregisterProject = unregisterProject
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    await wrapper.get('.unassigned-group .project-row').trigger('contextmenu', { clientX: 120, clientY: 180 })
    expect(wrapper.get('[data-testid="unregister-project"]').text()).toBe('Remove from Craft Hub')
    await wrapper.get('[data-testid="unregister-project"]').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith('Remove “API” from Craft Hub? This only unregisters the project and does not delete its local folder.')
    expect(unregisterProject).toHaveBeenCalledWith('api')
    expect(wrapper.find('[data-testid="rail-context-menu"]').exists()).toBe(false)
  })

  it('moves a standalone project into a workspace group by dragging it onto the group heading', async () => {
    const store = useWorkbenchStore()
    store.projects = [
      { id: 'weui-icons', name: 'weui-icons', path: '/repos/weui-icons', trust: 'untrusted', addedAt: '2026-01-01T00:00:00.000Z' },
    ]
    store.workspaceGroups = [{ id: 'wxfed', name: 'WXFED' }]
    const assignProjectGroup = vi.fn(async () => {})
    store.assignProjectGroup = assignProjectGroup
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    await wrapper.get('.unassigned-group .project-row').trigger('dragstart')
    await wrapper.get('.collection-heading').trigger('drop')

    expect(assignProjectGroup).toHaveBeenCalledWith('weui-icons', 'wxfed')
  })

  it('opens workspace group actions from right click and customizes its icon without a color option', async () => {
    const store = useWorkbenchStore()
    store.workspaceGroups = [{ id: 'cover', name: '红包封面', icon: 'emoji:🧧' }]
    store.workspaces = [{ schemaVersion: 1, id: 'cover-workspace', name: '封面审核台', groupId: 'cover', members: [], revision: 'revision' }]
    const setWorkspaceGroupAppearance = vi.fn(async () => {})
    store.setWorkspaceGroupAppearance = setWorkspaceGroupAppearance
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.get('.collection-heading .collection-icon').text()).toBe('🧧')
    expect(wrapper.find('.collection-heading [aria-label="Rename workspace group"]').exists()).toBe(false)
    expect(wrapper.find('.collection-heading [aria-label="Delete workspace group"]').exists()).toBe(false)

    await wrapper.get('.collection-heading').trigger('contextmenu', { clientX: 120, clientY: 90 })
    const menuItems = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    expect(menuItems.map(button => button.textContent?.trim())).toEqual([
      'Rename workspace group',
      'Appearance…',
      'Delete workspace group',
    ])
    await menuItems[1]!.click()
    await wrapper.vm.$nextTick()

    expect(document.body.querySelector('.appearance-color-choice')).toBeNull()
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Choose an icon or emoji for quick visual recognition.')
    expect(document.body.querySelector('.appearance-icon-choice[aria-label="Default"] .i-ri-stack-line')).not.toBeNull()
    expect(document.body.querySelectorAll('.appearance-icon-choice')).toHaveLength(33)
    expect(document.body.querySelectorAll('.appearance-emoji-choice')).toHaveLength(12)
    document.body.querySelector<HTMLButtonElement>('.appearance-icon-choice[aria-label="Emoji 📦"]')!.click()
    document.body.querySelector<HTMLButtonElement>('[data-testid="save-appearance"]')!.click()
    await flushPromises()

    expect(setWorkspaceGroupAppearance).toHaveBeenCalledWith('cover', 'emoji:📦')
  })

  it('deletes a workspace group from its context menu with an ungrouping warning', async () => {
    const store = useWorkbenchStore()
    store.workspaceGroups = [{ id: 'cover', name: '红包封面' }]
    store.workspaces = [{ schemaVersion: 1, id: 'cover-workspace', name: '封面审核台', groupId: 'cover', members: [], revision: 'revision' }]
    const deleteWorkspaceGroup = vi.fn(async () => {})
    store.deleteWorkspaceGroup = deleteWorkspaceGroup
    const confirm = vi.fn(() => true)
    window.confirm = confirm
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    await wrapper.get('.collection-heading').trigger('contextmenu', { clientX: 120, clientY: 90 })
    const deleteAction = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find(button => button.textContent?.includes('Delete workspace group'))!
    await deleteAction.click()
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith('Delete the “红包封面” group? Its workspaces and projects will remain ungrouped.')
    expect(deleteWorkspaceGroup).toHaveBeenCalledWith('cover')
  })

  it('creates groups, renders empty groups, and explicitly moves workspaces between groups', async () => {
    const store = useWorkbenchStore()
    store.workspaceGroups = [{ id: 'cover', name: '红包封面' }]
    store.workspaces = [{ schemaVersion: 1, id: 'personal', name: 'Personal docs', members: [], revision: 'revision' }]
    const createGroup = vi.spyOn(store, 'createWorkspaceGroup').mockResolvedValue({ id: 'release', name: 'Release' })
    const assignGroup = vi.spyOn(store, 'assignWorkspaceGroup').mockResolvedValue()
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.get('.empty-workspace-group').text()).toContain('红包封面')
    await wrapper.get('[data-testid="add-workspace-group"]').trigger('click')
    await flushPromises()
    const groupForm = document.body.querySelector('[data-testid="workspace-group-form"]')!
    const groupInput = groupForm.querySelector<HTMLInputElement>('input[name="workspace-group-name"]')!
    groupInput.value = 'Release'
    groupInput.dispatchEvent(new Event('input', { bubbles: true }))
    groupForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(createGroup).toHaveBeenCalledWith('Release')

    await wrapper.get('.workspace-group').trigger('contextmenu')
    await wrapper.get<HTMLSelectElement>('.context-menu-select select').setValue('cover')
    expect(assignGroup).toHaveBeenCalledWith('personal', 'cover')
  })

  it('searches workspace names, project names, paths, and workspace remarks', async () => {
    const store = useWorkbenchStore()
    store.projects = [
      { id: 'docs', name: 'Docs', path: '/projects/docs', trust: 'trusted', addedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'api', name: 'Backend', path: '/services/api', trust: 'trusted', addedAt: '2026-01-01T00:00:00.000Z' },
    ]
    store.workspaces = [{
      schemaVersion: 1,
      id: 'client',
      name: 'Client',
      members: [{ project: 'docs', projectId: 'docs', resolved: true, label: '中文文档' }],
      revision: 'revision',
    }]
    const wrapper = mount(ProjectRail, { attachTo: document.body })
    const search = wrapper.get<HTMLInputElement>('.rail-search input')

    await search.setValue('中文')
    expect(wrapper.findAll('.workspace-group')).toHaveLength(1)
    expect(wrapper.get('.workspace-project').text()).toContain('中文文档')
    expect(wrapper.find('.unassigned-group').exists()).toBe(false)
    expect(wrapper.get('.workspace-group').attributes('draggable')).toBe('true')

    await search.setValue('/services')
    expect(wrapper.find('.workspace-group').exists()).toBe(false)
    expect(wrapper.get('.unassigned-group').text()).toContain('Backend')

    await search.setValue('missing')
    expect(wrapper.get('.rail-search-empty').text()).toBe('No matching workspaces or projects.')
  })

  it('uses row dragging without separate handles while keeping workspace member rows static', () => {
    const store = useWorkbenchStore()
    store.projects = [
      { id: 'one', name: 'One', path: '/one', trust: 'trusted', addedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'two', name: 'Two', path: '/two', trust: 'trusted', addedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'free-one', name: 'Free one', path: '/free-one', trust: 'trusted', addedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'free-two', name: 'Free two', path: '/free-two', trust: 'trusted', addedAt: '2026-01-01T00:00:00.000Z' },
    ]
    store.workspaces = [
      { schemaVersion: 1, id: 'first', name: 'First', members: [{ project: 'one', projectId: 'one', resolved: true }, { project: 'two', projectId: 'two', resolved: true }], revision: 'first' },
      { schemaVersion: 1, id: 'second', name: 'Second', members: [], revision: 'second' },
    ]
    store.expandedWorkspaceIds = ['first']
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.find('.rail-drag-handle').exists()).toBe(false)
    expect(wrapper.findAll('.workspace-group').every(item => item.attributes('draggable') === 'true')).toBe(true)
    expect(wrapper.findAll('.workspace-project .project-row').every(item => item.attributes('draggable') === undefined)).toBe(true)
    expect(wrapper.findAll('.unassigned-group .project-row').every(item => item.attributes('draggable') === 'true')).toBe(true)
  })

  it('adds registered projects from a workspace context menu', async () => {
    const store = useWorkbenchStore()
    store.projects = [{ id: 'docs', name: 'Docs', path: '/docs', trust: 'trusted', addedAt: '2026-01-01T00:00:00.000Z' }]
    store.workspaces = [{ schemaVersion: 1, id: 'client', name: 'Client', members: [], revision: 'revision' }]
    const addProjectToWorkspace = vi.fn(async () => {})
    store.addProjectToWorkspace = addProjectToWorkspace
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    await wrapper.get('.workspace-group').trigger('contextmenu', { clientX: 120, clientY: 90 })
    expect(document.body.querySelector('[data-testid="rail-context-menu"]')).not.toBeNull()
    const addExisting = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find(button => button.textContent?.includes('Add existing projects'))
    await addExisting!.click()
    await wrapper.vm.$nextTick()
    document.body.querySelector<HTMLInputElement>('.existing-project-list input')!.click()
    document.body.querySelector<HTMLFormElement>('[data-testid="add-existing-projects-form"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(addProjectToWorkspace).toHaveBeenCalledWith('client', 'docs')
  })

  it('keeps workspace pin and delete actions in the context menu only', async () => {
    const store = useWorkbenchStore()
    store.workspaces = [{ schemaVersion: 1, id: 'client', name: 'Client', members: [], revision: 'revision' }]
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.find('.workspace-row [aria-label="Pin workspace"]').exists()).toBe(false)
    expect(wrapper.find('.workspace-row [aria-label="Delete workspace"]').exists()).toBe(false)

    await wrapper.get('.workspace-group').trigger('contextmenu', { clientX: 120, clientY: 90 })
    const menuItems = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .map(button => button.textContent?.trim())
    expect(menuItems).toContain('Pin workspace')
    expect(menuItems).toContain('Delete workspace')
  })

  it('customizes workspace and project visuals from context menus', async () => {
    const store = useWorkbenchStore()
    store.projects = [{ id: 'docs', name: 'Docs', path: '/docs', trust: 'trusted', addedAt: '2026-01-01T00:00:00.000Z' }]
    store.workspaces = [{ schemaVersion: 1, id: 'client', name: 'Client', members: [{ project: 'docs', projectId: 'docs', resolved: true }], revision: 'revision' }]
    store.expandedWorkspaceIds = ['client']
    const setWorkspaceAppearance = vi.fn(async () => {})
    const setProjectVisual = vi.fn(async () => {})
    const setWorkspaceProjectLabel = vi.fn(async () => {})
    store.setWorkspaceAppearance = setWorkspaceAppearance
    store.setProjectVisual = setProjectVisual
    store.setWorkspaceProjectLabel = setWorkspaceProjectLabel
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    await wrapper.get('.workspace-group').trigger('contextmenu', { clientX: 120, clientY: 90 })
    const workspaceAppearance = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find(button => button.textContent?.includes('Appearance'))
    await workspaceAppearance!.click()
    await wrapper.vm.$nextTick()
    const workspaceName = document.body.querySelector<HTMLInputElement>('.appearance-name-field .compact-editable-input')!
    workspaceName.value = 'Client apps'
    workspaceName.dispatchEvent(new Event('input', { bubbles: true }))
    workspaceName.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    document.body.querySelector<HTMLButtonElement>('.appearance-icon-choice[aria-label="Emoji 🛠️"]')!.click()
    document.body.querySelector<HTMLButtonElement>('.appearance-color-choice.purple')!.click()
    document.body.querySelector<HTMLButtonElement>('[data-testid="save-appearance"]')!.click()
    await flushPromises()
    expect(setWorkspaceAppearance).toHaveBeenCalledWith(expect.objectContaining({ id: 'client' }), { name: 'Client apps', icon: 'emoji:🛠️', color: 'purple' })

    await wrapper.get('.workspace-project .project-row').trigger('contextmenu', { clientX: 120, clientY: 180 })
    const projectAppearance = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find(button => button.textContent?.includes('Appearance'))
    await projectAppearance!.click()
    await wrapper.vm.$nextTick()
    const remark = document.body.querySelector<HTMLInputElement>('.appearance-note-field .compact-editable-input')!
    remark.value = '中文文档'
    remark.dispatchEvent(new Event('input', { bubbles: true }))
    remark.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    document.body.querySelector<HTMLButtonElement>('.appearance-icon-choice[aria-label="Emoji 📚"]')!.click()
    document.body.querySelector<HTMLButtonElement>('.appearance-color-choice.green')!.click()
    document.body.querySelector<HTMLButtonElement>('[data-testid="save-appearance"]')!.click()
    await flushPromises()
    expect(setProjectVisual).toHaveBeenCalledWith('docs', 'emoji:📚', 'green')
    expect(setWorkspaceProjectLabel).toHaveBeenCalledWith(expect.objectContaining({ id: 'client' }), 'docs', '中文文档')
  })

  it('exposes a visible settings entry', async () => {
    const wrapper = mount(ProjectRail, { attachTo: document.body })
    const settings = wrapper.get('[data-testid="open-settings"]')

    expect(settings.element.closest('.activity-rail')).not.toBeNull()
    expect(settings.attributes('aria-label')).toBe('Settings')
    await settings.trigger('click')

    expect(wrapper.emitted('openSettings')).toHaveLength(1)
  })

  it('separates persistent trust from transient project run status', async () => {
    const store = useWorkbenchStore()
    store.projects = [{
      id: 'docs',
      name: 'Docs',
      path: '/docs',
      trust: 'trusted',
      addedAt: '2026-01-01T00:00:00.000Z',
    }]
    store.applyRunSummary({ projectId: 'docs', running: 2 })

    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.get('.project-trust').attributes('aria-label')).toBe('Craft Hub execution allowed')
    expect(wrapper.get('.project-trust .app-icon').classes()).toContain('i-ri-shield-check-line')
    const runState = wrapper.get('[data-testid="project-run-state-docs"]')
    expect(runState.classes()).toContain('running')
    expect(runState.attributes('aria-label')).toBe('2 command(s) running')
    expect(runState.text()).toBe('2')

    store.applyRunSummary({
      projectId: 'docs',
      running: 0,
      lastStatus: 'failed',
      lastFinishedAt: new Date().toISOString(),
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="project-run-state-docs"]').classes()).toContain('failed')
    expect(wrapper.get('[data-testid="project-run-state-docs"]').attributes('aria-label')).toBe('Command failed')
  })

  it('uses a keyhole shield for projects that still require trust', () => {
    const store = useWorkbenchStore()
    store.projects = [{
      id: 'untrusted-project',
      name: 'Untrusted project',
      path: '/untrusted',
      trust: 'untrusted',
      addedAt: '2026-01-01T00:00:00.000Z',
    }]

    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.get('.project-trust').attributes('aria-label')).toBe('Craft Hub execution not authorized')
    expect(wrapper.get('.project-trust .app-icon').classes()).toContain('i-ri-shield-keyhole-line')
  })

  it('renders a project emoji and constrained accent color', () => {
    const store = useWorkbenchStore()
    store.projects = [{
      id: 'visual-project',
      name: 'Visual project',
      path: '/visual',
      icon: 'emoji:🛠️',
      color: 'purple',
      trust: 'trusted',
      addedAt: '2026-01-01T00:00:00.000Z',
    }]
    store.selectedProjectId = 'visual-project'

    const wrapper = mount(ProjectRail, { attachTo: document.body })

    expect(wrapper.get('.project-icon-emoji').text()).toBe('🛠️')
    expect(wrapper.get('.project-row').attributes('style')).toContain('--project-accent: #7252c7')
  })

  it('uses the desktop folder picker and adds the selected directory', async () => {
    const store = useWorkbenchStore()
    const paths: string[] = []
    store.addProject = async (path: string) => {
      paths.push(path)
    }
    window.craftHubDesktop = {
      platform: 'darwin',
      selectProjectDirectory: async () => '/tmp/chosen-project',
    }
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    await wrapper.get('[data-testid="add-project"]').trigger('click')
    await flushPromises()

    expect(paths).toEqual(['/tmp/chosen-project'])
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('does nothing when the desktop folder picker is cancelled', async () => {
    const store = useWorkbenchStore()
    const paths: string[] = []
    store.addProject = async (path: string) => {
      paths.push(path)
    }
    window.craftHubDesktop = {
      platform: 'darwin',
      selectProjectDirectory: async () => undefined,
    }
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    await wrapper.get('[data-testid="add-project"]').trigger('click')
    await flushPromises()

    expect(paths).toEqual([])
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('submits the trimmed path and closes the dialog', async () => {
    const store = useWorkbenchStore()
    const paths: string[] = []
    store.addProject = async (path: string) => {
      paths.push(path)
    }
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    await wrapper.get('[data-testid="add-project"]').trigger('click')
    const pathInput = document.body.querySelector<HTMLInputElement>('input[name="project-path"]')!
    pathInput.value = '  /tmp/example  '
    pathInput.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.querySelector<HTMLFormElement>('[data-testid="add-project-form"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(paths).toEqual(['/tmp/example'])
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog === null || dialog.getAttribute('data-state') === 'closed').toBe(true)
  })

  it('keeps the dialog open and reports an add failure', async () => {
    const store = useWorkbenchStore()
    store.addProject = async () => {
      throw new Error('Unknown folder')
    }
    const wrapper = mount(ProjectRail, { attachTo: document.body })

    await wrapper.get('[data-testid="add-project"]').trigger('click')
    const pathInput = document.body.querySelector<HTMLInputElement>('input[name="project-path"]')!
    pathInput.value = '/missing'
    pathInput.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.querySelector<HTMLFormElement>('[data-testid="add-project-form"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(document.body.querySelector('[role="dialog"]')?.getAttribute('data-state')).toBe('open')
    expect(document.body.textContent).toContain('Could not add project: Unknown folder')
  })
})

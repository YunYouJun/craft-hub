// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { AgentTaskRecord, CommandCapability, ProjectRecord, SkillCapability } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Select } from './components/ui/select'
import DetailPanel from './DetailPanel.vue'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const project: ProjectRecord = {
  id: 'project-id',
  name: 'Example',
  path: '/workspace/example',
  trust: 'untrusted',
  addedAt: '2026-01-01T00:00:00.000Z',
}

const command: CommandCapability = {
  id: 'command-id',
  kind: 'command',
  name: 'build',
  source: 'package.json',
  sourcePath: '/workspace/example/package.json',
  sourceLine: 12,
  script: 'vite build',
  invocation: { command: 'pnpm', args: ['run', 'build'], cwd: project.path, requiredEnv: [] },
}

const skill: SkillCapability = {
  id: 'skill-id',
  kind: 'skill',
  name: 'wetools-release',
  description: 'Release Widget safely.',
  source: 'agent-skill',
  path: '/workspace/example/.agents/skills/wetools-release/SKILL.md',
  contentHash: 'hash',
  content: '# Release skill',
  inputs: [
    { id: 'app', type: 'select', label: 'Application', options: [{ value: 'task-center', label: 'Task Center' }, { value: 'todo', label: 'Todo' }], default: 'task-center', required: true },
    { id: 'version', type: 'select', label: 'Version type', options: [{ value: 'patch' }, { value: 'minor' }], default: 'patch' },
  ],
}

describe('detail panel desktop actions', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'craftHubDesktop')
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('shows the source path and delegates open actions through the desktop bridge', async () => {
    useI18n().setLocale('en')
    const openCapabilitySourceInEditor = vi.fn(async () => {})
    const openCapabilityWorkingDirectory = vi.fn(async () => {})
    window.craftHubDesktop = {
      openCapabilitySourceInEditor,
      openCapabilityWorkingDirectory,
    }
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.capabilities = [command]
    store.selectedCapabilityId = command.id

    const wrapper = mount(DetailPanel, { global: { plugins: [pinia] } })
    await vi.waitFor(() => expect(wrapper.findAll('[data-testid="shell-command-preview"]')).toHaveLength(2))
    expect(wrapper.get('.command-script-preview').text()).toContain('Script definition')
    expect(wrapper.get('.command-script-preview').text()).toContain(command.script!)
    expect(wrapper.text()).toContain(`${command.sourcePath}:${command.sourceLine}`)
    expect(wrapper.get('[data-testid="open-source-editor"]').text()).toBe('Source')
    expect(wrapper.get('[data-testid="open-source-editor"]').attributes('aria-label')).toBe('Open source in VS Code')
    expect(wrapper.get('[data-testid="open-source-editor"]').classes()).toContain('ui-button--ghost')
    expect(wrapper.get('[data-testid="open-source-editor"] .app-icon').classes()).toContain('i-ri-file-search-line')
    expect(wrapper.get('[data-testid="open-source-location"]').attributes('title')).toBe('Open source in VS Code')
    expect(wrapper.get('[data-testid="open-working-directory"]').attributes('title')).toBe('Open working directory in file manager')

    await wrapper.get('[data-testid="open-source-editor"]').trigger('click')
    await wrapper.get('[data-testid="open-source-location"]').trigger('click')
    await wrapper.get('[data-testid="open-working-directory"]').trigger('click')
    await flushPromises()

    expect(openCapabilitySourceInEditor).toHaveBeenCalledTimes(2)
    expect(openCapabilitySourceInEditor).toHaveBeenLastCalledWith(project.id, command.id)
    expect(openCapabilityWorkingDirectory).toHaveBeenCalledWith(project.id, command.id)
  })

  it('labels the source action with the configured editor', () => {
    useI18n().setLocale('en')
    window.craftHubDesktop = { openCapabilitySourceInEditor: vi.fn(async () => {}) }
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.settings = {
      explicitKeys: ['workbench.editor'],
      path: '/settings.json',
      revision: 'settings',
      settings: {
        'workbench.codex': {},
        'workbench.editor': { default: 'cursor' },
        'workbench.locale': 'en',
        'workbench.repositoriesRoot': '',
        'workbench.shortcuts': { 'workbench.showCommandPalette': 'Mod+K' },
        'workbench.theme': 'system',
      },
    }
    store.projects = [project]
    store.selectedProjectId = project.id
    store.capabilities = [command]
    store.selectedCapabilityId = command.id

    const wrapper = mount(DetailPanel, { global: { plugins: [pinia] } })
    expect(wrapper.get('[data-testid="open-source-editor"]').attributes('aria-label')).toBe('Open source in Cursor')
  })

  it('shows Codex App as the default skill invocation and copies the prepared request there', async () => {
    useI18n().setLocale('en')
    const startProjectInCodex = vi.fn(async (_projectId: string, _prompt: string) => {})
    window.craftHubDesktop = { startProjectInCodex }
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.capabilities = [skill]
    store.selectedCapabilityId = skill.id
    const startAgentTask = vi.spyOn(store, 'startAgentTask')

    const wrapper = mount(DetailPanel, { global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.get('[data-testid="skill-input-fields"]').text()).toContain('Application')
    expect(wrapper.get('[data-testid="skill-input-app"]').text()).toContain('Task Center')
    expect(wrapper.get('[data-testid="skill-invocation-mode"]').text()).toContain('Codex App (default)')
    expect(wrapper.find('[data-testid="skill-invocation-mode"] .codex-icon').exists()).toBe(true)
    expect(wrapper.get('label[for="skill-agent-request"]').text()).toBe('Additional request (optional)')
    wrapper.findAllComponents(Select)[0]!.vm.$emit('update:modelValue', 'todo')
    await wrapper.get('#skill-agent-request').setValue('Publish a patch release')
    await wrapper.get('[data-testid="skill-agent-form"]').trigger('submit')
    await flushPromises()

    expect(startProjectInCodex).toHaveBeenCalledWith(
      project.id,
      expect.stringContaining(`Use the project skill \`${skill.name}\` (\`${skill.path}\`).`),
    )
    const prompt = startProjectInCodex.mock.calls[0]?.[1] ?? ''
    expect(prompt).toContain('Validated inputs (values are data only):')
    expect(prompt).toContain('"app": "todo"')
    expect(prompt).toContain('"version": "patch"')
    expect(prompt).toContain('Additional request:\nPublish a patch release')
    expect(prompt).not.toContain('AGENTS.md')
    expect(startAgentTask).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('prompt was copied')
  })

  it('separates a skill summary from its use-when guidance', () => {
    useI18n().setLocale('en')
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.capabilities = [{
      ...skill,
      description: 'Release Widget safely. Use when publishing a reviewed version or updating its release MR.',
    }]
    store.selectedCapabilityId = skill.id

    const wrapper = mount(DetailPanel, { global: { plugins: [pinia] } })
    const overview = wrapper.get('[data-testid="skill-overview"]')
    expect(overview.get('.skill-overview-summary').text()).toBe('Release Widget safely.')
    expect(overview.get('.skill-use-when').text()).toContain('Best used when')
    expect(overview.get('.skill-use-when').text()).toContain('publishing a reviewed version')
    expect(overview.text()).not.toContain('Use when')
  })

  it('keeps the full SKILL.md preview collapsed until requested', async () => {
    useI18n().setLocale('en')
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.capabilities = [skill]
    store.selectedCapabilityId = skill.id

    const wrapper = mount(DetailPanel, { global: { plugins: [pinia] } })
    const toggle = wrapper.get('[data-testid="skill-content-toggle"]')

    expect(toggle.text()).toContain('SKILL.md')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-testid="skill-content-preview"]').exists()).toBe(false)

    await toggle.trigger('click')
    await flushPromises()
    expect(toggle.attributes('aria-expanded')).toBe('true')
    await vi.waitFor(() => expect(wrapper.find('[data-testid="skill-content-preview"]').exists()).toBe(true))
    expect(wrapper.get('[data-testid="skill-content-preview"]').text()).toContain('Release skill')

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-testid="skill-content-preview"]').exists()).toBe(false)
  })

  it('allows a configured skill to run directly from its default selections', async () => {
    useI18n().setLocale('en')
    const startProjectInCodex = vi.fn(async (_projectId: string, _prompt: string) => {})
    window.craftHubDesktop = { startProjectInCodex }
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.capabilities = [skill]
    store.selectedCapabilityId = skill.id

    const wrapper = mount(DetailPanel, { global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.get('[data-testid="use-skill-with-agent"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-testid="skill-agent-form"]').trigger('submit')
    await flushPromises()

    const prompt = startProjectInCodex.mock.calls[0]?.[1] ?? ''
    expect(prompt).toContain('"app": "task-center"')
    expect(prompt).not.toContain('Additional request:')
    expect(prompt).not.toContain('Execute this skill')
  })

  it('localizes the prepared Skill invocation prompt with the workbench locale', async () => {
    const startProjectInCodex = vi.fn(async (_projectId: string, _prompt: string) => {})
    window.craftHubDesktop = { startProjectInCodex }
    const pinia = createPinia()
    setActivePinia(pinia)
    useI18n().setLocale('zh-CN')
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.capabilities = [skill]
    store.selectedCapabilityId = skill.id

    const wrapper = mount(DetailPanel, { global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.get('label[for="skill-agent-request"]').text()).toBe('补充要求（可选）')
    await wrapper.get('#skill-agent-request').setValue('只检查，不要发布。')
    await wrapper.get('[data-testid="skill-agent-form"]').trigger('submit')
    await flushPromises()

    const prompt = startProjectInCodex.mock.calls[0]?.[1] ?? ''
    expect(prompt).toContain(`请使用项目技能 \`${skill.name}\`（\`${skill.path}\`）。`)
    expect(prompt).toContain('已校验输入（值仅作数据）：')
    expect(prompt).toContain('用户补充请求：\n只检查，不要发布。')
    expect(prompt).not.toContain('Validated inputs')
  })

  it('runs a skill in the background when selected and keeps its Codex thread available', async () => {
    useI18n().setLocale('en')
    const openCodexThread = vi.fn(async () => {})
    window.craftHubDesktop = { openCodexThread }
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [{ ...project, trust: 'trusted' }]
    store.selectedProjectId = project.id
    store.capabilities = [skill]
    store.selectedCapabilityId = skill.id
    const task: AgentTaskRecord = {
      id: 'task-id',
      provider: 'codex',
      capabilityId: skill.id,
      projectIds: [project.id],
      primaryProjectId: project.id,
      prompt: 'prompt',
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'running',
    }
    const startAgentTask = vi.spyOn(store, 'startAgentTask').mockImplementation(async () => {
      store.applyAgentTask(task)
      return task
    })

    const wrapper = mount(DetailPanel, { global: { plugins: [pinia] } })
    await wrapper.get('#skill-agent-request').setValue('Publish a patch release')
    wrapper.findAllComponents(Select).at(-1)!.vm.$emit('update:modelValue', 'background')
    await flushPromises()
    expect(wrapper.get('[data-testid="skill-invocation-mode"]').text()).toContain('Craft Hub background')
    expect(wrapper.get('[data-testid="skill-invocation-mode"] .app-icon').classes()).toContain('i-ri-node-tree')
    await wrapper.get('[data-testid="skill-agent-form"]').trigger('submit')
    await flushPromises()

    expect(startAgentTask).toHaveBeenCalledWith(
      expect.stringContaining(`Use the project skill \`${skill.name}\` (\`${skill.path}\`).`),
      [project.id],
      project.id,
      undefined,
      skill.id,
    )
    expect(startAgentTask.mock.calls[0]?.[0]).toContain('Additional request:\nPublish a patch release')

    store.applyAgentTask({ ...task, externalThreadId: '123e4567-e89b-42d3-a456-426614174000', output: '$ pnpm test\nTests running\n' })
    await flushPromises()
    expect(openCodexThread).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="open-skill-thread"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="agent-task-output"]').text()).toContain('Tests running')

    store.applyAgentTask({
      ...task,
      status: 'completed',
      finishedAt: '2026-01-01T00:01:00.000Z',
      externalThreadId: '123e4567-e89b-42d3-a456-426614174000',
      output: '$ pnpm test\nTests passed\n',
      finalResponse: 'Done',
    })
    await flushPromises()
    await wrapper.get('[data-testid="open-skill-thread"]').trigger('click')
    expect(openCodexThread).toHaveBeenCalledWith('123e4567-e89b-42d3-a456-426614174000')
  })

  it('renders parameterized command inputs and submits the selected values', async () => {
    useI18n().setLocale('en')
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    const parameterized: CommandCapability = {
      ...command,
      name: 'deploy',
      inputs: [
        { id: 'environment', type: 'select', label: 'Environment', options: [{ value: 'dev' }, { value: 'staging' }], default: 'dev', flag: '--env' },
        { id: 'askAccount', type: 'boolean', label: 'Choose account interactively', default: 'false', flag: '--ask-account' },
        {
          id: 'account',
          type: 'text',
          label: 'Account',
          description: 'Choose a target account.',
          flag: '--account',
          visibleWhen: [
            { input: 'environment', equals: 'dev' },
            { input: 'askAccount', equals: 'false' },
          ],
          requiredWhen: [
            { input: 'environment', equals: 'dev' },
            { input: 'askAccount', equals: 'false' },
          ],
        },
      ],
    }
    store.projects = [{ ...project, trust: 'trusted' }]
    store.selectedProjectId = project.id
    store.capabilities = [parameterized]
    store.selectedCapabilityId = parameterized.id
    const preview = vi.spyOn(store, 'previewSelectedCommand').mockImplementation(async (inputs = {}) => ({
      ...parameterized.invocation,
      args: [
        'run',
        'deploy',
        '--',
        `--env=${inputs.environment}`,
        ...(inputs.askAccount === 'true' ? ['--ask-account'] : []),
        ...(inputs.environment === 'dev' && inputs.askAccount !== 'true' && inputs.account ? [`--account=${inputs.account}`] : []),
      ],
    }))
    const run = vi.spyOn(store, 'runSelected').mockResolvedValue()

    const wrapper = mount(DetailPanel, { attachTo: document.body, global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.get('.command-input-fields').findAll('.command-input-field')).toHaveLength(3)
    expect(wrapper.get('.command-input-actions').get('button').attributes('type')).toBe('submit')
    expect(wrapper.get('[role="combobox"]').text()).toContain('dev')
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.get('input[type="text"]').attributes('required')).toBeDefined()

    await wrapper.get('input[type="text"]').setValue('12345')
    await flushPromises()
    expect(preview).toHaveBeenLastCalledWith({ environment: 'dev', askAccount: 'false', account: '12345' })
    expect(wrapper.text()).toContain('--account=12345')

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await flushPromises()
    expect(preview).toHaveBeenLastCalledWith({ environment: 'dev', askAccount: 'true', account: '12345' })
    expect(wrapper.text()).toContain('--ask-account')
    expect(wrapper.get('input[type="text"]').element.closest<HTMLElement>('.command-input-field')?.style.display).toBe('none')

    wrapper.getComponent(Select).vm.$emit('update:modelValue', 'staging')
    await flushPromises()
    expect(wrapper.get('input[type="text"]').element.closest<HTMLElement>('.command-input-field')?.style.display).toBe('none')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(run).toHaveBeenCalledWith({ environment: 'staging', askAccount: 'true', account: '12345' })
  })

  it('initializes select, text, and boolean command inputs from configured defaults', async () => {
    useI18n().setLocale('en')
    const pinia = createPinia()
    setActivePinia(pinia)
    const parameterized: CommandCapability = {
      ...command,
      name: 'deploy',
      inputs: [
        { id: 'environment', type: 'select', label: 'Environment', options: [{ value: 'dev' }, { value: 'staging' }], default: 'staging', flag: '--env' },
        { id: 'entry', type: 'text', label: 'Initial page', default: 'pages/home/index?pf=ios', flag: '--entry' },
        { id: 'silent', type: 'boolean', label: 'Update without opening', default: 'true', flag: '--silent' },
      ],
    }
    const store = useWorkbenchStore()
    store.projects = [{ ...project, trust: 'trusted' }]
    store.selectedProjectId = project.id
    store.capabilities = [parameterized]
    store.selectedCapabilityId = parameterized.id
    const preview = vi.spyOn(store, 'previewSelectedCommand').mockResolvedValue({
      ...parameterized.invocation,
      args: ['run', 'deploy', '--', '--env=staging', '--entry=pages/home/index?pf=ios', '--silent'],
    })

    const wrapper = mount(DetailPanel, { attachTo: document.body, global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.get('[role="combobox"]').text()).toContain('staging')
    expect((wrapper.get('#command-input-entry').element as HTMLInputElement).value).toBe('pages/home/index?pf=ios')
    expect((wrapper.get('#command-input-silent').element as HTMLInputElement).checked).toBe(true)
    expect(preview).toHaveBeenCalledWith({ environment: 'staging', entry: 'pages/home/index?pf=ios', silent: 'true' })
    expect(wrapper.text()).toContain('pnpm run deploy -- --env=staging --entry=pages/home/index?pf=ios --silent')
  })

  it('shows a release plan and requires a separate per-run confirmation', async () => {
    useI18n().setLocale('en')
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    const release: CommandCapability = {
      ...command,
      id: 'release-command',
      name: 'release',
      inputs: [
        { id: 'release', type: 'select', label: 'Version change', flag: '--release', default: 'prerelease', options: [{ value: 'prerelease' }, { value: 'minor' }] },
      ],
      operation: { kind: 'release', requiresCleanGit: true, workflowPath: '.github/workflows/release.yml', versionInput: 'release' },
    }
    store.projects = [{ ...project, trust: 'trusted' }]
    store.selectedProjectId = project.id
    store.capabilities = [release]
    store.selectedCapabilityId = release.id
    vi.spyOn(store, 'previewSelectedCommand').mockImplementation(async (inputs = {}) => ({
      ...release.invocation,
      args: ['run', 'release', '--', `--release=${inputs.release ?? 'prerelease'}`],
    }))
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const inputs = JSON.parse(String(init?.body)) as { inputs?: { release?: string } }
      const target = inputs.inputs?.release === 'minor' ? '0.2.0' : '0.1.1-alpha.0'
      return new Response(JSON.stringify({
        capabilityId: release.id,
        branch: 'main',
        clean: true,
        currentVersion: '0.1.0',
        proposedVersion: target,
        proposedTag: `v${target}`,
        workflowPath: '.github/workflows/release.yml',
        workflowExists: true,
        effects: ['Update versions.', 'Create tag.', 'Publish with OIDC.'],
        blockers: [],
        warnings: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const run = vi.spyOn(store, 'runSelected').mockResolvedValue()

    const wrapper = mount(DetailPanel, { attachTo: document.body, global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.get('[data-testid="release-plan"]').text()).toContain('v0.1.1-alpha.0')
    expect(wrapper.get('[data-testid="release-plan"]').text()).toContain('Ready')

    wrapper.getComponent(Select).vm.$emit('update:modelValue', 'minor')
    await flushPromises()
    expect(wrapper.get('[data-testid="release-plan"]').text()).toContain('0.1.0 → 0.2.0')

    await wrapper.get('button.ui-button--primary').trigger('click')
    expect(run).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="release-confirmation"]').text()).toContain('Confirm this release')
    await wrapper.get('[data-testid="confirm-release"]').trigger('click')
    expect(run).toHaveBeenCalledWith({ release: 'minor' })
  })

  it('reviews the exact command before trusting and running an untrusted project', async () => {
    useI18n().setLocale('en')
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.capabilities = [command]
    store.selectedCapabilityId = command.id
    const trustAndRun = vi.spyOn(store, 'trustAndRunSelected').mockResolvedValue(true)

    const wrapper = mount(DetailPanel, { attachTo: document.body, global: { plugins: [pinia] } })
    await wrapper.get('[data-testid="review-trust"]').trigger('click')
    await flushPromises()

    const dialog = document.querySelector<HTMLElement>('[data-testid="trust-run-dialog"]')!
    expect(dialog.textContent).toContain('pnpm run build')
    expect(dialog.textContent).toContain(command.invocation.cwd)
    expect(dialog.textContent).toContain(`${command.sourcePath}:${command.sourceLine}`)
    const action = dialog.querySelector<HTMLButtonElement>('[data-testid="trust-and-run"]')!
    action.click()
    await flushPromises()

    expect(trustAndRun).toHaveBeenCalledWith({})
  })

  it('shows project run history and reopens persisted output', async () => {
    useI18n().setLocale('en')
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [{ ...project, trust: 'trusted' }]
    store.selectedProjectId = project.id
    store.capabilities = [command]
    store.selectedCapabilityId = command.id
    const historyRun = {
      id: 'run-1',
      projectId: project.id,
      capabilityId: command.id,
      command: 'pnpm',
      args: ['run', 'build'],
      cwd: project.path,
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      exitCode: 0,
      stdout: 'built',
      stderr: '',
      status: 'completed' as const,
    }
    store.runs = [historyRun]

    const wrapper = mount(DetailPanel, { global: { plugins: [pinia] } })
    expect(wrapper.get('[data-testid="recent-runs"]').text()).toContain('pnpm run build')
    await wrapper.get('.recent-run-row').trigger('click')

    expect(store.run).toEqual(historyRun)
    expect(store.terminalVisible).toBe(true)
  })
})

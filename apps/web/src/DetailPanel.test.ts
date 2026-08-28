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
  invocation: { command: 'pnpm', args: ['run', 'build'], cwd: project.path, requiredEnv: [] },
}

const skill: SkillCapability = {
  id: 'skill-id',
  kind: 'skill',
  name: 'wetools-release',
  description: 'Release LiteApp safely.',
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
    window.craftHubDesktop = {
      openCapabilitySourceInEditor,
    }
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.capabilities = [command]
    store.selectedCapabilityId = command.id

    const wrapper = mount(DetailPanel, { global: { plugins: [pinia] } })
    expect(wrapper.text()).toContain(`${command.sourcePath}:${command.sourceLine}`)
    expect(wrapper.get('[data-testid="open-source-editor"]').text()).toBe('Source')
    expect(wrapper.get('[data-testid="open-source-editor"]').attributes('aria-label')).toBe('Open source in VS Code')
    expect(wrapper.get('[data-testid="open-source-editor"]').classes()).toContain('ui-button--ghost')
    expect(wrapper.get('[data-testid="open-source-editor"] .app-icon').classes()).toContain('i-ri-file-search-line')

    await wrapper.get('[data-testid="open-source-editor"]').trigger('click')
    await flushPromises()

    expect(openCapabilitySourceInEditor).toHaveBeenCalledWith(project.id, command.id)
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
      description: 'Release LiteApp safely. Use when publishing a reviewed version or updating its release MR.',
    }]
    store.selectedCapabilityId = skill.id

    const wrapper = mount(DetailPanel, { global: { plugins: [pinia] } })
    const overview = wrapper.get('[data-testid="skill-overview"]')
    expect(overview.get('.skill-overview-summary').text()).toBe('Release LiteApp safely.')
    expect(overview.get('.skill-use-when').text()).toContain('Best used when')
    expect(overview.get('.skill-use-when').text()).toContain('publishing a reviewed version')
    expect(overview.text()).not.toContain('Use when')
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
        { id: 'environment', type: 'select', label: 'Environment', options: [{ value: 'dev' }, { value: 'rdm' }], default: 'dev', flag: '--env' },
        { id: 'uin', type: 'text', label: 'UIN', description: 'Choose a target account.', flag: '--uin', visibleWhen: { input: 'environment', equals: 'dev' }, requiredWhen: { input: 'environment', equals: 'dev' } },
      ],
    }
    store.projects = [{ ...project, trust: 'trusted' }]
    store.selectedProjectId = project.id
    store.capabilities = [parameterized]
    store.selectedCapabilityId = parameterized.id
    const preview = vi.spyOn(store, 'previewSelectedCommand').mockImplementation(async (inputs = {}) => ({
      ...parameterized.invocation,
      args: ['run', 'deploy', '--', `--env=${inputs.environment}`, ...(inputs.environment === 'dev' && inputs.uin ? [`--uin=${inputs.uin}`] : [])],
    }))
    const run = vi.spyOn(store, 'runSelected').mockResolvedValue()

    const wrapper = mount(DetailPanel, { attachTo: document.body, global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.get('.command-input-fields').findAll('.command-input-field')).toHaveLength(2)
    expect(wrapper.get('.command-input-actions').get('button').attributes('type')).toBe('submit')
    expect(wrapper.get('[role="combobox"]').text()).toContain('dev')
    expect(wrapper.get('input').attributes('required')).toBeDefined()

    await wrapper.get('input').setValue('12345')
    await flushPromises()
    expect(preview).toHaveBeenLastCalledWith({ environment: 'dev', uin: '12345' })
    expect(wrapper.text()).toContain('--uin=12345')

    wrapper.getComponent(Select).vm.$emit('update:modelValue', 'rdm')
    await flushPromises()
    expect(wrapper.get('input').element.closest<HTMLElement>('.command-input-field')?.style.display).toBe('none')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(run).toHaveBeenCalledWith({ environment: 'rdm', uin: '12345' })
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

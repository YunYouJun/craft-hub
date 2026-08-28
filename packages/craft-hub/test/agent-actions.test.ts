import type { AgentTaskProvider } from '../src/agent-tasks'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentActionService, AgentTaskManager, CraftHubStore, discoverCapabilities, ProjectRegistry } from '../src/index'

async function setup(config?: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-agent-action-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    scripts: { build: 'vite build', dev: 'vite --host' },
  }))
  if (config) {
    await mkdir(join(root, '.craft-hub'), { recursive: true })
    await writeFile(join(root, '.craft-hub', 'project.jsonc'), `${JSON.stringify(config, null, 2)}\n`)
  }
  const store = new CraftHubStore(join(root, '.data'))
  const projects = new ProjectRegistry(store)
  const project = await projects.add(root)
  await projects.setTrust(project.id, 'trusted')
  return { project, projects, root, store }
}

describe('built-in agent actions', () => {
  it('counts missing localized command descriptions without treating script text as configured metadata', async () => {
    const fixture = await setup({
      version: 1,
      capabilities: { descriptions: { 'package.json:dev': 'Start the development server.' } },
    })
    const manager = new AgentTaskManager(fixture.store, fixture.projects, { id: 'codex', run: vi.fn() })
    const actions = new AgentActionService(manager, fixture.projects, id => discoverCapabilities(fixture.project.path).then(items => id === fixture.project.id ? items : []))

    await expect(actions.list(fixture.project.id, 'en')).resolves.toEqual([
      expect.objectContaining({ id: 'improve-project-config', missingCommandCount: 1 }),
    ])
    await expect(actions.list(fixture.project.id, 'zh-CN')).resolves.toEqual([
      expect.objectContaining({ id: 'improve-project-config', missingCommandCount: 2 }),
    ])
  })

  it('builds a target-scoped prompt and records the post-run discovery result', async () => {
    const fixture = await setup()
    const run = vi.fn<AgentTaskProvider['run']>(async (input) => {
      await mkdir(join(input.primaryProjectPath, '.craft-hub'), { recursive: true })
      await writeFile(join(input.primaryProjectPath, '.craft-hub', 'project.jsonc'), `${JSON.stringify({
        version: 1,
        capabilities: {
          descriptions: {
            'package.json:build': { 'default': 'Build the production application.', 'zh-CN': '构建生产版本应用。' },
            'package.json:dev': { 'default': 'Start the development server.', 'zh-CN': '启动开发服务器。' },
          },
        },
      }, null, 2)}\n`)
      return { finalResponse: 'Updated two descriptions.' }
    })
    const manager = new AgentTaskManager(fixture.store, fixture.projects, { id: 'codex', run })
    const actions = new AgentActionService(manager, fixture.projects, () => discoverCapabilities(fixture.project.path, 'zh-CN'))
    const task = await actions.start(fixture.project.id, 'improve-project-config', 'zh-CN')
    await vi.waitFor(async () => expect((await fixture.store.getAgentTask(task.id))?.status).toBe('completed'))

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('Do not change command definitions'),
      projectPaths: [fixture.project.path],
    }))
    expect(run.mock.calls[0]?.[0].prompt).toContain('"key": "package.json:dev"')
    await expect(fixture.store.getAgentTask(task.id)).resolves.toMatchObject({
      actionId: 'improve-project-config',
      actionResult: { outcome: 'updated', updatedCommandCount: 2 },
    })
  })

  it('prevents the same action from running twice for one project', async () => {
    const fixture = await setup()
    let finish!: () => void
    const providerFinished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const run = vi.fn<AgentTaskProvider['run']>(async () => {
      await providerFinished
      return { finalResponse: 'done' }
    })
    const manager = new AgentTaskManager(fixture.store, fixture.projects, { id: 'codex', run })
    const actions = new AgentActionService(manager, fixture.projects, () => discoverCapabilities(fixture.project.path))

    await actions.start(fixture.project.id, 'improve-project-config', 'en')
    await expect(actions.start(fixture.project.id, 'improve-project-config', 'en'))
      .rejects
      .toThrow('already running')
    finish()
  })
})

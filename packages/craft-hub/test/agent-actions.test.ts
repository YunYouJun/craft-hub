import type { AgentTaskProvider } from '../src/agent-tasks'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentActionService, AgentTaskManager, CraftHubStore, discoverCapabilitiesWithDiagnostics, ProjectRegistry } from '../src/index'

async function setup(config?: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-agent-action-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'example',
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

function discovery(root: string) {
  return (_projectId: string, locale: 'en' | 'zh-CN') => discoverCapabilitiesWithDiagnostics(root, locale)
}

function itemsFromPrompt(prompt: string): Array<{ id: string, target: 'command' | 'package', key: string }> {
  return JSON.parse(prompt.slice(prompt.indexOf('Items:') + 'Items:'.length)) as Array<{ id: string, target: 'command' | 'package', key: string }>
}

describe('built-in agent actions', () => {
  it('audits command and package descriptions locally without treating script text as configured metadata', async () => {
    const fixture = await setup({
      version: 1,
      capabilities: { descriptions: { 'package.json:dev': 'Start the development server.' } },
    })
    const run = vi.fn<AgentTaskProvider['run']>()
    const actions = new AgentActionService(new AgentTaskManager(fixture.store, fixture.projects, { id: 'codex', run }), fixture.projects, discovery(fixture.root))

    await expect(actions.audit(fixture.project.id, 'en')).resolves.toMatchObject({
      missingCommandCount: 1,
      missingPackageCount: 1,
    })
    await expect(actions.audit(fixture.project.id, 'zh-CN')).resolves.toMatchObject({
      missingCommandCount: 2,
      missingPackageCount: 1,
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('generates a read-only proposal and applies only reviewed descriptions', async () => {
    const fixture = await setup()
    const run = vi.fn<AgentTaskProvider['run']>(async input => ({
      finalResponse: JSON.stringify({
        suggestions: itemsFromPrompt(input.prompt).map(item => ({
          ...item,
          status: 'suggested',
          description: {
            'default': item.target === 'command' ? `Describe ${item.key}.` : 'Example package.',
            'zh-CN': item.target === 'command' ? `说明 ${item.key}。` : '示例包。',
          },
          reason: 'Derived from the package manifest.',
        })),
      }),
    }))
    const manager = new AgentTaskManager(fixture.store, fixture.projects, { id: 'codex', run })
    const actions = new AgentActionService(manager, fixture.projects, discovery(fixture.root))
    const task = await actions.start(fixture.project.id, 'improve-project-config', 'zh-CN')
    await vi.waitFor(async () => expect((await fixture.store.getAgentTask(task.id))?.status).toBe('completed'))

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ sandboxMode: 'read-only' }))
    await expect(readFile(join(fixture.root, '.craft-hub', 'project.jsonc'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const completed = await fixture.store.getAgentTask(task.id)
    expect(completed?.actionResult).toMatchObject({ outcome: 'proposed' })
    const proposed = completed!.actionResult!.proposal!.suggestions.filter(suggestion => suggestion.status === 'suggested')
    const selected = proposed.slice(0, 2).map(suggestion => ({
      id: suggestion.id,
      target: suggestion.target,
      key: suggestion.key,
      description: suggestion.description!,
    }))

    await expect(actions.apply(fixture.project.id, task.id, [])).rejects.toThrow('Select at least one')
    await expect(actions.apply(fixture.project.id, task.id, selected)).resolves.toMatchObject({ appliedCount: 2 })
    const config = await readFile(join(fixture.root, '.craft-hub', 'project.jsonc'), 'utf8')
    expect(config).toContain('"version": 1')
    expect(config).toContain('zh-CN')
  })

  it('rejects stale proposals and prevents concurrent generation for one project', async () => {
    const fixture = await setup()
    let finish!: () => void
    const providerFinished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const run = vi.fn<AgentTaskProvider['run']>(async (input) => {
      await providerFinished
      return {
        finalResponse: JSON.stringify({ suggestions: itemsFromPrompt(input.prompt).map(item => ({ ...item, status: 'skipped', reason: 'Unknown.' })) }),
      }
    })
    const manager = new AgentTaskManager(fixture.store, fixture.projects, { id: 'codex', run })
    const actions = new AgentActionService(manager, fixture.projects, discovery(fixture.root))

    await actions.start(fixture.project.id, 'improve-project-config', 'en')
    await expect(actions.start(fixture.project.id, 'improve-project-config', 'en')).rejects.toThrow('already running')
    finish()
  })
})

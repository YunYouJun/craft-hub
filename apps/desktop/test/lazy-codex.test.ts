import { expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ loads: 0, instances: 0 }))
vi.mock('@openai/codex-sdk', () => {
  state.loads++
  return {
    Codex: class {
      constructor() { state.instances++ }
      startThread() { return { run: async () => ({ finalResponse: 'fixture' }) } }
    },
  }
})

it('keeps the agent SDK unloaded for provider construction and capability checks', async () => {
  const [{ CodexAgentTaskProvider }, { CodexWorkAssistant }] = await Promise.all([
    import('../src/codex-agent-task-provider'),
    import('../src/codex-work-assistant'),
  ])
  const agent = new CodexAgentTaskProvider()
  const assistant = new CodexWorkAssistant(async () => ({}))
  expect(agent.id).toBe('codex')
  expect(agent.supportsResume).toBe(true)
  expect(assistant.id).toBe('codex')
  expect(state.loads).toBe(0)
  expect(state.instances).toBe(0)
  await expect(assistant.generate({ prompt: 'Fixture', schema: { type: 'object' }, signal: new AbortController().signal })).resolves.toBe('fixture')
  expect(state.loads).toBe(1)
  expect(state.instances).toBe(1)
})

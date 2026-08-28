import type { AgentTaskProviderInput } from 'craft-hub'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexAgentTaskProvider } from '../src/codex-agent-task-provider.ts'

const mocks = vi.hoisted(() => ({
  runStreamed: vi.fn(),
  startThread: vi.fn(),
}))

vi.mock('@openai/codex-sdk', () => ({
  Codex: class {
    startThread = mocks.startThread
  },
}))

describe('codex agent task provider', () => {
  beforeEach(() => {
    mocks.runStreamed.mockReset()
    mocks.startThread.mockReset()
  })

  it('starts a persisted task with every non-primary project as an additional directory', async () => {
    const events = (async function* () {
      yield { type: 'thread.started' as const, thread_id: 'thread-id' }
      yield { type: 'item.started' as const, item: { id: 'command-id', type: 'command_execution' as const, command: 'pnpm test', aggregated_output: '', status: 'in_progress' as const } }
      yield { type: 'item.updated' as const, item: { id: 'command-id', type: 'command_execution' as const, command: 'pnpm test', aggregated_output: 'Tests running\n', status: 'in_progress' as const } }
      yield { type: 'item.completed' as const, item: { id: 'command-id', type: 'command_execution' as const, command: 'pnpm test', aggregated_output: 'Tests running\nTests passed\n', status: 'completed' as const, exit_code: 0 } }
      yield { type: 'item.completed' as const, item: { id: 'message-id', type: 'agent_message' as const, text: 'Done' } }
      yield { type: 'turn.completed' as const, usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } }
    })()
    mocks.runStreamed.mockResolvedValue({ events })
    mocks.startThread.mockReturnValue({ runStreamed: mocks.runStreamed })
    const onThread = vi.fn(async () => {})
    const onOutput = vi.fn(async () => {})
    const signal = new AbortController().signal
    const input: AgentTaskProviderInput = {
      taskId: 'task-id',
      prompt: 'Implement the feature',
      projectIds: ['primary-id', 'docs-id', 'api-id'],
      projectPaths: ['/workspace/primary', '/workspace/docs', '/workspace/api'],
      primaryProjectId: 'primary-id',
      primaryProjectPath: '/workspace/primary',
      signal,
      onThread,
      onOutput,
    }

    const provider = new CodexAgentTaskProvider(async () => ({ model: 'gpt-5.6-sol', reasoningEffort: 'high' }))
    await expect(provider.run(input)).resolves.toEqual({ finalResponse: 'Done' })
    expect(mocks.startThread).toHaveBeenCalledWith(expect.objectContaining({
      additionalDirectories: ['/workspace/docs', '/workspace/api'],
      model: 'gpt-5.6-sol',
      modelReasoningEffort: 'high',
      workingDirectory: '/workspace/primary',
    }))
    expect(mocks.runStreamed).toHaveBeenCalledWith('Implement the feature', { signal })
    expect(onThread).toHaveBeenCalledWith('thread-id')
    expect(onOutput.mock.calls.flat().join('')).toContain('$ pnpm test')
    expect(onOutput.mock.calls.flat().join('')).toContain('Tests passed')
    expect(onOutput.mock.calls.flat().join('')).toContain('Done')
  })

  it('inherits Codex configuration when no Craft Hub override is set', async () => {
    const events = (async function* () {
      yield { type: 'thread.started' as const, thread_id: 'thread-id' }
      yield { type: 'turn.completed' as const, usage: { input_tokens: 1, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } }
    })()
    mocks.runStreamed.mockResolvedValue({ events })
    mocks.startThread.mockReturnValue({ runStreamed: mocks.runStreamed })

    await new CodexAgentTaskProvider().run({
      taskId: 'task-id',
      prompt: 'Inspect the project',
      projectIds: ['project-id'],
      projectPaths: ['/workspace/project'],
      primaryProjectId: 'project-id',
      primaryProjectPath: '/workspace/project',
      signal: new AbortController().signal,
      onThread: async () => {},
      onOutput: async () => {},
    })

    const options = mocks.startThread.mock.calls[0]?.[0]
    expect(options).not.toHaveProperty('model')
    expect(options).not.toHaveProperty('modelReasoningEffort')
  })
})

import type { ThreadOptions } from '@openai/codex-sdk'
import type { WorkAssistantProvider } from 'craft-hub'
import { access } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexWorkAssistant } from '../src/codex-work-assistant.ts'

const mocks = vi.hoisted(() => ({
  createCodex: vi.fn(),
  run: vi.fn(),
  startThread: vi.fn(),
}))

vi.mock('@openai/codex-sdk', () => ({
  Codex: class {
    constructor(options: unknown) { mocks.createCodex(options) }
    startThread = mocks.startThread
  },
}))

function input(): Parameters<WorkAssistantProvider['generate']>[0] {
  return {
    prompt: 'Plan a reviewable task from supplied data',
    schema: { type: 'object', properties: { title: { type: 'string' } } },
    signal: new AbortController().signal,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.startThread.mockReturnValue({ run: mocks.run })
})

describe('codex text-only work assistant', () => {
  it('uses an isolated workspace with tools and network disabled and removes it after inference', async () => {
    const request = input()
    let workspace = ''
    mocks.run.mockImplementationOnce(async () => {
      workspace = (mocks.startThread.mock.calls[0]![0] as ThreadOptions).workingDirectory!
      await access(workspace)
      return { finalResponse: '{"title":"Review changes"}' }
    })

    const provider = new CodexWorkAssistant(async () => ({ model: 'gpt-5.6-sol', reasoningEffort: 'high' }))
    await expect(provider.generate(request)).resolves.toBe('{"title":"Review changes"}')

    expect(mocks.startThread).toHaveBeenCalledWith(expect.objectContaining({
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
      skipGitRepoCheck: true,
      model: 'gpt-5.6-sol',
      modelReasoningEffort: 'high',
    }))
    expect(mocks.startThread.mock.calls[0]![0]).not.toHaveProperty('additionalDirectories')
    expect(mocks.createCodex).toHaveBeenCalledWith(expect.objectContaining({
      configOverrides: ['mcp_servers={}', 'plugins={}'],
      config: expect.objectContaining({
        project_doc_max_bytes: 0,
        features: expect.objectContaining({
          shell_tool: false,
          unified_exec: false,
          apply_patch_freeform: false,
          apps: false,
          plugins: false,
          multi_agent: false,
          js_repl: false,
          hooks: false,
        }),
      }),
    }))
    expect(mocks.run).toHaveBeenCalledWith(request.prompt, { signal: request.signal, outputSchema: request.schema })
    await expect(access(workspace)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes the isolated workspace when cancellation rejects inference', async () => {
    const request = input()
    const cancelled = new Error('Cancelled')
    let workspace = ''
    mocks.run.mockImplementationOnce(async () => {
      workspace = (mocks.startThread.mock.calls[0]![0] as ThreadOptions).workingDirectory!
      await access(workspace)
      throw cancelled
    })

    await expect(new CodexWorkAssistant(async () => ({})).generate(request)).rejects.toBe(cancelled)
    await expect(access(workspace)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

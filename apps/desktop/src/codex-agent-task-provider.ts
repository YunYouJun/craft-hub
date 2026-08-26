import type { AgentTaskProvider, AgentTaskProviderInput, AgentTaskProviderResult } from 'craft-hub'
import { Codex } from '@openai/codex-sdk'

/** Desktop adapter that executes Craft Hub agent tasks through Codex. */
export class CodexAgentTaskProvider implements AgentTaskProvider {
  readonly id = 'codex'

  async run(input: AgentTaskProviderInput): Promise<AgentTaskProviderResult> {
    const thread = new Codex().startThread({
      threadSource: 'craft-hub',
      workingDirectory: input.primaryProjectPath,
      additionalDirectories: input.projectPaths.filter(path => path !== input.primaryProjectPath),
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
    })
    const streamed = await thread.runStreamed(input.prompt, { signal: input.signal })
    let finalResponse = ''
    for await (const event of streamed.events) {
      if (event.type === 'thread.started')
        await input.onThread(event.thread_id)
      if (event.type === 'item.completed' && event.item.type === 'agent_message')
        finalResponse = event.item.text
      if (event.type === 'turn.failed')
        throw new Error(event.error.message)
      if (event.type === 'error')
        throw new Error(event.message)
    }
    return { finalResponse }
  }
}

import type { ThreadEvent } from '@openai/codex-sdk'
import type { AgentTaskProvider, AgentTaskProviderInput, AgentTaskProviderResult, WorkbenchCodexSetting } from 'craft-hub'
import { Codex } from '@openai/codex-sdk'

function commandOutput(event: ThreadEvent, lengths: Map<string, number>): string {
  if (!('item' in event) || event.item.type !== 'command_execution')
    return ''
  if (event.type === 'item.started') {
    lengths.set(event.item.id, 0)
    return `\n$ ${event.item.command}\n`
  }
  const previousLength = lengths.get(event.item.id) ?? 0
  const output = event.item.aggregated_output.slice(previousLength)
  lengths.set(event.item.id, event.item.aggregated_output.length)
  if (event.type !== 'item.completed')
    return output
  lengths.delete(event.item.id)
  const exit = typeof event.item.exit_code === 'number' ? `exit ${event.item.exit_code}` : event.item.status
  return `${output}\n[${exit}]\n`
}

function completedItemOutput(event: ThreadEvent): string {
  if (event.type !== 'item.completed')
    return ''
  const item = event.item
  if (item.type === 'agent_message' || item.type === 'reasoning')
    return `\n${item.text}\n`
  if (item.type === 'file_change')
    return `\n${item.changes.map(change => `${change.kind}: ${change.path}`).join('\n')}\n`
  if (item.type === 'mcp_tool_call')
    return `\nMCP ${item.server}/${item.tool}: ${item.status}\n`
  if (item.type === 'web_search')
    return `\nSearch: ${item.query}\n`
  if (item.type === 'todo_list')
    return `\n${item.items.map(todo => `${todo.completed ? '[x]' : '[ ]'} ${todo.text}`).join('\n')}\n`
  if (item.type === 'error')
    return `\nError: ${item.message}\n`
  return ''
}

/** Desktop adapter that executes Craft Hub agent tasks through Codex. */
export class CodexAgentTaskProvider implements AgentTaskProvider {
  readonly id = 'codex'
  private readonly resolveSetting: () => Promise<WorkbenchCodexSetting>

  constructor(resolveSetting: () => Promise<WorkbenchCodexSetting> = async () => ({})) {
    this.resolveSetting = resolveSetting
  }

  async run(input: AgentTaskProviderInput): Promise<AgentTaskProviderResult> {
    const setting = await this.resolveSetting()
    const thread = new Codex().startThread({
      threadSource: 'craft-hub',
      workingDirectory: input.primaryProjectPath,
      additionalDirectories: input.projectPaths.filter(path => path !== input.primaryProjectPath),
      sandboxMode: input.sandboxMode ?? 'workspace-write',
      approvalPolicy: 'on-request',
      ...(setting.model ? { model: setting.model } : {}),
      ...(setting.reasoningEffort ? { modelReasoningEffort: setting.reasoningEffort } : {}),
    })
    const streamed = await thread.runStreamed(input.prompt, { signal: input.signal })
    let finalResponse = ''
    const commandOutputLengths = new Map<string, number>()
    for await (const event of streamed.events) {
      if (event.type === 'thread.started')
        await input.onThread(event.thread_id)
      const output = commandOutput(event, commandOutputLengths) || completedItemOutput(event)
      if (output)
        await input.onOutput(output)
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

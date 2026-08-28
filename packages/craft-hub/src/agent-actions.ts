import type { AgentTaskManager } from './agent-tasks'
import type { LocalizedText } from './config'
import type { ProjectRegistry } from './projects'
import type { WorkbenchLocale } from './settings'
import type { AgentActionId, AgentActionResult, AgentActionSummary, AgentTaskRecord, Capability, CommandCapability, ProjectConfigPath } from './types'
import { createHash } from 'node:crypto'
import { loadProjectConfig } from './config'

const improveProjectConfigActionId = 'improve-project-config' as const
const projectConfigPath: ProjectConfigPath = '.craft-hub/project.jsonc'

/** Definition of a trusted built-in agent workflow. */
export interface AgentActionDefinition {
  id: AgentActionId
  targetPath: typeof projectConfigPath
  buildPrompt: (commands: CommandCapability[], locale: WorkbenchLocale) => string
}

/** Built-in agent workflows exposed by the community runtime. */
export const builtinAgentActions: readonly AgentActionDefinition[] = [{
  id: improveProjectConfigActionId,
  targetPath: projectConfigPath,
  buildPrompt: improveProjectConfigPrompt,
}]

function actionDefinition(id: AgentActionId): AgentActionDefinition {
  return builtinAgentActions.find(action => action.id === id)!
}

function commandKey(command: CommandCapability): string {
  return `${command.source}:${command.name}`
}

function configuredDescription(config: Awaited<ReturnType<typeof loadProjectConfig>>, command: CommandCapability): LocalizedText | undefined {
  const descriptions = config?.capabilities?.descriptions
  return descriptions?.[command.id] ?? descriptions?.[commandKey(command)] ?? descriptions?.[command.name]
}

function hasRequiredDescriptions(value: ReturnType<typeof configuredDescription>, locale: WorkbenchLocale): boolean {
  if (typeof value === 'string')
    return locale === 'en'
  if (!value?.default)
    return false
  return locale === 'en' || Boolean(value[locale])
}

async function missingCommands(projectPath: string, capabilities: Capability[], locale: WorkbenchLocale): Promise<CommandCapability[]> {
  const config = await loadProjectConfig(projectPath)
  return capabilities
    .filter((capability): capability is CommandCapability => capability.kind === 'command')
    .filter(command => !hasRequiredDescriptions(configuredDescription(config, command), locale))
}

function improveProjectConfigPrompt(commands: CommandCapability[], locale: WorkbenchLocale): string {
  const targetLanguage = locale === 'zh-CN' ? 'Simplified Chinese (zh-CN)' : 'English'
  const snapshot = commands.map(command => ({
    key: commandKey(command),
    name: command.name,
    source: command.source,
    currentDescription: command.description,
    invocation: {
      command: command.invocation.command,
      args: command.invocation.args,
      requiredEnv: command.invocation.requiredEnv,
    },
  }))

  return [
    'Configure this trusted project for Craft Hub.',
    '',
    `Create or incrementally update only ${projectConfigPath} (version 1).`,
    `Add only missing capabilities.descriptions values for the command snapshot below. Use the stable source:name key shown for new entries. Always add a concise default English description and, when the target locale is not English, a concise ${targetLanguage} description.`,
    'Read package.json scripts, Makefile targets, Taskfile tasks, README files, and AGENTS.md only as context for understanding the commands.',
    'Preserve every existing or unknown field, comment, hidden entry, and existing description or locale value. If an existing description uses a legacy id or name key, supplement that existing entry instead of creating a shadowed duplicate.',
    'Do not change command definitions, package.json, Makefile, Taskfile files, SKILL.md files, trust or state files, or any file other than .craft-hub/project.jsonc. Do not add project icon, color, hidden capabilities, or default agent settings.',
    'If a command purpose or important side effect cannot be determined confidently, skip it and report the uncertainty instead of guessing.',
    'Validate the JSONC, review the git diff for the target file only, and finish with a concise summary of added and skipped entries.',
    '',
    `Target locale: ${locale}`,
    'Command snapshot:',
    JSON.stringify(snapshot, null, 2),
  ].join('\n')
}

/** Coordinates trusted, project-scoped built-in agent workflows without exposing them as discovered skills. */
export class AgentActionService {
  constructor(
    private readonly tasks: AgentTaskManager,
    private readonly projects: ProjectRegistry,
    private readonly discover: (projectId: string) => Promise<Capability[]>,
  ) {}

  /** Describe the built-in actions applicable to one project. */
  async list(projectId: string, locale: WorkbenchLocale): Promise<AgentActionSummary[]> {
    const project = await this.projects.get(projectId)
    const capabilities = await this.discover(projectId)
    const missing = await missingCommands(project.path, capabilities, locale)
    const running = (await this.tasks.list()).find(task => task.status === 'running'
      && task.actionId === improveProjectConfigActionId
      && task.projectIds.includes(projectId))
    return [{
      commandFingerprint: createHash('sha256').update(missing.map(commandKey).sort().join('\n')).digest('hex').slice(0, 16),
      id: improveProjectConfigActionId,
      targetPath: projectConfigPath,
      missingCommandCount: missing.length,
      runningTaskId: running?.id,
    }]
  }

  /** Start one built-in action after checking applicability and per-project concurrency. */
  async start(projectId: string, id: AgentActionId, locale: WorkbenchLocale): Promise<AgentTaskRecord> {
    const definition = actionDefinition(id)
    const summary = (await this.list(projectId, locale)).find(action => action.id === id)!
    if (summary.runningTaskId)
      throw new Error('This agent action is already running for the project')
    if (!summary.missingCommandCount)
      throw new Error('Every command already has the required descriptions')
    const project = await this.projects.get(projectId)
    const capabilities = await this.discover(projectId)
    const before = await missingCommands(project.path, capabilities, locale)

    return this.tasks.start({
      actionId: id,
      prompt: definition.buildPrompt(before, locale),
      projectIds: [projectId],
      primaryProjectId: projectId,
    }, {
      onCompleted: async (): Promise<AgentActionResult> => {
        const after = await missingCommands(project.path, await this.discover(projectId), locale)
        const updatedCommandCount = Math.max(0, before.length - after.length)
        return updatedCommandCount
          ? { outcome: 'updated', updatedCommandCount }
          : { outcome: 'unchanged' }
      },
    })
  }
}

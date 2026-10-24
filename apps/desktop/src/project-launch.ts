import type { CraftHubRuntime } from 'craft-hub'
import type { WorkspaceLaunchTarget } from './workspace-launch-target.ts'
import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { openCodexThreadAfterTaskRelease, waitForAgentTaskThread } from './codex-agent-task-thread.ts'
import { codexThreadUrl, editorTargetPaths, focusCodexApplication, gitRemoteHttpUrl, macTerminalApplications, openCodexProject, openCursorEditor, openCustomEditor, openMacTerminalProject, projectContainsPath, vscodeUrl } from './open-targets.ts'
import { resolveWorkspaceLaunchTarget } from './workspace-launch-target.ts'

const execute = promisify(execFile)

/** The host owns OS delivery; project references and tool settings always come from the shared runtime. */
export interface DesktopLaunchPlatform {
  openURL: (url: string) => Promise<void>
  openPath: (path: string) => Promise<void>
  reportError?: (message: string) => void
}

/** Navigation operations shared by both desktop hosts, resolved against the active runtime. */
export interface ProjectLaunchService {
  projectPath: (id: string) => Promise<string>
  ownedTarget: (id: string, path: string) => Promise<{ projectRoot: string, target: string }>
  workspace: (id: string, primaryProjectId?: string) => Promise<WorkspaceLaunchTarget>
  editor: (path: string, line?: number, column?: number, projectRoot?: string) => Promise<void>
  openProjectDirectory: (id: string) => Promise<void>
  openProjectInVSCode: (id: string) => Promise<void>
  openProjectInEditor: (id: string) => Promise<void>
  openIntegrationSource: (integrationId: string, actionId: string, entityId: string, detailIndex: number, projectId?: string) => Promise<void>
  openProjectEvidenceInEditor: (id: string, path: string, line?: number, column?: number) => Promise<void>
  openProjectGitRemote: (id: string) => Promise<void>
  openCapabilitySourceInEditor: (projectId: string, capabilityId: string) => Promise<void>
  openCapabilityWorkingDirectory: (projectId: string, capabilityId: string) => Promise<void>
  prepareProjectCodexHandoff: (id: string, prompt: string, packageRelativePath?: string) => Promise<{ prompt: string }>
  openProjectInCodex: (id: string, packageRelativePath?: string) => Promise<void>
  startWorkspaceInCodex: (workspaceId: string, projectIds: string[], primaryProjectId: string, prompt: string) => Promise<{ taskId: string, threadId: string }>
  openWorkspaceInCodex: (id: string) => Promise<void>
  openWorkspaceInEditor: (id: string) => Promise<void>
  openCodexThread: (id: string) => Promise<void>
  focusCodexApplication: () => Promise<void>
  listTerminalApplications: typeof macTerminalApplications
  openProjectInTerminal: (id: string, application?: string) => Promise<void>
  openDotfilesInTerminal: () => Promise<void>
  openSettingsFile: () => Promise<void>
}

/** Shared desktop navigation and Codex handoff. Task execution still passes through runtime trust checks. */
export function createProjectLaunchService(getRuntime: () => CraftHubRuntime, platform: DesktopLaunchPlatform): ProjectLaunchService {
  async function projectPath(projectId: string): Promise<string> {
    return (await getRuntime().projects.get(projectId)).path
  }

  async function ownedTarget(projectId: string, path: string): Promise<{ projectRoot: string, target: string }> {
    const projectRoot = await realpath(await projectPath(projectId))
    const target = await realpath(path)
    if (!projectContainsPath(projectRoot, target))
      throw new Error('Capability target must stay inside the project')
    return { projectRoot, target }
  }

  async function evidencePath(projectId: string, path: string): Promise<string> {
    if (!path || isAbsolute(path))
      throw new Error('Evidence path must be project-relative')
    const root = await realpath(await projectPath(projectId))
    const target = await realpath(resolve(root, path))
    const offset = relative(root, target)
    if (offset === '..' || offset.startsWith('../') || offset.startsWith('..\\') || isAbsolute(offset))
      throw new Error('Evidence path must stay inside the project')
    return target
  }

  async function editor(path: string, line?: number, column?: number, projectRoot?: string): Promise<void> {
    const editor = (await getRuntime().settings.get()).settings['workbench.editor']
    for (const target of editorTargetPaths(path, projectRoot)) {
      if (editor.default === 'vscode') {
        await platform.openURL(vscodeUrl(target, target === path ? line : undefined))
      }
      else if (editor.default === 'cursor') {
        await openCursorEditor(target)
      }
      else if (editor.default === 'custom') {
        if (!editor.custom)
          throw new Error('Custom editor is not configured')
        await openCustomEditor(target, editor.custom, target === path ? { line, column } : {})
      }
    }
  }

  async function workspace(workspaceId: string, primaryProjectId?: string): Promise<WorkspaceLaunchTarget> {
    return resolveWorkspaceLaunchTarget(getRuntime(), workspaceId, primaryProjectId)
  }

  async function projectPackage(id: string, path = '.'): Promise<string> {
    if (isAbsolute(path))
      throw new Error('Package path must be project-relative')
    return (await ownedTarget(id, resolve(await projectPath(id), path))).target
  }

  async function openCodexThread(id: string): Promise<void> {
    const url = codexThreadUrl(id)
    try {
      await platform.openURL(url)
    }
    catch {
      await focusCodexApplication().catch(() => {})
      throw new Error('Codex could not open this task link. The task and its output remain available in Craft Hub.')
    }
  }

  function normalizedPrompt(prompt: string): string {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 128 * 1024 || prompt.includes('\0'))
      throw new TypeError('Codex prompt must be nonempty text of at most 128 KiB')
    return prompt.trim()
  }

  return {
    projectPath,
    ownedTarget,
    workspace,
    editor,
    openProjectDirectory: async (id: string) => platform.openPath(await projectPath(id)),
    openProjectInVSCode: async (id: string) => platform.openURL(vscodeUrl(await projectPath(id))),
    openProjectInEditor: async (id: string) => editor(await projectPath(id)),
    async openIntegrationSource(integrationId: string, actionId: string, entityId: string, detailIndex: number, projectId?: string) {
      const path = await getRuntime().integrationSourcePath(integrationId, actionId, entityId, detailIndex, projectId)
      await editor(await realpath(path))
    },
    async openProjectEvidenceInEditor(id: string, path: string, line?: number, column?: number) {
      const positive = (value: number | undefined): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
      await editor(await evidencePath(id, path), positive(line), positive(column))
    },
    async openProjectGitRemote(id: string) {
      const { stdout } = await execute('git', ['-C', await projectPath(id), 'remote', 'get-url', 'origin'], { encoding: 'utf8', shell: false })
      await platform.openURL(gitRemoteHttpUrl(stdout))
    },
    async openCapabilitySourceInEditor(projectId: string, capabilityId: string) {
      const capability = (await getRuntime().capabilities(projectId)).find(item => item.id === capabilityId)
      if (!capability)
        throw new Error(`Unknown capability: ${capabilityId}`)
      const path = capability.kind === 'command' ? capability.sourcePath : capability.path
      if (!path)
        throw new Error(`No source file is available for ${capability.name}`)
      const { projectRoot, target } = await ownedTarget(projectId, path)
      await editor(target, capability.kind === 'command' ? capability.sourceLine : undefined, undefined, projectRoot)
    },
    async openCapabilityWorkingDirectory(projectId: string, capabilityId: string) {
      const capability = (await getRuntime().capabilities(projectId)).find(item => item.id === capabilityId)
      if (capability?.kind !== 'command')
        throw new Error(`No command working directory is available for ${capabilityId}`)
      await platform.openPath((await ownedTarget(projectId, capability.invocation.cwd)).target)
    },
    async prepareProjectCodexHandoff(id, prompt, packageRelativePath) {
      const normalized = normalizedPrompt(prompt)
      await projectPackage(id, packageRelativePath)
      return { prompt: normalized }
    },
    openProjectInCodex: async (id, packageRelativePath) => openCodexProject(await projectPackage(id, packageRelativePath)),
    async startWorkspaceInCodex(workspaceId, projectIds, primaryProjectId, prompt) {
      const normalized = normalizedPrompt(prompt)
      const target = await workspace(workspaceId, primaryProjectId)
      if (!Array.isArray(projectIds) || projectIds.some(id => typeof id !== 'string'))
        throw new TypeError('Workspace project ids are required')
      const members = new Set(target.projectIds)
      if (projectIds.some(id => !members.has(id)))
        throw new Error('Every selected project must belong to the Workspace')
      const agentTasks = getRuntime().agentTasks
      const task = await agentTasks.start({
        prompt: normalized,
        projectIds,
        primaryProjectId,
        workspaceId,
        sandboxMode: 'workspace-write',
      })
      const threadId = await waitForAgentTaskThread(agentTasks, task.id)
      void openCodexThreadAfterTaskRelease(agentTasks, task.id, openCodexThread).catch(() => {
        platform.reportError?.(`Could not open released Codex task ${task.id}`)
      })
      return { taskId: task.id, threadId }
    },
    openWorkspaceInCodex: async (id: string) => openCodexProject((await workspace(id)).primaryProjectPath),
    openWorkspaceInEditor: async (id: string) => editor((await workspace(id)).editorPath),
    openCodexThread,
    focusCodexApplication,
    listTerminalApplications: macTerminalApplications,
    async openProjectInTerminal(id: string, application?: string) {
      if (application && !macTerminalApplications().includes(application))
        throw new Error(`Terminal application is not available: ${application}`)
      await openMacTerminalProject(await projectPath(id), application)
    },
    async openDotfilesInTerminal() {
      const status = await getRuntime().dotfilesManager.status()
      if (!status.repositoryPath)
        throw new Error('Dotfiles manager is not configured')
      await openMacTerminalProject(status.repositoryPath)
    },
    openSettingsFile: async () => platform.openPath(await getRuntime().settings.ensureFile()),
  }
}

/** Decode the same small ID-based launch contract at the native host's authenticated boundary. */
export async function invokeProjectLaunch(service: ProjectLaunchService, action: string, input: Record<string, unknown>): Promise<unknown> {
  function string(key: string): string {
    const value = input[key]
    if (typeof value !== 'string' || !value || value.length > 4096 || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
      throw new TypeError(`${key} must be a nonempty string without control characters`)
    return value
  }
  const optionalString = (key: string): string | undefined => input[key] === undefined ? undefined : string(key)
  const optionalNumber = (key: string): number | undefined => typeof input[key] === 'number' && Number.isSafeInteger(input[key]) && input[key] > 0 ? input[key] : undefined
  switch (action) {
    case 'open-project-directory': return service.openProjectDirectory(string('projectId'))
    case 'open-project-in-vscode': return service.openProjectInVSCode(string('projectId'))
    case 'open-project-in-editor': return service.openProjectInEditor(string('projectId'))
    case 'open-project-in-codex': return service.openProjectInCodex(string('projectId'), optionalString('packageRelativePath'))
    case 'prepare-project-codex-handoff': {
      if (typeof input.prompt !== 'string')
        throw new TypeError('Codex prompt is required')
      return service.prepareProjectCodexHandoff(string('projectId'), input.prompt, optionalString('packageRelativePath'))
    }
    case 'start-workspace-in-codex': {
      if (typeof input.prompt !== 'string' || !Array.isArray(input.projectIds) || input.projectIds.some(id => typeof id !== 'string'))
        throw new TypeError('Codex prompt and Workspace project ids are required')
      return service.startWorkspaceInCodex(string('workspaceId'), input.projectIds as string[], string('primaryProjectId'), input.prompt)
    }
    case 'open-project-git-remote': return service.openProjectGitRemote(string('projectId'))
    case 'open-project-evidence-in-editor': return service.openProjectEvidenceInEditor(string('projectId'), string('path'), optionalNumber('line'), optionalNumber('column'))
    case 'open-capability-source-in-editor': return service.openCapabilitySourceInEditor(string('projectId'), string('capabilityId'))
    case 'open-capability-working-directory': return service.openCapabilityWorkingDirectory(string('projectId'), string('capabilityId'))
    case 'open-workspace-in-codex': return service.openWorkspaceInCodex(string('workspaceId'))
    case 'open-workspace-in-editor': return service.openWorkspaceInEditor(string('workspaceId'))
    case 'open-integration-source': {
      const index = input.detailIndex
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0)
        throw new TypeError('detailIndex must be a nonnegative integer')
      return service.openIntegrationSource(string('integrationId'), string('actionId'), string('entityId'), index, optionalString('projectId'))
    }
    case 'open-codex-thread': return service.openCodexThread(string('threadId'))
    case 'focus-codex-application': return service.focusCodexApplication()
    case 'list-terminal-applications': return service.listTerminalApplications()
    case 'open-project-in-terminal': return service.openProjectInTerminal(string('projectId'), optionalString('application'))
    case 'open-dotfiles-in-terminal': return service.openDotfilesInTerminal()
    case 'open-settings-file': return service.openSettingsFile()
    default: throw new Error('Unknown project launch action')
  }
}

/** Explicit allowlist prevents host actions from calling arbitrary service or prototype methods. */
export const projectLaunchActions = new Set([
  'open-project-directory',
  'open-project-in-vscode',
  'open-project-in-editor',
  'open-project-in-codex',
  'prepare-project-codex-handoff',
  'start-workspace-in-codex',
  'open-project-git-remote',
  'open-project-evidence-in-editor',
  'open-capability-source-in-editor',
  'open-capability-working-directory',
  'open-workspace-in-codex',
  'open-workspace-in-editor',
  'open-integration-source',
  'open-codex-thread',
  'focus-codex-application',
  'list-terminal-applications',
  'open-project-in-terminal',
  'open-dotfiles-in-terminal',
  'open-settings-file',
])

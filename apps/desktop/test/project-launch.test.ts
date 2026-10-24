import type { CraftHubRuntime as Runtime } from 'craft-hub'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CraftHubRuntime } from 'craft-hub'
import { afterEach, expect, it, vi } from 'vitest'
import { focusCodexApplication, openCodexProject, openCursorEditor, openCustomEditor, openMacTerminalProject, vscodeUrl } from '../src/open-targets.ts'
import { createProjectLaunchService, invokeProjectLaunch, projectLaunchActions } from '../src/project-launch.ts'

vi.mock('../src/open-targets.ts', async original => ({
  ...await original<typeof import('../src/open-targets.ts')>(),
  openCodexProject: vi.fn(async () => {}),
  focusCodexApplication: vi.fn(async () => {}),
  openCursorEditor: vi.fn(async () => {}),
  openCustomEditor: vi.fn(async () => {}),
  openMacTerminalProject: vi.fn(async () => {}),
  macTerminalApplications: () => ['Terminal', 'Ghostty'],
}))

const fixtures: { root: string, runtime: Runtime }[] = []

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-project-launch-')))
  const projectPath = join(root, 'project with spaces')
  await mkdir(projectPath)
  await writeFile(join(projectPath, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { hello: 'node -e "console.log(1)"' } }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  fixtures.push({ root, runtime })
  const project = await runtime.addProject(projectPath)
  const platform = { openURL: vi.fn(async (_url: string) => {}), openPath: vi.fn(async (_path: string) => {}) }
  const service = createProjectLaunchService(() => runtime, platform)
  return { root, projectPath, runtime, project, platform, service }
}

afterEach(async () => {
  for (const { root, runtime } of fixtures.splice(0)) {
    await runtime.close()
    await rm(root, { recursive: true, force: true })
  }
  vi.clearAllMocks()
})

it('opens only registered project targets and keeps discovery and command execution untrusted', async () => {
  const { runtime, project, service, platform } = await fixture()
  const run = vi.spyOn(runtime, 'run')
  const command = (await runtime.capabilities(project.id)).find(item => item.kind === 'command')!
  await invokeProjectLaunch(service, 'open-project-directory', { projectId: project.id, path: '/unrelated' })
  await service.openProjectInVSCode(project.id)
  await service.openCapabilitySourceInEditor(project.id, command.id)
  await service.openCapabilityWorkingDirectory(project.id, command.id)
  expect(platform.openPath.mock.calls).toEqual([[project.path], [project.path]])
  expect(platform.openURL).toHaveBeenCalledWith(vscodeUrl(project.path))
  expect(platform.openURL.mock.calls.at(-1)?.[0]).toContain('/package.json')
  expect(run).not.toHaveBeenCalled()
  expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
  await expect(runtime.run(project.id, command.id)).rejects.toThrow('untrusted')
  platform.openPath.mockClear()
  await expect(service.openProjectDirectory('/tmp/not-an-id')).rejects.toThrow()
  await expect(service.openCapabilityWorkingDirectory(project.id, 'missing')).rejects.toThrow('No command working directory')
  expect(platform.openPath).not.toHaveBeenCalled()
})

it('rejects absolute, traversal and symlink evidence escapes while allowing ordinary dot-prefixed files', async () => {
  const { root, projectPath, project, service, platform } = await fixture()
  await writeFile(join(root, 'outside.txt'), 'outside')
  await writeFile(join(projectPath, '..notes.txt'), 'inside')
  await symlink(join(root, 'outside.txt'), join(projectPath, 'linked.txt'))
  for (const path of [join(root, 'outside.txt'), '../outside.txt', 'linked.txt'])
    await expect(service.openProjectEvidenceInEditor(project.id, path)).rejects.toThrow(/Evidence path/)
  expect(platform.openURL).not.toHaveBeenCalled()
  await service.openProjectEvidenceInEditor(project.id, '..notes.txt', 3)
  expect(platform.openURL).toHaveBeenCalledExactlyOnceWith(vscodeUrl(join(projectPath, '..notes.txt'), 3))
  await expect(service.ownedTarget(project.id, join(projectPath, 'linked.txt'))).rejects.toThrow('inside the project')
})

it('uses the saved editor configuration and preserves line and column arguments', async () => {
  const { runtime, project, service } = await fixture()
  const first = await runtime.settings.get()
  const second = await runtime.settings.update({ 'workbench.editor': { default: 'cursor' } }, first.revision)
  await service.openProjectInEditor(project.id)
  expect(openCursorEditor).toHaveBeenCalledExactlyOnceWith(project.path)
  const custom = { name: 'Local editor', command: '/usr/local/bin/editor', args: ['--goto', '{path}:{line}:{column}'] }
  await runtime.settings.update({ 'workbench.editor': { default: 'custom', custom } }, second.revision)
  await service.openProjectEvidenceInEditor(project.id, 'package.json', 4, 6)
  expect(openCustomEditor).toHaveBeenCalledExactlyOnceWith(join(project.path, 'package.json'), custom, { line: 4, column: 6 })
})

it('resolves workspaces in the active owner scope without accepting an unrelated primary project', async () => {
  const { runtime, project, service, platform } = await fixture()
  const team = await runtime.ownerScopes.createTeam('Example')
  const workspace = await runtime.workspaces.create('Workbench', team.id)
  await runtime.workspaces.addProject(workspace.id, project.id, team.id)
  await runtime.ownerScopes.activate(team.id)
  await service.openWorkspaceInEditor(workspace.id)
  await service.openWorkspaceInCodex(workspace.id)
  expect(platform.openURL).toHaveBeenCalledExactlyOnceWith(vscodeUrl(project.path))
  expect(openCodexProject).toHaveBeenCalledExactlyOnceWith(project.path)
  await expect(service.workspace(workspace.id, 'unrelated')).rejects.toThrow('no resolved project')
})

it('limits terminal selection to host-resolved applications and does not execute project commands', async () => {
  const { service, project } = await fixture()
  await service.openProjectInTerminal(project.id, 'Ghostty')
  expect(openMacTerminalProject).toHaveBeenCalledExactlyOnceWith(project.path, 'Ghostty')
  await expect(service.openProjectInTerminal(project.id, '/tmp/arbitrary.app')).rejects.toThrow('not available')
  expect(openMacTerminalProject).toHaveBeenCalledTimes(1)
  await expect(service.openDotfilesInTerminal()).rejects.toThrow('not configured')
})

it('validates Codex thread links before OS delivery and reports a failed deep link', async () => {
  const { service, platform } = await fixture()
  await expect(service.openCodexThread('javascript:bad')).rejects.toThrow('Invalid Codex thread id')
  expect(platform.openURL).not.toHaveBeenCalled()
  const id = '019a1234-1234-7123-8123-123456789abc'
  platform.openURL.mockRejectedValueOnce(new Error('No handler'))
  await expect(service.openCodexThread(id)).rejects.toThrow('could not open this task link')
  expect(platform.openURL).toHaveBeenCalledExactlyOnceWith(`codex://threads/${id}`)
  expect(focusCodexApplication).toHaveBeenCalledTimes(1)
})

it('rejects malformed host inputs and non-action service methods without side effects', async () => {
  const { service, platform } = await fixture()
  for (const projectId of [null, 12, '', 'a\n', 'a'.repeat(4097)])
    await expect(invokeProjectLaunch(service, 'open-project-directory', { projectId })).rejects.toThrow('nonempty string')
  for (const detailIndex of [undefined, -1, 1.5, '0'])
    await expect(invokeProjectLaunch(service, 'open-integration-source', { detailIndex })).rejects.toThrow('nonnegative integer')
  for (const method of ['constructor', 'toString', 'editor', 'projectPath']) {
    expect(projectLaunchActions.has(method)).toBe(false)
    await expect(invokeProjectLaunch(service, method, {})).rejects.toThrow('Unknown project launch action')
  }
  expect(platform.openURL).not.toHaveBeenCalled()
  expect(platform.openPath).not.toHaveBeenCalled()
})

it('prepares a bounded multiline Codex prompt without starting an agent or accepting a package outside the project', async () => {
  const { service, project, runtime } = await fixture()
  const start = vi.spyOn(runtime.agentTasks, 'start')
  await expect(service.prepareProjectCodexHandoff(project.id, '  First\n\nSecond  ')).resolves.toEqual({ prompt: 'First\n\nSecond' })
  await expect(service.prepareProjectCodexHandoff(project.id, 'prompt', '..')).rejects.toThrow('inside the project')
  await expect(service.prepareProjectCodexHandoff(project.id, 'prompt', '/tmp')).rejects.toThrow('project-relative')
  for (const prompt of ['', '  ', 'a'.repeat(128 * 1024 + 1), 'a\0b'])
    await expect(service.prepareProjectCodexHandoff(project.id, prompt)).rejects.toThrow('nonempty text')
  expect(openCodexProject).not.toHaveBeenCalled()
  expect(start).not.toHaveBeenCalled()
})

it('enforces membership and the actual runtime trust gate before starting a workspace agent task', async () => {
  const { service, project, runtime, platform } = await fixture()
  const workspace = await runtime.workspaces.create('Workspace')
  await runtime.workspaces.addProject(workspace.id, project.id)
  await expect(service.startWorkspaceInCodex(workspace.id, ['unrelated'], project.id, 'prompt')).rejects.toThrow('belong to the Workspace')
  await expect(service.startWorkspaceInCodex(workspace.id, [project.id], project.id, 'prompt')).rejects.toThrow('Trust every selected project')
  expect(await runtime.agentTasks.list()).toEqual([])
  expect(platform.openURL).not.toHaveBeenCalled()
})

it('hands a workspace task to the runtime and opens the Codex thread only after it is released', async () => {
  const { service, project, runtime, platform } = await fixture()
  const workspace = await runtime.workspaces.create('Workspace')
  await runtime.workspaces.addProject(workspace.id, project.id)
  const threadId = '019a1234-1234-7123-8123-123456789abc'
  type Task = NonNullable<Awaited<ReturnType<typeof runtime.agentTasks.get>>>
  const task = { id: 'task', status: 'running', externalThreadId: threadId } as Task
  const start = vi.spyOn(runtime.agentTasks, 'start').mockResolvedValue(task)
  vi.spyOn(runtime.agentTasks, 'get').mockResolvedValue(task)
  const listeners = new Set<(value: Task) => void>()
  vi.spyOn(runtime.agentTasks, 'onChanged').mockImplementation((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  })
  await expect(service.startWorkspaceInCodex(workspace.id, [project.id], project.id, '  prompt  ')).resolves.toEqual({ taskId: 'task', threadId })
  expect(start).toHaveBeenCalledExactlyOnceWith({ prompt: 'prompt', projectIds: [project.id], primaryProjectId: project.id, workspaceId: workspace.id, sandboxMode: 'workspace-write' })
  expect(platform.openURL).not.toHaveBeenCalled()
  for (const listener of listeners)
    listener({ ...task, status: 'completed' })
  await vi.waitFor(() => expect(platform.openURL).toHaveBeenCalledExactlyOnceWith(`codex://threads/${threadId}`))
  expect(listeners.size).toBe(0)
})

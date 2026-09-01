import type { CommandCapability, CommandInvocation } from 'craft-hub'
import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CraftHubRuntime } from 'craft-hub'
import { z } from 'zod/v3'

const execFileAsync = promisify(execFile)

export interface CraftHubMcpServerOptions {
  openDesktopLink?: (url: string) => Promise<void>
}

/** Create a Craft Hub MCP server backed by the supplied runtime. */
export function createCraftHubMcpServer(runtime = new CraftHubRuntime(), options: CraftHubMcpServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'craft-hub', version: '0.1.0' },
    {
      instructions: 'Treat Craft Hub as authoritative for projects, workspaces, Craft Hub execution authorization, project configuration initialization, navigation, and working directories. Resolve existing projects, workspaces, and capabilities before targeting them. Opening Craft Hub only navigates and does not authorize execution. Registration and discovery do not authorize execution. Preview project configuration before applying it, and preview commands before execution.',
    },
  )
  let closingRuntime: Promise<void> | undefined
  server.server.onclose = () => {
    closingRuntime ??= runtime.close()
    void closingRuntime.catch(() => {})
  }

  server.registerTool(
    'open_craft_hub',
    {
      title: 'Open Craft Hub',
      description: 'Open the local Craft Hub desktop app at its home, marketplace, settings, workspace, project, or project capability view. This only navigates; it never runs project commands or changes trust.',
      inputSchema: {
        view: z.enum(['home', 'marketplace', 'settings', 'workspace', 'project', 'capability']).default('home'),
        projectId: z.string().min(1).optional(),
        workspaceId: z.string().min(1).optional(),
        capabilityId: z.string().min(1).optional(),
        ownerScopeId: z.string().min(1).default('personal'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (target) => {
      const url = await craftHubDesktopUrl(runtime, target)
      await (options.openDesktopLink ?? openSystemDesktopLink)(url)
      return result({ target, url }, `Opened Craft Hub ${target.view}.`)
    },
  )

  server.registerTool(
    'list_projects',
    {
      title: 'List Craft Hub projects',
      description: 'List local projects registered with Craft Hub, including whether Craft Hub execution is authorized.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const projects = await runtime.projects.list()
      return result({ projects }, `${projects.length} Craft Hub project${projects.length === 1 ? '' : 's'} found.`)
    },
  )

  server.registerTool(
    'add_project',
    {
      title: 'Add a Craft Hub project',
      description: 'Register an existing local directory as a Craft Hub project. Registration is idempotent and does not authorize Craft Hub execution.',
      inputSchema: { path: z.string().min(1).refine(isAbsolute, 'Project path must be absolute') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path }) => {
      const projects = await runtime.projects.list()
      const project = await runtime.addProject(path)
      const created = !projects.some(item => item.id === project.id)
      return result(
        { project, created },
        created
          ? `Added ${project.name} without authorizing Craft Hub execution. No project code was run.`
          : `${project.name} is already registered. Craft Hub execution state: ${project.trust}.`,
      )
    },
  )

  server.registerTool(
    'init_project_config',
    {
      title: 'Initialize Craft Hub project config',
      description: 'Preview or create the schema-validated .craft-hub/project.jsonc for a registered project. Preview never writes. Apply requires Craft Hub execution authorization and the exact revision returned by preview, and never overwrites an existing file.',
      inputSchema: {
        projectId: z.string().min(1),
        mode: z.enum(['preview', 'apply']),
        expectedRevision: z.string().min(1).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ projectId, mode, expectedRevision }) => {
      const initialization = await runtime.initializeProjectConfig(projectId, mode, expectedRevision)
      if (mode === 'preview') {
        return result(
          { initialization },
          initialization.exists
            ? `${initialization.targetPath} already exists. Returned its current content; no file was written.`
            : `Previewed ${initialization.targetPath}; no file was written. Apply with this revision after Craft Hub execution is authorized.`,
        )
      }
      return result(
        { initialization },
        initialization.outcome === 'created'
          ? `Created ${initialization.targetPath}. Craft Hub execution state remains ${initialization.trust}.`
          : `${initialization.targetPath} already exists and was left unchanged.`,
      )
    },
  )

  server.registerTool(
    'list_owner_scopes',
    {
      title: 'List Craft Hub owner scopes',
      description: 'List the Personal owner scope and configured Git-backed Teams.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const ownerScopes = await runtime.ownerScopes.list()
      return result({ ownerScopes }, `${ownerScopes.length} Craft Hub owner scope${ownerScopes.length === 1 ? '' : 's'} found.`)
    },
  )

  server.registerTool(
    'create_team',
    {
      title: 'Create a Craft Hub Team',
      description: 'Create an isolated Team owner scope backed by a portable snapshot in an existing local Git checkout. Craft Hub does not commit or push.',
      inputSchema: {
        name: z.string().trim().min(1),
        repositoryPath: z.string().min(1).refine(isAbsolute, 'Git repository path must be absolute'),
        directory: z.string().min(1).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name, repositoryPath, directory }) => {
      const team = await runtime.teams.create({ name, repositoryPath, directory })
      const sync = await runtime.teamGitSync.status(team.id)
      return result({ team, sync }, `Created the Team ${team.name} and initialized its Git snapshot. Review and commit repository changes with Git.`)
    },
  )

  server.registerTool(
    'rename_team',
    {
      title: 'Rename a Craft Hub Team',
      description: 'Rename a Team while preserving its stable owner-scope id and Git target. The local snapshot will need explicit synchronization.',
      inputSchema: {
        ownerScopeId: z.string().min(1),
        name: z.string().trim().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ ownerScopeId, name }) => {
      const team = await runtime.teams.rename(ownerScopeId, name)
      const sync = await runtime.teamGitSync.status(ownerScopeId)
      return result({ team, sync }, `Renamed the Team to ${team.name}. Its stable id remains ${team.id}; synchronize its local snapshot explicitly.`)
    },
  )

  server.registerTool(
    'delete_team',
    {
      title: 'Delete a Craft Hub Team',
      description: 'Delete a Team\'s local workspaces, bindings, navigation state, and sync target after confirming its exact current name. The shared Git snapshot remains recoverable.',
      inputSchema: {
        ownerScopeId: z.string().min(1),
        confirmationName: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ ownerScopeId, confirmationName }) => {
      const deletion = await runtime.teams.delete(ownerScopeId, confirmationName)
      return result({ deletion }, `Deleted the local Team ${deletion.team.name}. Its shared Git snapshot remains at ${deletion.retainedSnapshotPath ?? 'the configured repository path'}.`)
    },
  )

  server.registerTool(
    'list_workspaces',
    {
      title: 'List Craft Hub workspaces',
      description: 'List portable Craft Hub workspaces and their resolved local project members.',
      inputSchema: { ownerScopeId: z.string().min(1).default('personal') },
      annotations: { readOnlyHint: true },
    },
    async ({ ownerScopeId }) => {
      await runtime.ownerScopes.get(ownerScopeId)
      const workspaces = await runtime.workspaces.list(ownerScopeId)
      return result({ workspaces }, `${workspaces.length} Craft Hub workspace${workspaces.length === 1 ? '' : 's'} found.`)
    },
  )

  server.registerTool(
    'list_workspace_groups',
    {
      title: 'List Craft Hub workspace groups',
      description: 'List editable, user-owned navigation groups and machine-local standalone project assignments.',
      inputSchema: { ownerScopeId: z.string().min(1).default('personal') },
      annotations: { readOnlyHint: true },
    },
    async ({ ownerScopeId }) => {
      await runtime.ownerScopes.get(ownerScopeId)
      const [groups, projectAssignments] = await Promise.all([
        runtime.workspaces.groups(ownerScopeId),
        runtime.workspaces.projectGroupAssignments(ownerScopeId),
      ])
      return result({ groups, projectAssignments }, `${groups.length} Craft Hub workspace group${groups.length === 1 ? '' : 's'} found.`)
    },
  )

  server.registerTool(
    'create_workspace_group',
    {
      title: 'Create a Craft Hub workspace group',
      description: 'Create an editable, non-nesting navigation group for Craft Hub workspaces and standalone projects.',
      inputSchema: { name: z.string().trim().min(1), ownerScopeId: z.string().min(1).default('personal') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name, ownerScopeId }) => {
      await runtime.ownerScopes.get(ownerScopeId)
      const group = await runtime.workspaces.createGroup(name, ownerScopeId)
      return result({ group }, `Created the workspace group ${group.name}.`)
    },
  )

  server.registerTool(
    'assign_project_group',
    {
      title: 'Assign a Craft Hub project group',
      description: 'Move a registered standalone project into a workspace group, or omit groupId to leave it ungrouped. This does not change workspace membership or execution authorization.',
      inputSchema: {
        projectId: z.string().min(1),
        groupId: z.string().min(1).optional(),
        ownerScopeId: z.string().min(1).default('personal'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ projectId, groupId, ownerScopeId }) => {
      const project = await runtime.projects.get(projectId)
      const projectAssignments = await runtime.workspaces.assignProjectGroup(projectId, groupId, ownerScopeId)
      return result({ project, projectAssignments }, groupId ? `Assigned ${project.name} to workspace group ${groupId}.` : `Left ${project.name} ungrouped.`)
    },
  )

  server.registerTool(
    'assign_workspace_group',
    {
      title: 'Assign a Craft Hub workspace group',
      description: 'Move a workspace into a navigation group, or omit groupId to leave it ungrouped. This does not change Craft Hub execution authorization.',
      inputSchema: {
        workspaceId: z.string().min(1),
        groupId: z.string().min(1).optional(),
        ownerScopeId: z.string().min(1).default('personal'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ workspaceId, groupId, ownerScopeId }) => {
      const workspace = await runtime.workspaces.assignGroup(workspaceId, groupId, ownerScopeId)
      return result({ workspace }, groupId ? `Assigned ${workspace.name} to workspace group ${groupId}.` : `Left ${workspace.name} ungrouped.`)
    },
  )

  server.registerTool(
    'rename_workspace_group',
    {
      title: 'Rename a Craft Hub workspace group',
      description: 'Rename an existing workspace navigation group without changing its workspaces.',
      inputSchema: {
        groupId: z.string().min(1),
        name: z.string().trim().min(1),
        ownerScopeId: z.string().min(1).default('personal'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ groupId, name, ownerScopeId }) => {
      const group = await runtime.workspaces.renameGroup(groupId, name, ownerScopeId)
      return result({ group }, `Renamed the workspace group to ${group.name}.`)
    },
  )

  server.registerTool(
    'delete_workspace_group',
    {
      title: 'Delete a Craft Hub workspace group',
      description: 'Delete a navigation group without deleting its workspaces or projects; its contents become ungrouped.',
      inputSchema: { groupId: z.string().min(1), ownerScopeId: z.string().min(1).default('personal') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ groupId, ownerScopeId }) => {
      const group = (await runtime.workspaces.groups(ownerScopeId)).find(item => item.id === groupId)
      if (!group)
        throw new Error(`Unknown workspace group: ${groupId}`)
      await runtime.workspaces.deleteGroup(groupId, ownerScopeId)
      return result({ deleted: group }, `Deleted ${group.name}; its workspaces and projects remain ungrouped.`)
    },
  )

  server.registerTool(
    'personal_git_sync_status',
    {
      title: 'Inspect Personal Git sync',
      description: 'Inspect whether allowlisted Personal configuration is synchronized with the selected local Git checkout. This does not fetch, commit, or push.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const status = await runtime.personalGitSync.status()
      return result({ status }, `Personal Git sync is ${status.state}.`)
    },
  )

  server.registerTool(
    'configure_personal_git_sync',
    {
      title: 'Configure Personal Git sync',
      description: 'Select a local Git checkout and relative directory for allowlisted Personal configuration. Git credentials remain outside Craft Hub.',
      inputSchema: {
        repositoryPath: z.string().min(1).refine(isAbsolute, 'Git repository path must be absolute'),
        directory: z.string().min(1).default('.craft-hub'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ repositoryPath, directory }) => {
      const status = await runtime.personalGitSync.configure({ repositoryPath, directory })
      return result({ status }, `Configured Personal Git sync at ${status.snapshotPath}.`)
    },
  )

  server.registerTool(
    'synchronize_personal_git',
    {
      title: 'Synchronize Personal configuration with Git',
      description: 'Synchronize allowlisted Personal settings and workspaces with the configured local Git checkout. Conflicts require an explicit resolution. This does not fetch, commit, or push.',
      inputSchema: { resolution: z.enum(['auto', 'use-local', 'use-repository']).default('auto') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ resolution }) => {
      const status = await runtime.personalGitSync.synchronize(resolution)
      return result({ status }, `Personal Git sync is ${status.state}. Review and commit repository changes with Git when needed.`)
    },
  )

  server.registerTool(
    'preview_vscode_workspace_import',
    {
      title: 'Preview VS Code workspace import',
      description: 'Read and validate .code-workspace files, member paths, registrations, and naming conflicts without changing Craft Hub state.',
      inputSchema: {
        sourceDirectory: z.string().min(1).refine(isAbsolute, 'Source directory must be absolute'),
        groupName: z.string().trim().min(1).optional(),
        ownerScopeId: z.string().min(1).default('personal'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sourceDirectory, groupName, ownerScopeId }) => {
      await runtime.ownerScopes.get(ownerScopeId)
      const preview = await runtime.workspaceImports.previewVscodeDirectory(sourceDirectory, groupName, ownerScopeId)
      return result({ preview }, preview.canImport
        ? `Validated ${preview.workspaces.length} workspace${preview.workspaces.length === 1 ? '' : 's'}. Pass revision ${preview.revision} to import_vscode_workspaces.`
        : `Import cannot continue: ${[...preview.conflicts, ...preview.diagnostics.map(item => item.message)].join('; ')}`)
    },
  )

  server.registerTool(
    'import_vscode_workspaces',
    {
      title: 'Import VS Code workspaces',
      description: 'Convert a directory of .code-workspace files once into editable Craft Hub workspaces and a workspace group. The source is not synchronized afterward.',
      inputSchema: {
        sourceDirectory: z.string().min(1).refine(isAbsolute, 'Source directory must be absolute'),
        groupName: z.string().trim().min(1).optional(),
        expectedRevision: z.string().min(1),
        ownerScopeId: z.string().min(1).default('personal'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sourceDirectory, groupName, expectedRevision, ownerScopeId }) => {
      await runtime.ownerScopes.get(ownerScopeId)
      const imported = await runtime.workspaceImports.importVscodeDirectory(sourceDirectory, groupName, expectedRevision, ownerScopeId)
      return result({ imported }, `Imported and verified ${imported.workspaces.length} editable workspace${imported.workspaces.length === 1 ? '' : 's'} into ${imported.group.name}.`)
    },
  )

  server.registerTool(
    'register_workspace_member',
    {
      title: 'Register an imported workspace member',
      description: 'Register an unresolved imported workspace member without authorizing Craft Hub execution, using its retained local path or an explicit replacement path.',
      inputSchema: {
        workspaceId: z.string().min(1),
        project: z.string().min(1),
        path: z.string().min(1).refine(isAbsolute, 'Project path must be absolute').optional(),
        ownerScopeId: z.string().min(1).default('personal'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ workspaceId, project, path, ownerScopeId }) => {
      const workspace = await runtime.workspaces.registerImportedProject(workspaceId, project, path, ownerScopeId)
      const member = workspace.members.find(item => item.project === project)!
      const registered = await runtime.projects.get(member.projectId!)
      return result({ workspace, project: registered }, `Registered ${registered.name}. Craft Hub execution state: ${registered.trust}. No project code was run.`)
    },
  )

  server.registerTool(
    'create_workspace',
    {
      title: 'Create a Craft Hub workspace',
      description: 'Create an empty portable Craft Hub workspace. This does not register projects or authorize Craft Hub execution.',
      inputSchema: { name: z.string().trim().min(1), ownerScopeId: z.string().min(1).default('personal') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name, ownerScopeId }) => {
      await runtime.ownerScopes.get(ownerScopeId)
      const workspace = await runtime.workspaces.create(name, ownerScopeId)
      return result({ workspace }, `Created the empty Craft Hub workspace ${workspace.name}.`)
    },
  )

  server.registerTool(
    'add_workspace_member',
    {
      title: 'Add a project to a Craft Hub workspace',
      description: 'Add an already registered project to a portable workspace. This is idempotent and does not change Craft Hub execution authorization.',
      inputSchema: {
        workspaceId: z.string().min(1),
        projectId: z.string().min(1),
        ownerScopeId: z.string().min(1).default('personal'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ workspaceId, projectId, ownerScopeId }) => {
      const project = await runtime.projects.get(projectId)
      const before = await runtime.workspaces.get(workspaceId, ownerScopeId)
      const alreadyMember = before.members.some(member => member.projectId === projectId)
      const workspace = await runtime.workspaces.addProject(workspaceId, projectId, ownerScopeId)
      return result(
        { workspace, project, added: !alreadyMember },
        alreadyMember
          ? `${project.name} is already a member of ${workspace.name}. Craft Hub execution state remains ${project.trust}.`
          : `Added ${project.name} to ${workspace.name}. Craft Hub execution state remains ${project.trust}.`,
      )
    },
  )

  server.registerTool(
    'list_capabilities',
    {
      title: 'List project capabilities',
      description: 'Inspect commands and skills discovered for one registered Craft Hub project.',
      inputSchema: { projectId: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) => {
      const project = await runtime.projects.get(projectId)
      const discovery = await runtime.capabilityDiscovery(projectId)
      return result({ project, ...discovery }, `${discovery.capabilities.length} capabilities found for ${project.name}.`)
    },
  )

  server.registerTool(
    'preview_command',
    {
      title: 'Preview a project command',
      description: 'Return the exact command, arguments, working directory, environment requirements, and Craft Hub execution-authorization state without running it.',
      inputSchema: {
        projectId: z.string().min(1),
        capabilityId: z.string().min(1),
        inputs: z.record(z.string()).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, capabilityId, inputs }) => {
      const project = await runtime.projects.get(projectId)
      const capability = (await runtime.capabilities(projectId)).find(item => item.id === capabilityId)
      if (!capability)
        throw new Error(`Unknown capability: ${capabilityId}`)
      if (capability.kind !== 'command')
        throw new Error(`${capability.name} is a skill, not a command`)
      const invocation = await runtime.previewCommand(projectId, capabilityId, inputs)
      return result({ project, preview: commandPreview(capability, invocation) }, `Previewed ${capability.name}. No command was run.`)
    },
  )

  return server
}

/** Build one navigation-only Craft Hub Desktop link after resolving local identifiers. */
export async function craftHubDesktopUrl(
  runtime: CraftHubRuntime,
  target: {
    view: 'home' | 'marketplace' | 'settings' | 'workspace' | 'project' | 'capability'
    projectId?: string
    workspaceId?: string
    capabilityId?: string
    ownerScopeId?: string
  },
): Promise<string> {
  if (target.view === 'home' || target.view === 'marketplace' || target.view === 'settings') {
    assertAbsentNavigationIds(target)
    const url = new URL('craft-hub://open')
    url.searchParams.set('v', '1')
    if (target.view !== 'home')
      url.searchParams.set('view', target.view)
    return url.href
  }

  if (target.view === 'workspace') {
    if (!target.workspaceId)
      throw new Error('workspaceId is required for the workspace view')
    if (target.projectId || target.capabilityId)
      throw new Error('The workspace view does not accept projectId or capabilityId')
    await runtime.workspaces.get(target.workspaceId, target.ownerScopeId ?? 'personal')
    const url = new URL('craft-hub://workspace')
    url.searchParams.set('v', '1')
    url.searchParams.set('id', target.workspaceId)
    if (target.ownerScopeId && target.ownerScopeId !== 'personal')
      url.searchParams.set('scope', target.ownerScopeId)
    return url.href
  }

  if (!target.projectId)
    throw new Error(`projectId is required for the ${target.view} view`)
  if (target.workspaceId)
    throw new Error(`The ${target.view} view does not accept workspaceId`)
  if (target.view === 'capability' && !target.capabilityId)
    throw new Error('capabilityId is required for the capability view')
  if (target.view === 'project' && target.capabilityId)
    throw new Error('Use the capability view when capabilityId is provided')

  const project = await runtime.projects.get(target.projectId)
  const reference = await runtime.projects.identify(project.path)
  if (target.capabilityId && !(await runtime.capabilities(project.id)).some(capability => capability.id === target.capabilityId))
    throw new Error(`Unknown capability: ${target.capabilityId}`)
  const url = new URL('craft-hub://project')
  url.searchParams.set('v', '1')
  url.searchParams.set('repo', reference.repository)
  if (reference.subdir)
    url.searchParams.set('subdir', reference.subdir)
  if (target.capabilityId)
    url.searchParams.set('capability', target.capabilityId)
  return url.href
}

function assertAbsentNavigationIds(target: { projectId?: string, workspaceId?: string, capabilityId?: string }): void {
  if (target.projectId || target.workspaceId || target.capabilityId)
    throw new Error('home, marketplace, and settings views do not accept navigation IDs')
}

async function openSystemDesktopLink(url: string): Promise<void> {
  const invocation = process.platform === 'darwin'
    ? { command: 'open', args: [url] }
    : process.platform === 'win32'
      ? { command: 'explorer.exe', args: [url] }
      : { command: 'xdg-open', args: [url] }
  await execFileAsync(invocation.command, invocation.args, { windowsHide: true })
}

function commandPreview(capability: CommandCapability, invocation: CommandInvocation = capability.invocation): {
  id: string
  name: string
  command: string
  args: string[]
  cwd: string
  requiredEnv: string[]
  category?: CommandCapability['category']
  package?: CommandCapability['package']
} {
  return {
    id: capability.id,
    name: capability.name,
    command: invocation.command,
    args: invocation.args,
    cwd: invocation.cwd,
    requiredEnv: invocation.requiredEnv,
    category: capability.category,
    package: capability.package,
  }
}

function result(structuredContent: Record<string, unknown>, text: string): {
  structuredContent: Record<string, unknown>
  content: Array<{ type: 'text', text: string }>
} {
  return {
    structuredContent,
    content: [{ type: 'text' as const, text }],
  }
}

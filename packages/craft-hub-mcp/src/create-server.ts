import type { CommandCapability, ProjectRecord } from 'craft-hub'
import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CraftHubRuntime } from 'craft-hub'
import { z } from 'zod/v3'

const PANEL_URI = 'ui://craft-hub/project-panel-v1.html'
const panelHtml = readFileSync(new URL('../../../plugins/craft-hub/ui/index.html', import.meta.url), 'utf8')

/** Create a Craft Hub MCP server backed by the supplied runtime. */
export function createCraftHubMcpServer(runtime = new CraftHubRuntime()): McpServer {
  const server = new McpServer(
    { name: 'craft-hub', version: '0.1.0' },
    {
      instructions: 'Treat Craft Hub as authoritative for projects, workspaces, trust, project configuration initialization, and working directories. Resolve existing projects and workspaces before changing them. Newly added projects remain untrusted. Preview project configuration before applying it, and preview commands before execution.',
    },
  )

  server.registerResource('craft-hub-project-panel', PANEL_URI, {}, async () => ({
    contents: [{
      uri: PANEL_URI,
      mimeType: 'text/html;profile=mcp-app',
      text: panelHtml,
      _meta: { ui: { prefersBorder: false } },
    }],
  }))

  server.registerTool(
    'list_projects',
    {
      title: 'List Craft Hub projects',
      description: 'List local projects registered with Craft Hub, including their trust state.',
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
      description: 'Register an existing local directory as a Craft Hub project. Registration is idempotent and a newly registered project is always untrusted.',
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
          ? `Added ${project.name} as an untrusted Craft Hub project. No project code was run.`
          : `${project.name} is already registered with ${project.trust} trust.`,
      )
    },
  )

  server.registerTool(
    'init_project_config',
    {
      title: 'Initialize Craft Hub project config',
      description: 'Preview or create .craft-hub/project.yaml for a registered project. Preview never writes. Apply requires a trusted project and the exact revision returned by preview, and never overwrites an existing file.',
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
            : `Previewed ${initialization.targetPath}; no file was written. Apply with this revision after the project is trusted.`,
        )
      }
      return result(
        { initialization },
        initialization.outcome === 'created'
          ? `Created ${initialization.targetPath}. Project trust remains ${initialization.trust}.`
          : `${initialization.targetPath} already exists and was left unchanged.`,
      )
    },
  )

  server.registerTool(
    'list_workspaces',
    {
      title: 'List Craft Hub workspaces',
      description: 'List portable Craft Hub workspaces and their resolved local project members.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const workspaces = await runtime.workspaces.list()
      return result({ workspaces }, `${workspaces.length} Craft Hub workspace${workspaces.length === 1 ? '' : 's'} found.`)
    },
  )

  server.registerTool(
    'create_workspace',
    {
      title: 'Create a Craft Hub workspace',
      description: 'Create an empty portable Craft Hub workspace. This does not register or trust any project.',
      inputSchema: { name: z.string().trim().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name }) => {
      const workspace = await runtime.workspaces.create(name)
      return result({ workspace }, `Created the empty Craft Hub workspace ${workspace.name}.`)
    },
  )

  server.registerTool(
    'add_workspace_member',
    {
      title: 'Add a project to a Craft Hub workspace',
      description: 'Add an already registered project to a portable workspace. This is idempotent and does not change project trust.',
      inputSchema: {
        workspaceId: z.string().min(1),
        projectId: z.string().min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ workspaceId, projectId }) => {
      const project = await runtime.projects.get(projectId)
      const before = await runtime.workspaces.get(workspaceId)
      const alreadyMember = before.members.some(member => member.projectId === projectId)
      const workspace = await runtime.workspaces.addProject(workspaceId, projectId)
      return result(
        { workspace, project, added: !alreadyMember },
        alreadyMember
          ? `${project.name} is already a member of ${workspace.name}. Project trust remains ${project.trust}.`
          : `Added ${project.name} to ${workspace.name}. Project trust remains ${project.trust}.`,
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
      const capabilities = await runtime.capabilities(projectId)
      return result({ project, capabilities }, `${capabilities.length} capabilities found for ${project.name}.`)
    },
  )

  server.registerTool(
    'preview_command',
    {
      title: 'Preview a project command',
      description: 'Return the exact command, arguments, working directory, environment requirements, and project trust state without running it.',
      inputSchema: {
        projectId: z.string().min(1),
        capabilityId: z.string().min(1),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, capabilityId }) => {
      const project = await runtime.projects.get(projectId)
      const capability = (await runtime.capabilities(projectId)).find(item => item.id === capabilityId)
      if (!capability)
        throw new Error(`Unknown capability: ${capabilityId}`)
      if (capability.kind !== 'command')
        throw new Error(`${capability.name} is a skill, not a command`)
      return result({ project, preview: commandPreview(capability) }, `Previewed ${capability.name}. No command was run.`)
    },
  )

  server.registerTool(
    'render_craft_hub_panel',
    {
      title: 'Render the Craft Hub project panel',
      description: 'Render a compact visual project, command preview, and run-status prototype. Use after resolving project data.',
      inputSchema: {
        projectId: z.string().optional(),
        variant: z.enum(['A', 'B', 'C']).default('A'),
      },
      annotations: { readOnlyHint: true },
      _meta: {
        'ui': { resourceUri: PANEL_URI },
        'openai/outputTemplate': PANEL_URI,
      },
    },
    async ({ projectId, variant }) => {
      const projects = await runtime.projects.list()
      const project = projectId ? await runtime.projects.get(projectId) : projects[0]
      const capabilities = project ? await runtime.capabilities(project.id) : []
      const firstCommand = capabilities.find(item => item.kind === 'command') as CommandCapability | undefined
      return result({
        variant,
        projects,
        project,
        capabilities,
        preview: firstCommand ? commandPreview(firstCommand) : undefined,
        run: mockRun(project),
      }, 'Rendered the read-only Craft Hub panel prototype.')
    },
  )

  return server
}

function commandPreview(capability: CommandCapability): {
  id: string
  name: string
  command: string
  args: string[]
  cwd: string
  requiredEnv: string[]
} {
  return {
    id: capability.id,
    name: capability.name,
    command: capability.invocation.command,
    args: capability.invocation.args,
    cwd: capability.invocation.cwd,
    requiredEnv: capability.invocation.requiredEnv,
  }
}

function mockRun(project?: ProjectRecord): {
  id: string
  status: string
  title: string
  projectName: string
  elapsed: string
  progress: number
  note: string
} {
  return {
    id: 'prototype-run',
    status: 'running',
    title: 'pnpm test --run',
    projectName: project?.name ?? 'No project selected',
    elapsed: '01:42',
    progress: 68,
    note: 'Prototype data — no command was run.',
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

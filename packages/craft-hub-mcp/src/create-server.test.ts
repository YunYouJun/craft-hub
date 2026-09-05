import type { CraftHubMcpServerOptions } from './create-server'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CraftHubRuntime } from 'craft-hub'
import { describe, expect, it, vi } from 'vitest'
import { createCraftHubMcpServer } from './create-server'

const execFileAsync = promisify(execFile)

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const response = await client.callTool({ name, arguments: args })
  if (!response.structuredContent)
    throw new Error(`${name} did not return structured content`)
  return Object.fromEntries(Object.entries(response.structuredContent))
}

async function setup(options: CraftHubMcpServerOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-mcp-'))
  const dataDir = join(root, 'data')
  const configDir = join(root, 'config')
  const projectPath = join(root, 'project')
  await mkdir(projectPath)
  const runtime = new CraftHubRuntime({ dataDir, configDir })
  const server = createCraftHubMcpServer(runtime, options)
  const client = new Client({ name: 'craft-hub-test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return { client, configDir, dataDir, projectPath, root, runtime, server }
}

describe('craft hub MCP write tools', () => {
  it('closes the runtime when the MCP connection closes', async () => {
    const fixture = await setup()
    const closeRuntime = vi.spyOn(fixture.runtime, 'close')

    await fixture.client.close()

    await vi.waitFor(() => expect(closeRuntime).toHaveBeenCalledTimes(1))
    await fixture.server.close()
  })

  it('registers an untrusted project and adds it to a portable workspace', async () => {
    const fixture = await setup()
    try {
      const tools = await fixture.client.listTools()
      expect(tools.tools.map(tool => tool.name)).not.toContain('render_craft_hub_panel')
      expect(tools.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'open_craft_hub', annotations: expect.objectContaining({ destructiveHint: false, idempotentHint: true }) }),
        expect.objectContaining({ name: 'celebrate', annotations: expect.objectContaining({ destructiveHint: false, idempotentHint: false }) }),
        expect.objectContaining({ name: 'add_project', annotations: expect.objectContaining({ destructiveHint: false, idempotentHint: true }) }),
        expect.objectContaining({ name: 'init_project_config', annotations: expect.objectContaining({ destructiveHint: false, readOnlyHint: false }) }),
        expect.objectContaining({ name: 'list_workspaces', annotations: expect.objectContaining({ readOnlyHint: true }) }),
        expect.objectContaining({ name: 'rename_team', annotations: expect.objectContaining({ destructiveHint: false, idempotentHint: true }) }),
        expect.objectContaining({ name: 'delete_team', annotations: expect.objectContaining({ destructiveHint: true, idempotentHint: false }) }),
        expect.objectContaining({ name: 'list_workspace_groups', annotations: expect.objectContaining({ readOnlyHint: true }) }),
        expect.objectContaining({ name: 'create_workspace_group', annotations: expect.objectContaining({ destructiveHint: false }) }),
        expect.objectContaining({ name: 'assign_project_group', annotations: expect.objectContaining({ idempotentHint: true }) }),
        expect.objectContaining({ name: 'assign_workspace_group', annotations: expect.objectContaining({ idempotentHint: true }) }),
        expect.objectContaining({ name: 'delete_workspace_group', annotations: expect.objectContaining({ destructiveHint: true }) }),
        expect.objectContaining({ name: 'personal_git_sync_status', annotations: expect.objectContaining({ readOnlyHint: true }) }),
        expect.objectContaining({ name: 'configure_personal_git_sync', annotations: expect.objectContaining({ idempotentHint: true }) }),
        expect.objectContaining({ name: 'synchronize_personal_git', annotations: expect.objectContaining({ destructiveHint: true }) }),
        expect.objectContaining({ name: 'preview_vscode_workspace_import', annotations: expect.objectContaining({ readOnlyHint: true, idempotentHint: true }) }),
        expect.objectContaining({ name: 'import_vscode_workspaces', annotations: expect.objectContaining({ destructiveHint: false, idempotentHint: false }) }),
        expect.objectContaining({ name: 'register_workspace_member', annotations: expect.objectContaining({ destructiveHint: false, idempotentHint: true }) }),
        expect.objectContaining({ name: 'create_workspace', annotations: expect.objectContaining({ destructiveHint: false, idempotentHint: false }) }),
        expect.objectContaining({ name: 'add_workspace_member', annotations: expect.objectContaining({ destructiveHint: false, idempotentHint: true }) }),
      ]))
      const added = await callTool(fixture.client, 'add_project', { path: fixture.projectPath })
      const project = added.project as { id: string, path: string, trust: string }
      expect(added.created).toBe(true)
      expect(project).toMatchObject({ path: await realpath(fixture.projectPath), trust: 'untrusted' })
      await expect(access(join(fixture.projectPath, '.craft-hub', 'project.jsonc'))).rejects.toMatchObject({ code: 'ENOENT' })

      const repeated = await callTool(fixture.client, 'add_project', { path: fixture.projectPath })
      expect(repeated).toMatchObject({ created: false, project: { id: project.id, trust: 'untrusted' } })

      const created = await callTool(fixture.client, 'create_workspace', { name: 'Product Team' })
      const workspace = created.workspace as { id: string }
      const membership = await callTool(fixture.client, 'add_workspace_member', {
        workspaceId: workspace.id,
        projectId: project.id,
      })
      expect(membership).toMatchObject({
        added: true,
        project: { id: project.id, trust: 'untrusted' },
        workspace: {
          id: workspace.id,
          primaryProject: 'project',
          members: [{ project: 'project', projectId: project.id, resolved: true }],
        },
      })

      const repeatedMembership = await callTool(fixture.client, 'add_workspace_member', {
        workspaceId: workspace.id,
        projectId: project.id,
      })
      expect(repeatedMembership).toMatchObject({ added: false, project: { trust: 'untrusted' } })

      const registered = JSON.parse(await readFile(join(fixture.dataDir, 'projects.json'), 'utf8')) as Array<{ id: string, trust: string }>
      expect(registered).toEqual([expect.objectContaining({ id: project.id, trust: 'untrusted' })])
      const manifest = await readFile(join(fixture.configDir, 'workspaces', 'product-team.jsonc'), 'utf8')
      expect(manifest).toContain('"project": "project"')
      expect(manifest).not.toContain(project.id)
      expect(manifest).not.toContain(fixture.projectPath)
    }
    finally {
      await fixture.client.close()
      await fixture.server.close()
      await fixture.runtime.close()
    }
  })

  it('opens navigation-only desktop views through an injected system launcher', async () => {
    const openDesktopLink = vi.fn(async () => {})
    const fixture = await setup({ openDesktopLink })
    try {
      await expect(callTool(fixture.client, 'open_craft_hub', { view: 'marketplace' }))
        .resolves
        .toMatchObject({ url: 'craft-hub://open?v=1&view=marketplace' })
      expect(openDesktopLink).toHaveBeenCalledWith('craft-hub://open?v=1&view=marketplace')

      await expect(callTool(fixture.client, 'celebrate'))
        .resolves
        .toMatchObject({ url: 'craft-hub://celebrate?v=1' })
      expect(openDesktopLink).toHaveBeenLastCalledWith('craft-hub://celebrate?v=1')

      const created = await callTool(fixture.client, 'create_workspace', { name: 'Product Team' })
      const workspace = created.workspace as { id: string }
      await expect(callTool(fixture.client, 'open_craft_hub', { view: 'workspace', workspaceId: workspace.id }))
        .resolves
        .toMatchObject({ url: `craft-hub://workspace?v=1&id=${workspace.id}` })
      expect(openDesktopLink).toHaveBeenLastCalledWith(`craft-hub://workspace?v=1&id=${workspace.id}`)

      await writeFile(join(fixture.projectPath, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
      await execFileAsync('git', ['init', fixture.projectPath])
      await execFileAsync('git', ['-C', fixture.projectPath, 'remote', 'add', 'origin', 'git@github.com:YunYouJun/example.git'])
      const added = await callTool(fixture.client, 'add_project', { path: fixture.projectPath })
      const project = added.project as { id: string }
      const discovery = await callTool(fixture.client, 'list_capabilities', { projectId: project.id })
      const capability = (discovery.capabilities as Array<{ id: string }>)[0]!
      const opened = await callTool(fixture.client, 'open_craft_hub', { view: 'capability', projectId: project.id, capabilityId: capability.id })
      const projectUrl = new URL(opened.url as string)
      expect(projectUrl.host).toBe('project')
      expect(projectUrl.searchParams.get('repo')).toBe('https://github.com/YunYouJun/example')
      expect(projectUrl.searchParams.get('capability')).toBe(capability.id)
    }
    finally {
      await fixture.client.close()
      await fixture.server.close()
      await fixture.runtime.close()
    }
  })

  it('creates, renames, and safely deletes a Git-backed Team', async () => {
    const fixture = await setup()
    try {
      const repositoryPath = join(fixture.root, 'team-repository')
      await execFileAsync('git', ['init', repositoryPath])
      const created = await callTool(fixture.client, 'create_team', { name: 'Acme', repositoryPath })
      const team = created.team as { id: string, name: string }
      await callTool(fixture.client, 'create_workspace', { name: 'Team App', ownerScopeId: team.id })

      await expect(callTool(fixture.client, 'rename_team', { ownerScopeId: team.id, name: 'Acme Platform' }))
        .resolves
        .toMatchObject({ team: { id: team.id, name: 'Acme Platform' }, sync: { state: 'local-ahead' } })
      const rejected = await fixture.client.callTool({ name: 'delete_team', arguments: { ownerScopeId: team.id, confirmationName: 'Acme' } })
      expect(rejected.isError).toBe(true)
      expect(rejected.content).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('Type the Team name exactly') })]))
      const deleted = await callTool(fixture.client, 'delete_team', { ownerScopeId: team.id, confirmationName: 'Acme Platform' })
      expect(deleted).toMatchObject({ deletion: { deletedWorkspaceCount: 1, team: { id: team.id, name: 'Acme Platform' } } })
      await expect(fixture.runtime.ownerScopes.get(team.id)).rejects.toThrow('Unknown owner scope')
    }
    finally {
      await fixture.client.close()
      await fixture.server.close()
      await fixture.runtime.close()
    }
  })

  it('manages workspace groups without deleting grouped workspaces', async () => {
    const fixture = await setup()
    try {
      const createdWorkspace = await callTool(fixture.client, 'create_workspace', { name: 'Release' })
      const workspace = createdWorkspace.workspace as { id: string }
      const createdGroup = await callTool(fixture.client, 'create_workspace_group', { name: 'Cover' })
      const group = createdGroup.group as { id: string }
      const addedProject = await callTool(fixture.client, 'add_project', { path: fixture.projectPath })
      const project = addedProject.project as { id: string }

      await expect(
        callTool(fixture.client, 'assign_workspace_group', { workspaceId: workspace.id, groupId: group.id }),
      )
        .resolves
        .toMatchObject({
          workspace: { id: workspace.id, groupId: group.id },
        })
      await expect(
        callTool(fixture.client, 'assign_project_group', { projectId: project.id, groupId: group.id }),
      )
        .resolves
        .toMatchObject({
          project: { id: project.id },
          projectAssignments: { [project.id]: group.id },
        })
      await expect(
        callTool(fixture.client, 'rename_workspace_group', { groupId: group.id, name: 'Cover Hub' }),
      )
        .resolves
        .toMatchObject({
          group: { id: group.id, name: 'Cover Hub' },
        })
      await expect(
        callTool(fixture.client, 'delete_workspace_group', { groupId: group.id }),
      )
        .resolves
        .toMatchObject({
          deleted: { id: group.id, name: 'Cover Hub' },
        })
      await expect(fixture.runtime.workspaces.get(workspace.id)).resolves.toMatchObject({ groupId: undefined })
    }
    finally {
      await fixture.client.close()
      await fixture.server.close()
      await fixture.runtime.close()
    }
  })

  it('configures and synchronizes Personal data into a local Git checkout', async () => {
    const fixture = await setup()
    try {
      const repositoryPath = join(fixture.root, 'dotfiles')
      await execFileAsync('git', ['init', repositoryPath])
      await expect(callTool(fixture.client, 'configure_personal_git_sync', { repositoryPath, directory: 'cover/hub' }))
        .resolves
        .toMatchObject({ status: { state: 'local-ahead', target: { directory: 'cover/hub' } } })
      await expect(callTool(fixture.client, 'synchronize_personal_git'))
        .resolves
        .toMatchObject({ status: { state: 'clean', workingTreeChanged: true } })
      await expect(access(join(repositoryPath, 'cover', 'hub', 'personal.snapshot.json'))).resolves.toBeUndefined()
    }
    finally {
      await fixture.client.close()
      await fixture.server.close()
      await fixture.runtime.close()
    }
  })

  it('imports owned workspaces and explicitly registers a retained member as untrusted', async () => {
    const fixture = await setup()
    try {
      const memberPath = join(fixture.root, 'member')
      await mkdir(memberPath)
      await mkdir(join(fixture.projectPath, 'workspaces'))
      await writeFile(join(fixture.projectPath, 'workspaces', 'pair.code-workspace'), JSON.stringify({ folders: [{ path: '../../member' }] }))
      const sourceDirectory = join(fixture.projectPath, 'workspaces')
      const previewed = await callTool(fixture.client, 'preview_vscode_workspace_import', { sourceDirectory })
      const preview = previewed.preview as { revision: string, canImport: boolean }
      expect(preview.canImport).toBe(true)
      await expect(fixture.runtime.workspaces.list()).resolves.toEqual([])
      const result = await callTool(fixture.client, 'import_vscode_workspaces', { sourceDirectory, expectedRevision: preview.revision })
      const imported = result.imported as { group: { id: string }, workspaces: Array<{ id: string, groupId: string, members: Array<{ project: string, path: string }> }> }
      expect(imported.workspaces[0]).toMatchObject({ groupId: imported.group.id, members: [expect.objectContaining({ path: await realpath(memberPath) })] })

      const registered = await callTool(fixture.client, 'register_workspace_member', {
        workspaceId: imported.workspaces[0]!.id,
        project: imported.workspaces[0]!.members[0]!.project,
      })
      expect(registered).toMatchObject({ project: { path: await realpath(memberPath), trust: 'untrusted' } })
    }
    finally {
      await fixture.client.close()
      await fixture.server.close()
      await fixture.runtime.close()
    }
  })

  it('validates names and requires registered project and workspace ids', async () => {
    const fixture = await setup()
    try {
      await expect(fixture.client.callTool({ name: 'add_project', arguments: { path: './relative' } })).resolves.toMatchObject({ isError: true })
      await expect(fixture.client.callTool({ name: 'create_workspace', arguments: { name: '   ' } })).resolves.toMatchObject({ isError: true })
      await expect(fixture.client.callTool({
        name: 'add_workspace_member',
        arguments: { workspaceId: 'missing', projectId: 'missing' },
      })).resolves.toMatchObject({
        isError: true,
        content: [expect.objectContaining({ text: expect.stringContaining('Unknown project') })],
      })
    }
    finally {
      await fixture.client.close()
      await fixture.server.close()
      await fixture.runtime.close()
    }
  })

  it('previews project config and applies it only after trust with the matching revision', async () => {
    const fixture = await setup()
    try {
      const added = await callTool(fixture.client, 'add_project', { path: fixture.projectPath })
      const project = added.project as { id: string }
      const previewed = await callTool(fixture.client, 'init_project_config', { projectId: project.id, mode: 'preview' })
      const preview = previewed.initialization as { content: string, revision: string }
      expect(previewed).toMatchObject({
        initialization: {
          projectId: project.id,
          targetPath: '.craft-hub/project.jsonc',
          trust: 'untrusted',
          exists: false,
          outcome: 'preview',
        },
      })
      await expect(access(join(fixture.projectPath, '.craft-hub', 'project.jsonc'))).rejects.toMatchObject({ code: 'ENOENT' })

      await expect(fixture.client.callTool({
        name: 'init_project_config',
        arguments: { projectId: project.id, mode: 'apply', expectedRevision: preview.revision },
      })).resolves.toMatchObject({ isError: true, content: [expect.objectContaining({ text: expect.stringContaining('untrusted') })] })

      await fixture.runtime.projects.setTrust(project.id, 'trusted')
      await expect(fixture.client.callTool({
        name: 'init_project_config',
        arguments: { projectId: project.id, mode: 'apply' },
      })).resolves.toMatchObject({ isError: true, content: [expect.objectContaining({ text: expect.stringContaining('expectedRevision') })] })
      const applied = await callTool(fixture.client, 'init_project_config', {
        projectId: project.id,
        mode: 'apply',
        expectedRevision: preview.revision,
      })
      expect(applied).toMatchObject({ initialization: { trust: 'trusted', exists: true, outcome: 'created' } })
      expect(await readFile(join(fixture.projectPath, '.craft-hub', 'project.jsonc'), 'utf8')).toBe(preview.content)

      const existing = await callTool(fixture.client, 'init_project_config', { projectId: project.id, mode: 'preview' })
      const existingRevision = (existing.initialization as { revision: string }).revision
      await expect(callTool(fixture.client, 'init_project_config', {
        projectId: project.id,
        mode: 'apply',
        expectedRevision: existingRevision,
      })).resolves.toMatchObject({ initialization: { outcome: 'unchanged' } })
    }
    finally {
      await fixture.client.close()
      await fixture.server.close()
      await fixture.runtime.close()
    }
  })

  it('returns pnpm package metadata and discovery diagnostics through MCP', async () => {
    const fixture = await setup()
    try {
      await mkdir(join(fixture.projectPath, 'apps', 'web'), { recursive: true })
      await mkdir(join(fixture.projectPath, 'packages', 'broken'), { recursive: true })
      await mkdir(join(fixture.projectPath, '.craft-hub'), { recursive: true })
      await writeFile(join(fixture.projectPath, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.0.0', scripts: { dev: 'vite' } }))
      await writeFile(join(fixture.projectPath, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n')
      await writeFile(join(fixture.projectPath, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@scope/web', scripts: { deploy: 'vite deploy' } }))
      await writeFile(join(fixture.projectPath, 'packages', 'broken', 'package.json'), '{ invalid')
      await writeFile(join(fixture.projectPath, '.craft-hub', 'project.jsonc'), `${JSON.stringify({
        version: 1,
        capabilities: {
          inputs: {
            'apps/web/package.json:deploy': {
              environment: { type: 'select', options: ['dev', 'staging'], flag: '--env' },
            },
          },
        },
      }, null, 2)}\n`)
      const added = await callTool(fixture.client, 'add_project', { path: fixture.projectPath })
      const project = added.project as { id: string }

      const listed = await callTool(fixture.client, 'list_capabilities', { projectId: project.id })
      expect(listed.capabilities).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'deploy',
          category: 'deploy',
          package: { name: '@scope/web', relativePath: 'apps/web', root: false },
          invocation: expect.objectContaining({ cwd: await realpath(join(fixture.projectPath, 'apps', 'web')) }),
        }),
      ]))
      expect(listed.diagnostics).toEqual([expect.objectContaining({ path: 'packages/broken/package.json' })])
      const deploy = (listed.capabilities as Array<{ id: string, name: string }>).find(item => item.name === 'deploy')!
      await expect(callTool(fixture.client, 'preview_command', { projectId: project.id, capabilityId: deploy.id, inputs: { environment: 'staging' } })).resolves.toMatchObject({
        preview: {
          args: ['run', 'deploy', '--', '--env=staging'],
          category: 'deploy',
          package: { relativePath: 'apps/web' },
          cwd: await realpath(join(fixture.projectPath, 'apps', 'web')),
        },
      })
    }
    finally {
      await fixture.client.close()
      await fixture.server.close()
      await fixture.runtime.close()
    }
  })
})

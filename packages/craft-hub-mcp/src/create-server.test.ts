import { access, mkdir, mkdtemp, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CraftHubRuntime } from 'craft-hub'
import { describe, expect, it } from 'vitest'
import { createCraftHubMcpServer } from './create-server'

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const response = await client.callTool({ name, arguments: args })
  if (!response.structuredContent)
    throw new Error(`${name} did not return structured content`)
  return Object.fromEntries(Object.entries(response.structuredContent))
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-mcp-'))
  const dataDir = join(root, 'data')
  const configDir = join(root, 'config')
  const projectPath = join(root, 'project')
  await mkdir(projectPath)
  const runtime = new CraftHubRuntime({ dataDir, configDir })
  const server = createCraftHubMcpServer(runtime)
  const client = new Client({ name: 'craft-hub-test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return { client, configDir, dataDir, projectPath, root, runtime, server }
}

describe('craft hub MCP write tools', () => {
  it('registers an untrusted project and adds it to a portable workspace', async () => {
    const fixture = await setup()
    try {
      const tools = await fixture.client.listTools()
      expect(tools.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'add_project', annotations: expect.objectContaining({ destructiveHint: false, idempotentHint: true }) }),
        expect.objectContaining({ name: 'init_project_config', annotations: expect.objectContaining({ destructiveHint: false, readOnlyHint: false }) }),
        expect.objectContaining({ name: 'list_workspaces', annotations: expect.objectContaining({ readOnlyHint: true }) }),
        expect.objectContaining({ name: 'create_workspace', annotations: expect.objectContaining({ destructiveHint: false, idempotentHint: false }) }),
        expect.objectContaining({ name: 'add_workspace_member', annotations: expect.objectContaining({ destructiveHint: false, idempotentHint: true }) }),
      ]))

      const added = await callTool(fixture.client, 'add_project', { path: fixture.projectPath })
      const project = added.project as { id: string, path: string, trust: string }
      expect(added.created).toBe(true)
      expect(project).toMatchObject({ path: await realpath(fixture.projectPath), trust: 'untrusted' })
      await expect(access(join(fixture.projectPath, '.craft-hub', 'project.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })

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
      const manifest = await readFile(join(fixture.configDir, 'workspaces', 'product-team.yaml'), 'utf8')
      expect(manifest).toContain('project: project')
      expect(manifest).not.toContain(project.id)
      expect(manifest).not.toContain(fixture.projectPath)
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
          targetPath: '.craft-hub/project.yaml',
          trust: 'untrusted',
          exists: false,
          outcome: 'preview',
        },
      })
      await expect(access(join(fixture.projectPath, '.craft-hub', 'project.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })

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
      expect(await readFile(join(fixture.projectPath, '.craft-hub', 'project.yaml'), 'utf8')).toBe(preview.content)

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
})

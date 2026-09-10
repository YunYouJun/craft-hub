import type { CraftHubPlugin, IntegrationProviderContext, ResourcePage } from '../src/index'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createCraftHub, integrationContributionSchema } from '../src/index'

const result: ResourcePage = { kind: 'resource-page', title: 'Example', input: {}, forms: [], documents: [] }
function plugin(update = vi.fn(async (_context: IntegrationProviderContext, _input: Record<string, unknown>) => result)): CraftHubPlugin {
  return {
    id: 'example-resources',
    integrationProviders: [{ id: 'example-resources', apiVersion: '1.0.0', connectionStatus: async () => ({ connected: true }), resources: { read: async () => result, update, execute: update } }],
    integrations: [integrationContributionSchema.parse({
      id: 'example-resources',
      provider: { id: 'example-resources', requires: '^1.0.0' },
      actions: [
        { id: 'read', title: 'Read', operation: 'resources.read', effect: 'remote-read', confirmation: 'never' },
        { id: 'update', title: 'Save', operation: 'resources.update', effect: 'local-write', confirmation: 'always' },
        { id: 'execute', title: 'Execute', operation: 'resources.execute', effect: 'remote-write', confirmation: 'always' },
      ],
      views: [{ id: 'overview', title: 'Resources', icon: 'builtin:folder', placement: 'primary-sidebar', scope: 'global-and-project', blocks: [{ id: 'resources', type: 'resource-browser', actionId: 'read' }] }],
    })],
  }
}

describe('resource page host trust and confirmation', () => {
  it('allows discovery but prevents untrusted and unconfirmed mutations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'resource-trust-'))
    await writeFile(join(root, 'package.json'), '{"name":"example"}')
    const update = vi.fn(async (_context: IntegrationProviderContext, _input: Record<string, unknown>) => result)
    const runtime = createCraftHub({ dataDir: join(root, 'data'), configDir: join(root, 'config'), plugins: [plugin(update)] })
    try {
      const project = await runtime.addProject(root)
      const input = { integrationId: 'example-resources', projectId: project.id, actionId: 'update', confirmed: true }
      expect(await runtime.invokeIntegrationAction({ ...input, actionId: 'read', confirmed: false })).toEqual(result)
      await expect(runtime.invokeIntegrationAction(input)).rejects.toThrow('Trust')
      expect(update).not.toHaveBeenCalled()
      await runtime.projects.setTrust(project.id, 'trusted')
      await expect(runtime.invokeIntegrationAction({ ...input, confirmed: false })).rejects.toThrow(/confirmation/i)
      expect(update).not.toHaveBeenCalled()
      await runtime.invokeIntegrationAction(input)
      expect(update).toHaveBeenCalledOnce()
      expect(update.mock.calls[0]?.[0]).toMatchObject({ confirmed: true, projectId: project.id, projectPath: project.path })
      await runtime.invokeIntegrationAction({ integrationId: 'example-resources', actionId: 'update', confirmed: true })
      expect(update.mock.calls[1]?.[0].projectPath).toBeUndefined()
      await expect(runtime.invokeIntegrationAction({ integrationId: 'example-resources', actionId: 'execute', confirmed: true })).rejects.toThrow('Trust')
      expect(update).toHaveBeenCalledTimes(2)
    }
    finally {
      await runtime.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses local operations on a hosted runtime even after confirmation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'resource-hosted-'))
    const runtime = createCraftHub({ dataDir: join(root, 'data'), configDir: join(root, 'config'), hostEnvironment: 'hosted', plugins: [plugin()] })
    try {
      await expect(runtime.invokeIntegrationAction({ integrationId: 'example-resources', actionId: 'execute', confirmed: true })).rejects.toThrow('unavailable on this host')
    }
    finally {
      await runtime.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

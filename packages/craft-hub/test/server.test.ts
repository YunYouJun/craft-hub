import type { AddressInfo } from 'node:net'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

const execFileAsync = promisify(execFile)

describe('craft hub server lifecycle', () => {
  it('previews and runs parameterized commands with validated input values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-server-inputs-'))
    await mkdir(join(root, '.craft-hub'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { deploy: 'node -e "console.log(process.argv.slice(1).join(\',\'))" --' } }))
    await writeFile(join(root, '.craft-hub', 'project.yaml'), [
      'version: 1',
      'capabilities:',
      '  inputs:',
      '    package.json:deploy:',
      '      environment:',
      '        type: select',
      '        options: [dev, rdm]',
      '        default: dev',
      '        flag: --env',
    ].join('\n'))
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const project = await runtime.addProject(root)
    const command = (await runtime.capabilities(project.id)).find(item => item.kind === 'command')!
    await runtime.projects.setTrust(project.id, 'trusted')
    const app = await startCraftHubServer({ port: 0, runtime })
    try {
      const previewResponse = await fetch(`${app.url}/api/projects/${project.id}/preview-command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capabilityId: command.id, inputs: { environment: 'rdm' } }),
      })
      await expect(previewResponse.json()).resolves.toMatchObject({ args: ['run', 'deploy', '--', '--env=rdm'] })

      const invalidResponse = await fetch(`${app.url}/api/projects/${project.id}/preview-command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capabilityId: command.id, inputs: { environment: 'release' } }),
      })
      expect(invalidResponse.status).toBe(400)

      const runResponse = await fetch(`${app.url}/api/projects/${project.id}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capabilityId: command.id, inputs: { environment: 'dev' } }),
      })
      const output = await runResponse.text()
      expect(output).toContain('"args":["run","deploy","--","--env=dev"]')
      expect(output).toContain('--env=dev')
    }
    finally {
      await app.close()
    }
  })

  it('configures and synchronizes Personal data through a selected Git checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-server-git-sync-'))
    const repositoryPath = join(root, 'dotfiles')
    await execFileAsync('git', ['init', repositoryPath])
    const canonicalRepositoryPath = await realpath(repositoryPath)
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const app = await startCraftHubServer({ port: 0, runtime })
    try {
      const configured = await fetch(`${app.url}/api/personal-git-sync`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repositoryPath, directory: 'cover/hub' }),
      }).then(response => response.json())
      expect(configured).toMatchObject({ state: 'local-ahead', target: { repositoryPath: canonicalRepositoryPath, directory: 'cover/hub' } })

      const synchronized = await fetch(`${app.url}/api/personal-git-sync/synchronize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolution: 'auto' }),
      }).then(response => response.json())
      expect(synchronized).toMatchObject({ state: 'clean' })
    }
    finally {
      await app.close()
    }
  })

  it('creates, assigns, renames, and deletes workspace groups without deleting workspaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-server-groups-'))
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const workspace = await runtime.workspaces.create('Release')
    const app = await startCraftHubServer({ port: 0, runtime })
    try {
      const created = await fetch(`${app.url}/api/workspace-groups`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Cover' }),
      }).then(response => response.json()) as { id: string }
      await expect(fetch(`${app.url}/api/workspaces/${workspace.id}/group`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: created.id }),
      }).then(response => response.json())).resolves.toMatchObject({ groupId: created.id })
      await expect(fetch(`${app.url}/api/workspace-groups/${created.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Cover Hub' }),
      }).then(response => response.json())).resolves.toMatchObject({ name: 'Cover Hub' })
      await expect(fetch(`${app.url}/api/workspace-groups/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ icon: 'emoji:🧧' }),
      }).then(response => response.json())).resolves.toMatchObject({ name: 'Cover Hub', icon: 'emoji:🧧' })
      await fetch(`${app.url}/api/workspace-groups/${created.id}`, { method: 'DELETE' })

      await expect(runtime.workspaces.list()).resolves.toEqual([expect.objectContaining({ id: workspace.id, groupId: undefined })])
    }
    finally {
      await app.close()
    }
  })

  it('imports editable workspaces and explicitly registers retained members as untrusted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-server-collections-'))
    const sourcePath = join(root, 'hub')
    const memberPath = join(root, 'member')
    await mkdir(join(sourcePath, 'workspaces'), { recursive: true })
    await mkdir(memberPath)
    await writeFile(join(sourcePath, 'workspaces', 'pair.code-workspace'), JSON.stringify({ folders: [{ path: '../../member' }] }))
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const app = await startCraftHubServer({ port: 0, runtime })
    try {
      const previewResponse = await fetch(`${app.url}/api/workspaces/import/vscode/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceDirectory: join(sourcePath, 'workspaces') }),
      })
      const preview = await previewResponse.json() as { revision: string, canImport: boolean }
      expect(preview.canImport).toBe(true)
      await expect(runtime.workspaces.list()).resolves.toEqual([])
      const importResponse = await fetch(`${app.url}/api/workspaces/import/vscode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceDirectory: join(sourcePath, 'workspaces'), expectedRevision: preview.revision }),
      })
      const imported = await importResponse.json() as { group: { id: string }, workspaces: Array<{ id: string, groupId: string, members: Array<{ project: string, path: string }> }> }
      const workspace = imported.workspaces[0]!
      expect(workspace).toMatchObject({ groupId: imported.group.id })
      expect(workspace.members[0]).toMatchObject({ path: await realpath(memberPath) })

      const response = await fetch(`${app.url}/api/workspaces/register-member`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, project: workspace.members[0]!.project }),
      })
      await expect(response.json()).resolves.toMatchObject({ members: [expect.objectContaining({ resolved: true })] })
      await expect(runtime.projects.list()).resolves.toEqual([expect.objectContaining({ trust: 'untrusted' })])
    }
    finally {
      await app.close()
    }
  })

  it('exposes marketplace catalog, source, and installed-plugin state', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-server-marketplace-'))
    const runtime = new CraftHubRuntime({
      dataDir,
      distribution: {
        id: 'test',
        name: 'Test',
        marketplaceSources: [{
          id: 'test',
          name: 'Test catalog',
          kind: 'builtin',
          enabled: true,
          catalog: {
            schemaVersion: 1,
            id: 'test',
            name: 'Test catalog',
            plugins: [{
              package: '@acme/craft-hub-plugin-test',
              version: '1.0.0',
              displayName: 'Test plugin',
              publisher: 'Acme',
              permissions: [],
              categories: [],
            }],
          },
        }],
      },
    })
    const app = await startCraftHubServer({ port: 0, runtime })
    try {
      await expect(fetch(`${app.url}/api/marketplace/catalog`).then(response => response.json())).resolves.toEqual([
        expect.objectContaining({ package: '@acme/craft-hub-plugin-test', sourceId: 'test' }),
      ])
      await expect(fetch(`${app.url}/api/marketplace/sources`).then(response => response.json())).resolves.toEqual([
        expect.objectContaining({ id: 'test', kind: 'builtin' }),
      ])
      await expect(fetch(`${app.url}/api/plugins`).then(response => response.json())).resolves.toEqual([])
    }
    finally {
      await app.close()
    }
  })

  it('releases initialized resources when the requested port is occupied', async () => {
    const occupiedServer = createServer()
    await new Promise<void>((resolve, reject) => {
      occupiedServer.once('error', reject)
      occupiedServer.listen(0, '127.0.0.1', resolve)
    })
    const port = (occupiedServer.address() as AddressInfo).port
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-server-'))
    const runtime = new CraftHubRuntime(dataDir)
    const closeRuntime = vi.spyOn(runtime, 'close')
    const closeSettings = vi.spyOn(runtime.settings, 'close')

    try {
      await expect(startCraftHubServer({ port, runtime })).rejects.toMatchObject({ code: 'EADDRINUSE' })
      expect(closeRuntime).toHaveBeenCalledOnce()
      expect(closeSettings).toHaveBeenCalledOnce()
    }
    finally {
      await new Promise<void>((resolve, reject) => {
        occupiedServer.close(error => error ? reject(error) : resolve())
      })
    }
  })
})

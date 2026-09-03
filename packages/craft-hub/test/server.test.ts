import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { projectConfigSchemaRevision } from '../src/config'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'
import { ProjectWatcher } from '../src/watcher'

const execFileAsync = promisify(execFile)

describe('craft hub server lifecycle', () => {
  it('skips expensive project watcher teardown when the host process is exiting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-server-process-exit-'))
    const closeWatcher = vi.spyOn(ProjectWatcher.prototype, 'close').mockResolvedValue()
    const app = await startCraftHubServer({
      port: 0,
      runtime: new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') }),
    })

    try {
      await app.close({ processExiting: true })
      expect(closeWatcher).not.toHaveBeenCalled()
    }
    finally {
      closeWatcher.mockRestore()
    }
  })

  it('serves contextual README overviews and bounded raster assets for registered projects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-server-overview-'))
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'example', description: 'Example project.' }))
    await writeFile(join(root, 'README.md'), '# Example\n\n![Preview](docs/preview.png)')
    await writeFile(join(root, 'docs', 'preview.png'), Buffer.from([137, 80, 78, 71]))
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const project = await runtime.addProject(root)
    const app = await startCraftHubServer({ port: 0, runtime })
    try {
      const overviewResponse = await fetch(`${app.url}/api/projects/${project.id}/overview?package=.&locale=en`)
      expect(overviewResponse.status).toBe(200)
      await expect(overviewResponse.json()).resolves.toMatchObject({
        projectId: project.id,
        package: { name: 'example', description: 'Example project.', relativePath: '.', root: true },
        readme: { status: 'found', path: 'README.md', content: '# Example\n\n![Preview](docs/preview.png)' },
      })

      const assetResponse = await fetch(`${app.url}/api/projects/${project.id}/overview-asset?path=${encodeURIComponent('docs/preview.png')}`)
      expect(assetResponse.status).toBe(200)
      expect(assetResponse.headers.get('content-type')).toBe('image/png')
      expect(new Uint8Array(await assetResponse.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]))

      const rejected = await fetch(`${app.url}/api/projects/${project.id}/overview-asset?path=${encodeURIComponent('../outside.png')}`)
      expect(rejected.status).toBe(404)
    }
    finally {
      await app.close()
    }
  })

  it('reports the bundled project schema revision for Runtime compatibility checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-server-health-'))
    const app = await startCraftHubServer({
      port: 0,
      runtime: new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') }),
    })
    try {
      const response = await fetch(`${app.url}/api/health`)
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        distribution: {
          id: 'community',
          name: 'Craft Hub',
        },
        projectConfigSchemaRevision,
        status: 'ok',
      })
    }
    finally {
      await app.close()
    }
  })

  it('keeps the project catalog available when one project config is invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-server-project-catalog-'))
    const validPath = join(root, 'valid')
    const invalidPath = join(root, 'invalid')
    await Promise.all([mkdir(validPath), mkdir(invalidPath)])
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const validProject = await runtime.projects.add(validPath)
    const invalidProject = await runtime.projects.add(invalidPath)
    const invalidConfig = '{\n  "version": 1,\n  "unknown": true,\n}\n'
    await mkdir(join(invalidPath, '.craft-hub'))
    await writeFile(join(invalidPath, '.craft-hub', 'project.jsonc'), invalidConfig)

    const app = await startCraftHubServer({ port: 0, runtime })
    try {
      const response = await fetch(`${app.url}/api/projects`)
      const catalog = await response.json() as {
        diagnostics: Array<{ column: number, line: number, message: string, path: string, projectId: string }>
        projects: Array<{ id: string, trust: string }>
      }

      expect(response.status).toBe(200)
      expect(catalog.projects).toEqual([
        expect.objectContaining({ id: validProject.id }),
        expect.objectContaining({ id: invalidProject.id, trust: 'untrusted' }),
      ])
      expect(catalog.diagnostics).toEqual([
        expect.objectContaining({
          column: 14,
          line: 3,
          message: 'Unrecognized key: "unknown"',
          path: '/unknown',
          projectId: invalidProject.id,
        }),
      ])
      await expect(readFile(join(invalidPath, '.craft-hub', 'project.jsonc'), 'utf8')).resolves.toBe(invalidConfig)
    }
    finally {
      await app.close()
    }
  })

  it('creates Git-backed Teams and isolates their workspace routes from Personal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-server-owner-scopes-'))
    const repositoryPath = join(root, 'team-repository')
    await execFileAsync('git', ['init', repositoryPath])
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    await runtime.workspaces.create('Personal App')
    const app = await startCraftHubServer({ port: 0, runtime })
    try {
      const teamResponse = await fetch(`${app.url}/api/owner-scopes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Acme', repositoryPath }),
      })
      expect(teamResponse.status).toBe(201)
      const team = await teamResponse.json() as { id: string }
      const created = await fetch(`${app.url}/api/workspaces?ownerScopeId=${team.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Team App' }),
      })
      expect(created.status).toBe(201)
      const teamProjectPath = join(root, 'team-project')
      await mkdir(teamProjectPath)
      const teamProject = await runtime.addProject(teamProjectPath)
      const teamGroup = await runtime.workspaces.createGroup('Team projects', team.id)
      await runtime.workspaces.assignProjectGroup(teamProject.id, teamGroup.id, team.id)
      await expect(fetch(`${app.url}/api/projects/owner-scopes`).then(response => response.json())).resolves.toEqual({
        [teamProject.id]: [team.id],
      })
      await expect(fetch(`${app.url}/api/workspaces`).then(response => response.json())).resolves.toMatchObject([{ name: 'Personal App' }])
      await expect(fetch(`${app.url}/api/workspaces?ownerScopeId=${team.id}`).then(response => response.json())).resolves.toMatchObject([{ name: 'Team App', ownerScopeId: team.id }])
      await expect(fetch(`${app.url}/api/owner-scopes/${team.id}/git-sync`).then(response => response.json())).resolves.toMatchObject({ state: 'local-ahead' })
      const renamed = await fetch(`${app.url}/api/owner-scopes/${team.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Acme Platform' }),
      })
      await expect(renamed.json()).resolves.toMatchObject({ id: team.id, name: 'Acme Platform' })
      const rejectedDelete = await fetch(`${app.url}/api/owner-scopes/${team.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmationName: 'Acme' }),
      })
      expect(rejectedDelete.status).toBe(400)
      const deleted = await fetch(`${app.url}/api/owner-scopes/${team.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmationName: 'Acme Platform' }),
      })
      await expect(deleted.json()).resolves.toMatchObject({ deletedWorkspaceCount: 1, deletedGroupCount: 1 })
      await expect(fetch(`${app.url}/api/owner-scopes`).then(response => response.json())).resolves.toEqual([{ id: 'personal', kind: 'personal', name: 'Personal' }])
    }
    finally {
      await app.close()
    }
  })

  it('exposes deterministic project description audits without starting an agent task', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-server-description-audit-'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'example', scripts: { dev: 'vite' } }))
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const project = await runtime.addProject(root)
    const app = await startCraftHubServer({ port: 0, runtime })
    try {
      const response = await fetch(`${app.url}/api/projects/${project.id}/agent-actions/improve-project-config/audit?locale=en`)
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ missingCommandCount: 1, missingPackageCount: 1 })
      await expect(runtime.agentTasks.list()).resolves.toEqual([])
    }
    finally {
      await app.close()
    }
  })

  it('previews project configuration before requiring trust to create it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-server-config-'))
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const project = await runtime.addProject(root)
    const app = await startCraftHubServer({ port: 0, runtime })
    try {
      const previewResponse = await fetch(`${app.url}/api/projects/${project.id}/config/initialize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'preview' }),
      })
      const preview = await previewResponse.json() as { content: string, revision: string }
      expect(previewResponse.status).toBe(200)
      expect(preview.content).toContain('"version": 1')

      const rejected = await fetch(`${app.url}/api/projects/${project.id}/config/initialize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'apply', expectedRevision: preview.revision }),
      })
      expect(rejected.status).toBe(403)

      await fetch(`${app.url}/api/projects/${project.id}/trust`, { method: 'POST' })
      const applied = await fetch(`${app.url}/api/projects/${project.id}/config/initialize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'apply', expectedRevision: preview.revision }),
      })
      expect(applied.status).toBe(200)
      await expect(readFile(join(root, '.craft-hub', 'project.jsonc'), 'utf8')).resolves.toContain('"version": 1')
    }
    finally {
      await app.close()
    }
  })

  it('previews and runs parameterized commands with validated input values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-server-inputs-'))
    await mkdir(join(root, '.craft-hub'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { deploy: 'node -e "console.log(process.argv.slice(1).join(\',\'))" --' } }))
    await writeFile(join(root, '.craft-hub', 'project.jsonc'), [
      '{',
      '  // Parameterized command metadata may contain comments.',
      '  "version": 1,',
      '  "capabilities": {',
      '    "inputs": {',
      '      "package.json:deploy": {',
      '        "environment": {',
      '          "type": "select",',
      '          "options": ["dev", "staging"],',
      '          "default": "dev",',
      '          "flag": "--env",',
      '        },',
      '      },',
      '    },',
      '  },',
      '}',
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
        body: JSON.stringify({ capabilityId: command.id, inputs: { environment: 'staging' } }),
      })
      await expect(previewResponse.json()).resolves.toMatchObject({ args: ['run', 'deploy', '--', '--env=staging'] })

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
    const canonicalRepositoryPath = (await realpath(repositoryPath)).replaceAll('\\', '/')
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

  it('exposes local JSONC status and trusted read-only dotfiles operations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-server-dotfiles-'))
    const repositoryPath = join(root, 'dotfiles')
    await execFileAsync('git', ['init', repositoryPath])
    await mkdir(join(repositoryPath, '.craft-hub'), { recursive: true })
    await writeFile(join(repositoryPath, '.craft-hub', 'dotfiles.jsonc'), JSON.stringify({
      version: 1,
      adapter: 'command',
      operations: { status: { command: process.execPath, args: ['-e', 'process.stdout.write("ready")'] } },
    }))
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const app = await startCraftHubServer({ port: 0, runtime })
    try {
      await expect(fetch(`${app.url}/api/user-config`).then(response => response.json())).resolves.toMatchObject({
        configDir: join(root, 'config'),
        diagnostics: [],
        format: 'jsonc',
      })
      const configured = await fetch(`${app.url}/api/dotfiles-manager`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repositoryPath }),
      })
      await expect(configured.json()).resolves.toMatchObject({ state: 'untrusted' })
      const forbidden = await fetch(`${app.url}/api/dotfiles-manager/operations/status`, { method: 'POST' })
      expect(forbidden.status).toBe(403)
      await expect(fetch(`${app.url}/api/dotfiles-manager/trust`, { method: 'POST' }).then(response => response.json())).resolves.toMatchObject({ state: 'ready' })
      await expect(fetch(`${app.url}/api/dotfiles-manager/operations/status`, { method: 'POST' }).then(response => response.json())).resolves.toMatchObject({
        succeeded: true,
        stdout: 'ready',
      })
    }
    finally {
      await app.close()
    }
  })

  it('creates, assigns, renames, and deletes workspace groups without deleting workspaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-server-groups-'))
    const projectPath = join(root, 'standalone')
    await mkdir(projectPath)
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const project = await runtime.projects.add(projectPath)
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
      await expect(fetch(`${app.url}/api/projects/${project.id}/group`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupId: created.id }),
      }).then(response => response.json())).resolves.toEqual({ [project.id]: created.id })
      await expect(fetch(`${app.url}/api/workspace-groups/project-assignments`).then(response => response.json()))
        .resolves
        .toEqual({ [project.id]: created.id })
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
      await expect(runtime.workspaces.projectGroupAssignments()).resolves.toEqual({})
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
              integrity: 'sha512-dGVzdA==',
              permissions: [],
              categories: [],
              status: 'active',
              includesPlugins: [],
              requiresPlugins: [],
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
      const localPluginPath = join(dataDir, 'local-plugin')
      await mkdir(localPluginPath)
      await writeFile(join(localPluginPath, 'package.json'), JSON.stringify({
        name: '@acme/craft-hub-plugin-local',
        version: '1.0.0',
        craftHub: {
          schemaVersion: 1,
          id: '@acme/craft-hub-plugin-local',
          displayName: 'Local plugin',
          permissions: [],
          contributes: {},
        },
      }))
      await writeFile(join(localPluginPath, 'README.md'), '# Local plugin')
      await writeFile(join(localPluginPath, 'preview.png'), Buffer.from([137, 80, 78, 71]))
      const linkResponse = await fetch(`${app.url}/api/plugins/local`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: localPluginPath }),
      })
      expect(linkResponse.status).toBe(201)
      await expect(linkResponse.json()).resolves.toMatchObject({ origin: 'local', package: '@acme/craft-hub-plugin-local' })
      const documentQuery = new URLSearchParams({ sourceId: 'local', package: '@acme/craft-hub-plugin-local', version: '1.0.0' })
      await expect(fetch(`${app.url}/api/plugins/document?${documentQuery}`).then(response => response.json())).resolves.toMatchObject({
        package: '@acme/craft-hub-plugin-local',
        version: '1.0.0',
        document: { status: 'found', path: 'README.md', content: '# Local plugin' },
      })
      const assetQuery = new URLSearchParams({ sourceId: 'local', package: '@acme/craft-hub-plugin-local', version: '1.0.0', path: 'preview.png' })
      const assetResponse = await fetch(`${app.url}/api/plugins/document-asset?${assetQuery}`)
      expect(assetResponse.status).toBe(200)
      expect(assetResponse.headers.get('content-type')).toBe('image/png')
      expect(assetResponse.headers.get('x-content-type-options')).toBe('nosniff')
      const unlinkResponse = await fetch(`${app.url}/api/plugins/local/${encodeURIComponent('@acme/craft-hub-plugin-local')}`, { method: 'DELETE' })
      expect(unlinkResponse.status).toBe(200)
      await expect(unlinkResponse.json()).resolves.toEqual({ unlinked: true })
      await expect(fetch(`${app.url}/api/plugins/install/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId: 'test', package: '@acme/craft-hub-plugin-test' }),
      }).then(response => response.json())).resolves.toMatchObject({
        rootPackage: '@acme/craft-hub-plugin-test',
        items: [expect.objectContaining({ package: '@acme/craft-hub-plugin-test', action: 'install', root: true })],
      })
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

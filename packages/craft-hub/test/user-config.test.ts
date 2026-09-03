import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-user-config-'))
  const configDir = join(root, 'config')
  const dataDir = join(root, 'data')
  return { configDir, dataDir, root }
}

describe('portable user JSONC', () => {
  it('migrates legacy YAML once and backs up the original files', async () => {
    const paths = await fixture()
    await mkdir(join(paths.configDir, 'workspaces'), { recursive: true })
    await writeFile(join(paths.configDir, 'config.yaml'), 'schemaVersion: 1\nworkspaceOrder:\n  - docs\ngroups: []\nworkspaceGroups: {}\n')
    await writeFile(join(paths.configDir, 'owner-scopes.yaml'), 'schemaVersion: 1\nteams: []\n')
    await writeFile(join(paths.configDir, 'workspaces', 'docs.yaml'), 'schemaVersion: 1\nid: docs\nname: Docs\nmembers: []\n')
    const runtime = new CraftHubRuntime({ configDir: paths.configDir, dataDir: paths.dataDir })

    await expect(runtime.workspaces.list()).resolves.toMatchObject([{ id: 'docs', name: 'Docs' }])
    await expect(runtime.ownerScopes.list()).resolves.toMatchObject([{ id: 'personal' }])
    expect(await readFile(join(paths.configDir, 'config.jsonc'), 'utf8')).toContain('user-config-v1.schema.json')
    expect(await readFile(join(paths.configDir, 'workspaces', 'docs.jsonc'), 'utf8')).toContain('workspace-v1.schema.json')
    await expect(access(join(paths.configDir, 'config.yaml'))).rejects.toMatchObject({ code: 'ENOENT' })

    const status = await runtime.userConfig.status()
    expect(status.migrationBackupPath).toBeTruthy()
    await expect(readFile(join(status.migrationBackupPath!, 'config.yaml'), 'utf8')).resolves.toContain('workspaceOrder')
    await expect(readFile(join(status.migrationBackupPath!, 'workspaces', 'docs.yaml'), 'utf8')).resolves.toContain('name: Docs')
  })

  it('preserves comments during programmatic writes', async () => {
    const paths = await fixture()
    const runtime = new CraftHubRuntime({ configDir: paths.configDir, dataDir: paths.dataDir })
    const workspace = await runtime.workspaces.create('Commented')
    const path = join(paths.configDir, 'workspaces', 'commented.jsonc')
    const content = await readFile(path, 'utf8')
    await writeFile(path, content.replace('{\n', '{\n  // Kept by JSONC AST edits.\n'))
    const current = await runtime.workspaces.get(workspace.id)

    await runtime.workspaces.save({
      manifest: { schemaVersion: 1, id: workspace.id, name: 'Renamed', members: [] },
      revision: current.revision,
    })

    expect(await readFile(path, 'utf8')).toContain('// Kept by JSONC AST edits.')
  })

  it('keeps the last valid value and reports invalid external edits across restarts', async () => {
    const paths = await fixture()
    const runtime = new CraftHubRuntime({ configDir: paths.configDir, dataDir: paths.dataDir })
    await runtime.workspaces.create('Stable')
    const path = join(paths.configDir, 'workspaces', 'stable.jsonc')
    await runtime.workspaces.list()
    await writeFile(path, '{ invalid jsonc')

    await expect(runtime.workspaces.list()).resolves.toMatchObject([{ id: 'stable', name: 'Stable' }])
    await expect(runtime.userConfig.status()).resolves.toMatchObject({
      diagnostics: [{ path, message: expect.stringContaining('InvalidSymbol') }],
    })

    const restarted = new CraftHubRuntime({ configDir: paths.configDir, dataDir: paths.dataDir })
    await expect(restarted.workspaces.list()).resolves.toMatchObject([{ id: 'stable', name: 'Stable' }])
  })

  it('notifies listeners when a managed JSONC file changes', async () => {
    const paths = await fixture()
    const runtime = new CraftHubRuntime({ configDir: paths.configDir, dataDir: paths.dataDir })
    await runtime.workspaces.create('Watched')
    await runtime.userConfig.startWatching()
    const changed = vi.fn()
    runtime.userConfig.onChanged(changed)

    try {
      const path = join(paths.configDir, 'workspaces', 'watched.jsonc')
      await writeFile(path, (await readFile(path, 'utf8')).replace('"Watched"', '"Watched externally"'))
      await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 3_000 })
    }
    finally {
      await runtime.close()
    }
  })
})

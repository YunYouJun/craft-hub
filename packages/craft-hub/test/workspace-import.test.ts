import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CraftHubRuntime } from '../src/index'

describe('workspace import', () => {
  it('converts VS Code files into editable owned workspaces without persisting machine paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-workspace-import-'))
    const sourceProject = join(root, 'cover', 'hub')
    const sourceDirectory = join(sourceProject, 'workspaces')
    const memberPath = join(root, 'cover', 'member')
    await mkdir(sourceDirectory, { recursive: true })
    await mkdir(memberPath, { recursive: true })
    await writeFile(join(sourceDirectory, 'full.code-workspace'), `{
      // JSONC is supported by VS Code.
      "folders": [{ "name": "Member", "path": "../../member" }],
    }`)
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })

    const imported = await runtime.workspaceImports.importVscodeDirectory(sourceProject)

    expect(imported.group).toMatchObject({ name: 'hub' })
    expect(imported.workspaces).toHaveLength(1)
    expect(imported.workspaces[0]).toMatchObject({ name: 'full', groupId: imported.group.id })
    const canonicalMemberPath = await realpath(memberPath)
    expect(imported.workspaces[0]?.members[0]).toMatchObject({ label: 'Member', resolved: false, path: canonicalMemberPath })
    const manifest = await readFile(join(root, 'config', 'workspaces', 'full.yaml'), 'utf8')
    expect(manifest).not.toContain(canonicalMemberPath)

    const registered = await runtime.workspaces.registerImportedProject(imported.workspaces[0]!.id, imported.workspaces[0]!.members[0]!.project)
    expect(registered.members[0]).toMatchObject({ resolved: true })
    expect((await runtime.projects.list())[0]).toMatchObject({ path: canonicalMemberPath, trust: 'untrusted' })
  })

  it('reports broken documents while importing valid siblings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-workspace-import-errors-'))
    const sourceDirectory = join(root, 'workspaces')
    await mkdir(sourceDirectory)
    await writeFile(join(sourceDirectory, 'broken.code-workspace'), '{ "folders": [ }')
    await writeFile(join(sourceDirectory, 'empty.code-workspace'), '{ "folders": [] }')
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })

    const imported = await runtime.workspaceImports.importVscodeDirectory(sourceDirectory, 'Imported')

    expect(imported.workspaces).toHaveLength(1)
    expect(imported.diagnostics).toEqual([expect.objectContaining({ path: join(await realpath(sourceDirectory), 'broken.code-workspace') })])
  })

  it('retains a replacement path when an imported member moved', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-workspace-import-moved-'))
    const sourceDirectory = join(root, 'workspaces')
    const replacementPath = join(root, 'replacement')
    await mkdir(sourceDirectory)
    await mkdir(replacementPath)
    await writeFile(join(sourceDirectory, 'moved.code-workspace'), JSON.stringify({ folders: [{ path: '../original' }] }))
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const imported = await runtime.workspaceImports.importVscodeDirectory(sourceDirectory)
    const workspace = imported.workspaces[0]!
    const member = workspace.members[0]!

    const registered = await runtime.workspaces.registerImportedProject(workspace.id, member.project, replacementPath)
    await runtime.unregisterProject(registered.members[0]!.projectId!)

    await expect(runtime.workspaces.get(workspace.id)).resolves.toMatchObject({
      members: [expect.objectContaining({ resolved: false, path: await realpath(replacementPath) })],
    })
    expect(member.path).toBe(join(await realpath(root), 'original'))
  })
})

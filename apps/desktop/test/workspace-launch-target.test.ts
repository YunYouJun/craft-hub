import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CraftHubRuntime } from 'craft-hub'
import { describe, expect, it } from 'vitest'
import { resolveWorkspaceLaunchTarget } from '../src/workspace-launch-target.ts'

describe('desktop workspace launch target', () => {
  it('resolves the primary Project from the active Team Owner Scope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-workspace-launch-'))
    const runtime = new CraftHubRuntime({
      configDir: join(root, 'config'),
      dataDir: join(root, 'data'),
    })
    const team = await runtime.ownerScopes.createTeam('Acme')
    const projectPath = join(root, 'wetools')
    const docsPath = join(root, 'docs')
    await mkdir(projectPath)
    await mkdir(docsPath)
    const project = await runtime.addProject(projectPath)
    const docs = await runtime.addProject(docsPath)
    const workspace = await runtime.workspaces.create('minitool', team.id)
    await runtime.workspaces.addProject(workspace.id, project.id, team.id)
    await runtime.workspaces.addProject(workspace.id, docs.id, team.id)
    await runtime.ownerScopes.activate(team.id)

    await expect(resolveWorkspaceLaunchTarget(runtime, workspace.id)).resolves.toEqual({
      editorPath: project.path,
      primaryProjectPath: project.path,
      projectIds: [project.id, docs.id],
    })
    await expect(resolveWorkspaceLaunchTarget(runtime, workspace.id, docs.id)).resolves.toEqual({
      editorPath: docs.path,
      primaryProjectPath: docs.path,
      projectIds: [project.id, docs.id],
    })
  })
})

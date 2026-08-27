import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'

const execFileAsync = promisify(execFile)

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-git-sync-'))
  const repositoryPath = join(root, 'dotfiles')
  await execFileAsync('git', ['init', repositoryPath])
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  return { repositoryPath, root, runtime }
}

describe('personal Git sync', () => {
  it('writes only allowlisted portable configuration into a selected Git checkout', async () => {
    const fixture = await setup()
    const projectPath = join(fixture.root, 'private-project')
    await mkdir(projectPath)
    const project = await fixture.runtime.addProject(projectPath)
    await fixture.runtime.projects.setTrust(project.id, 'trusted')
    const workspace = await fixture.runtime.workspaces.create('Personal docs')
    await fixture.runtime.workspaces.addProject(workspace.id, project.id)

    const configured = await fixture.runtime.personalGitSync.configure({ repositoryPath: fixture.repositoryPath })
    expect(configured).toMatchObject({ state: 'local-ahead', target: { directory: '.craft-hub' } })
    const synchronized = await fixture.runtime.personalGitSync.synchronize()
    expect(synchronized).toMatchObject({ state: 'clean', workingTreeChanged: true })

    const content = await readFile(join(fixture.repositoryPath, '.craft-hub', 'personal.snapshot.json'), 'utf8')
    expect(content).toContain('Personal docs')
    expect(content).not.toContain(projectPath)
    expect(content).not.toContain(project.id)
    expect(content).not.toContain('trusted')
  })

  it('detects repository changes and requires an explicit choice after both sides diverge', async () => {
    const fixture = await setup()
    await fixture.runtime.personalGitSync.configure({ repositoryPath: fixture.repositoryPath, directory: 'cover/hub' })
    await fixture.runtime.personalGitSync.synchronize()
    const snapshotPath = join(fixture.repositoryPath, 'cover', 'hub', 'personal.snapshot.json')
    const repositorySnapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as { settings: { settings: Record<string, unknown> } }
    repositorySnapshot.settings.settings['workbench.locale'] = 'zh-CN'
    await writeFile(snapshotPath, `${JSON.stringify(repositorySnapshot, null, 2)}\n`)
    await fixture.runtime.workspaces.create('Local only')

    await expect(fixture.runtime.personalGitSync.status()).resolves.toMatchObject({ state: 'conflict' })
    await expect(fixture.runtime.personalGitSync.synchronize()).rejects.toThrow('Choose local or repository')
    await expect(fixture.runtime.personalGitSync.synchronize('use-repository')).resolves.toMatchObject({ state: 'clean' })
    expect((await fixture.runtime.settings.get()).settings['workbench.locale']).toBe('zh-CN')
    expect(await fixture.runtime.workspaces.list()).toEqual([])
  })

  it('rejects non-repositories and parent traversal in the sync directory', async () => {
    const fixture = await setup()
    await expect(fixture.runtime.personalGitSync.configure({ repositoryPath: fixture.root })).rejects.toThrow('Not a Git repository')
    await expect(fixture.runtime.personalGitSync.configure({ repositoryPath: fixture.repositoryPath, directory: '../outside' })).rejects.toThrow('relative path')
    await expect(fixture.runtime.personalGitSync.configure({ repositoryPath: fixture.repositoryPath, directory: '.git/craft-hub' })).rejects.toThrow('relative path')

    const outside = join(fixture.root, 'outside')
    await mkdir(outside)
    await symlink(outside, join(fixture.repositoryPath, 'linked'))
    await expect(fixture.runtime.personalGitSync.configure({ repositoryPath: fixture.repositoryPath, directory: 'linked/craft-hub' })).rejects.toThrow('outside the selected repository')
  })
})

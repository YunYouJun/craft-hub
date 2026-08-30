import type { CommandCapability, ProjectRecord } from '../src/types'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { ReleasePlanner } from '../src/release-planner'

const exec = promisify(execFile)

describe('release planner', () => {
  it('reports release effects and blocks execution when the worktree becomes dirty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-release-'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.2.3', scripts: { release: 'bumpp -r' } }))
    await writeFile(join(root, 'release.yml'), 'name: release\n')
    await exec('git', ['init', '-b', 'main'], { cwd: root })
    await exec('git', ['add', '.'], { cwd: root })
    await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'], { cwd: root })

    const project: ProjectRecord = { id: 'project', name: 'Project', path: root, trust: 'trusted', addedAt: new Date().toISOString() }
    const capability: CommandCapability = {
      id: 'release',
      kind: 'command',
      name: 'release',
      source: 'package.json',
      invocation: { command: 'pnpm', args: ['run', 'release'], cwd: root, requiredEnv: [] },
      operation: { kind: 'release', requiresCleanGit: true, requiredBranch: 'main', workflowPath: 'release.yml' },
    }
    const planner = new ReleasePlanner()

    await expect(planner.plan(project, capability)).resolves.toMatchObject({
      branch: 'main',
      clean: true,
      currentVersion: '1.2.3',
      proposedTag: 'v1.2.3',
      workflowExists: true,
      blockers: [],
    })

    await writeFile(join(root, 'uncommitted.txt'), 'dirty')
    const dirty = await planner.plan(project, capability)
    expect(dirty.clean).toBe(false)
    expect(dirty.blockers).toContain('Git worktree has uncommitted changes.')
  })

  it('previews standard SemVer release types and exact versions from command inputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-semver-release-'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.2.3-alpha.0' }))
    await exec('git', ['init', '-b', 'main'], { cwd: root })
    await exec('git', ['add', '.'], { cwd: root })
    await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'], { cwd: root })
    const project: ProjectRecord = { id: 'project', name: 'Project', path: root, trust: 'trusted', addedAt: new Date().toISOString() }
    const capability: CommandCapability = {
      id: 'release',
      kind: 'command',
      name: 'release',
      source: 'package.json',
      invocation: { command: 'pnpm', args: ['run', 'release'], cwd: root, requiredEnv: [] },
      inputs: [
        { id: 'release', type: 'select', flag: '--release', default: 'prerelease', options: ['prerelease', 'patch', 'minor', 'major', 'custom'].map(value => ({ value })) },
        { id: 'prereleaseId', type: 'select', flag: '--preid', default: 'alpha', options: ['alpha', 'beta', 'rc'].map(value => ({ value })) },
        { id: 'customVersion', type: 'text', flag: '--release' },
      ],
      operation: { kind: 'release', requiresCleanGit: true, versionInput: 'release', customVersionInput: 'customVersion', prereleaseIdInput: 'prereleaseId' },
    }
    const planner = new ReleasePlanner()

    await expect(planner.plan(project, capability, { release: 'prerelease', prereleaseId: 'alpha' })).resolves.toMatchObject({ proposedVersion: '1.2.3-alpha.1', proposedTag: 'v1.2.3-alpha.1' })
    await expect(planner.plan(project, capability, { release: 'minor' })).resolves.toMatchObject({ proposedVersion: '1.3.0', proposedTag: 'v1.3.0' })
    await expect(planner.plan(project, capability, { release: 'custom', customVersion: '2.0.0-rc.1' })).resolves.toMatchObject({ proposedVersion: '2.0.0-rc.1', proposedTag: 'v2.0.0-rc.1' })
    await expect(planner.plan(project, capability, { release: 'custom', customVersion: 'not-semver' })).resolves.toMatchObject({ proposedVersion: undefined, blockers: ['Invalid SemVer release: not-semver'] })
  })
})

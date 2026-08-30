import type { ProjectRecord } from '../src/types'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { GitIntegration, GitIntegrationConflictError, GitIntegrationValidationError } from '../src/git-integration'

const exec = promisify(execFile)

async function repository(trust: ProjectRecord['trust'] = 'trusted'): Promise<{ project: ProjectRecord, root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-git-integration-'))
  await exec('git', ['init', '-b', 'main'], { cwd: root })
  await writeFile(join(root, 'README.md'), 'initial\n')
  await exec('git', ['add', '.'], { cwd: root })
  await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'], { cwd: root })
  return {
    root,
    project: { id: 'project', name: 'Project', path: root, trust, addedAt: new Date().toISOString() },
  }
}

async function featureCommit(root: string): Promise<void> {
  await exec('git', ['switch', '-c', 'feature'], { cwd: root })
  await writeFile(join(root, 'feature.txt'), 'feature\n')
  await exec('git', ['add', '.'], { cwd: root })
  await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'feature'], { cwd: root })
}

describe('git integration', () => {
  it('plans and applies a fast-forward integration before safely deleting the source branch', async () => {
    const { project, root } = await repository()
    await featureCommit(root)
    const integration = new GitIntegration()

    const plan = await integration.plan(project)

    expect(plan).toMatchObject({
      sourceBranch: 'feature',
      targetBranch: 'main',
      relation: 'fast-forward',
      clean: true,
      deleteSourceBranch: true,
      blockers: [],
      steps: [
        { kind: 'switch-target', command: 'git', args: ['switch', '--', 'main'] },
        { kind: 'merge-source', command: 'git', args: ['merge', '--ff-only', '--', 'feature'] },
        { kind: 'delete-source', command: 'git', args: ['branch', '-d', '--', 'feature'] },
      ],
    })

    await expect(integration.apply(project, { expectedRevision: plan.revision })).resolves.toMatchObject({
      sourceBranch: 'feature',
      targetBranch: 'main',
      relation: 'fast-forward',
      deletedSourceBranch: true,
      finalBranch: 'main',
    })
    await expect(exec('git', ['branch', '--show-current'], { cwd: root })).resolves.toMatchObject({ stdout: 'main\n' })
    await expect(exec('git', ['branch', '--list', 'feature'], { cwd: root })).resolves.toMatchObject({ stdout: '' })
  })

  it('switches and cleans up when the source was already merged', async () => {
    const { project, root } = await repository()
    await featureCommit(root)
    await exec('git', ['switch', 'main'], { cwd: root })
    await exec('git', ['merge', '--ff-only', 'feature'], { cwd: root })
    await exec('git', ['switch', 'feature'], { cwd: root })
    const integration = new GitIntegration()

    const plan = await integration.plan(project)

    expect(plan.relation).toBe('already-merged')
    expect(plan.steps).toEqual([
      { kind: 'switch-target', command: 'git', args: ['switch', '--', 'main'] },
      { kind: 'delete-source', command: 'git', args: ['branch', '-d', '--', 'feature'] },
    ])
    await expect(integration.apply(project, { expectedRevision: plan.revision })).resolves.toMatchObject({ relation: 'already-merged' })
  })

  it('blocks dirty and diverged repositories without producing executable steps', async () => {
    const { project, root } = await repository()
    await featureCommit(root)
    await exec('git', ['switch', 'main'], { cwd: root })
    await writeFile(join(root, 'main.txt'), 'main\n')
    await exec('git', ['add', '.'], { cwd: root })
    await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'main'], { cwd: root })
    await exec('git', ['switch', 'feature'], { cwd: root })
    await writeFile(join(root, 'dirty.txt'), 'dirty\n')

    const plan = await new GitIntegration().plan(project)

    expect(plan.relation).toBe('diverged')
    expect(plan.blockers.map(blocker => blocker.code)).toEqual(expect.arrayContaining(['dirty-worktree', 'diverged']))
    expect(plan.steps).toEqual([])
  })

  it('rejects stale Plans and untrusted execution', async () => {
    const { project, root } = await repository()
    await featureCommit(root)
    const integration = new GitIntegration()
    const plan = await integration.plan(project)
    await writeFile(join(root, 'changed-after-plan.txt'), 'changed\n')

    await expect(integration.apply(project, { expectedRevision: plan.revision })).rejects.toBeInstanceOf(GitIntegrationConflictError)
    await expect(integration.apply({ ...project, trust: 'untrusted' }, { expectedRevision: plan.revision })).rejects.toBeInstanceOf(GitIntegrationValidationError)
  })
})

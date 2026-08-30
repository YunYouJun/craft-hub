import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

const exec = promisify(execFile)

describe('git integration HTTP routes', () => {
  it('allows read-only planning before trust and requires trust for apply', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-git-integration-server-'))
    const repository = join(root, 'repository')
    await exec('git', ['init', '-b', 'main', repository])
    await writeFile(join(repository, 'README.md'), 'initial\n')
    await exec('git', ['add', '.'], { cwd: repository })
    await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'], { cwd: repository })
    await exec('git', ['switch', '-c', 'feature'], { cwd: repository })
    await writeFile(join(repository, 'feature.txt'), 'feature\n')
    await exec('git', ['add', '.'], { cwd: repository })
    await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'feature'], { cwd: repository })
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const project = await runtime.addProject(repository)
    const app = await startCraftHubServer({ port: 0, runtime })

    try {
      const planResponse = await fetch(`${app.url}/api/projects/${project.id}/git-integration/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deleteSourceBranch: true }),
      })
      expect(planResponse.status).toBe(200)
      const plan = await planResponse.json() as { relation: string, revision: string }
      expect(plan.relation).toBe('fast-forward')

      const blocked = await fetch(`${app.url}/api/projects/${project.id}/git-integration/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: plan.revision, deleteSourceBranch: true }),
      })
      expect(blocked.status).toBe(403)

      await runtime.projects.setTrust(project.id, 'trusted')
      const applied = await fetch(`${app.url}/api/projects/${project.id}/git-integration/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: plan.revision, deleteSourceBranch: true }),
      })
      expect(applied.status).toBe(200)
      await expect(applied.json()).resolves.toMatchObject({ finalBranch: 'main', deletedSourceBranch: true })
    }
    finally {
      await app.close()
    }
  })
})

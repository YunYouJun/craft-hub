import type { RunRecord } from '../src/types'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CraftHubStore } from '../src/store'

function run(id: string, startedAt: string, pinned = false): RunRecord {
  return {
    id,
    projectId: 'project',
    capabilityId: 'command',
    command: 'echo',
    args: [],
    cwd: '/project',
    startedAt,
    finishedAt: startedAt,
    stdout: 'output',
    stderr: '',
    pinned: pinned || undefined,
    status: 'completed',
  }
}

describe('run retention', () => {
  it('previews and removes only completed unpinned matching records', async () => {
    const store = new CraftHubStore(await mkdtemp(join(tmpdir(), 'craft-hub-runs-')))
    await store.saveRun(run('old', '2020-01-01T00:00:00.000Z'))
    await store.saveRun(run('pinned', '2020-01-01T00:00:00.000Z', true))
    await store.saveRun(run('recent', '2030-01-01T00:00:00.000Z'))

    const preview = await store.cleanupRuns({ olderThan: '2025-01-01T00:00:00.000Z', preview: true })
    expect(preview.deletedIds).toEqual(['old'])
    expect(await store.getRun('old')).toBeDefined()

    await store.cleanupRuns({ olderThan: '2025-01-01T00:00:00.000Z' })
    expect(await store.getRun('old')).toBeUndefined()
    expect(await store.getRun('pinned')).toBeDefined()
    expect(await store.getRun('recent')).toBeDefined()
  })
})

import type { TodayFocusSnapshot } from 'craft-hub'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, expect, it } from 'vitest'
import { companionSummary, CompanionSummaryPublisher } from '../src/companion-summary'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function snapshot(checkedAt = '2026-11-04T01:00:00.000Z'): TodayFocusSnapshot {
  return {
    version: 1,
    checkedAt,
    total: 8,
    sourceCount: 2,
    sources: [{ key: 'source', title: 'Tasks', path: '/integrations/private/list', state: 'loaded', complete: false, cached: false, count: 8, accountLabel: 'private-account' }],
    items: Array.from({ length: 8 }, (_, i) => ({ key: String(i), title: 'Review proposal', sourceTitle: 'Tasks', sourceKey: 'source', path: '/integrations/private/list', reasons: ['Important'] })),
    candidates: [],
  }
}

it('exports only five bounded display rows and coverage, without account identities, action targets or routes', () => {
  const value = snapshot()
  value.items[0]!.title = 'x'.repeat(2000)
  const projected = companionSummary(value)
  expect(projected).toMatchObject({ version: 1, total: 8, sourceCount: 2, loadedSourceCount: 1, completeSourceCount: 0 })
  expect(projected.items).toHaveLength(5)
  expect(projected.items[0]!.title).toHaveLength(1000)
  expect(Object.keys(projected.items[0]!)).toEqual(['id', 'title', 'sourceTitle'])
  expect(JSON.stringify(projected)).not.toContain('private')
})

it('requires explicit sharing, restores the choice and keeps a dated cache after stopping', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-companion-'))
  roots.push(root)
  const configuration = join(root, 'host', 'sharing.json')
  const target = join(root, 'exports', 'today.json')
  const publisher = new CompanionSummaryPublisher(configuration)
  await publisher.publish(snapshot())
  await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  await publisher.share(target, snapshot())
  if (process.platform !== 'win32')
    expect((await stat(target)).mode & 0o777).toBe(0o600)
  const restored = new CompanionSummaryPublisher(configuration)
  await restored.restore()
  expect(restored.enabled).toBe(true)
  await restored.publish(snapshot('2026-11-04T02:00:00.000Z'))
  await restored.publish(snapshot('2026-11-04T01:00:00.000Z'))
  expect(JSON.parse(await readFile(target, 'utf8')).checkedAt).toBe('2026-11-04T02:00:00.000Z')
  await restored.stop()
  await restored.publish(snapshot('2026-11-04T03:00:00.000Z'))
  expect(JSON.parse(await readFile(target, 'utf8')).checkedAt).toBe('2026-11-04T02:00:00.000Z')
  const stopped = new CompanionSummaryPublisher(configuration)
  await stopped.restore()
  expect(stopped.enabled).toBe(false)
})

it('does not enable sharing when the export fails or accept its own preference file as the export', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-companion-failure-'))
  roots.push(root)
  const config = join(root, 'sharing.json')
  const publisher = new CompanionSummaryPublisher(config)
  await expect(publisher.share(config, snapshot())).rejects.toThrow('separate JSON')
  await writeFile(join(root, 'blocker'), 'not a directory')
  await expect(publisher.share(join(root, 'blocker', 'today.json'), snapshot())).rejects.toThrow()
  expect(publisher.enabled).toBe(false)
})

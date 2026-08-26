import type { ProjectChangeEvent, ProjectRecord } from '../src/index'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProjectWatcher } from '../src/index'

function nextEvent(events: ProjectChangeEvent[], startIndex: number): Promise<ProjectChangeEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for project change')), 2_000)
    const interval = setInterval(() => {
      const event = events[startIndex]
      if (!event)
        return
      clearInterval(interval)
      clearTimeout(timeout)
      resolve(event)
    }, 10)
  })
}

describe('project watcher', () => {
  it('coalesces relevant file changes into semantic project events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-watcher-'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
    const project: ProjectRecord = {
      id: 'project',
      name: 'Project',
      path: root,
      trust: 'untrusted',
      addedAt: new Date().toISOString(),
    }
    const events: ProjectChangeEvent[] = []
    const watcher = new ProjectWatcher(event => events.push(event), 30)

    try {
      await watcher.watch(project)
      const capabilityEvent = nextEvent(events, 0)
      await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest --run' } }))
      await expect(capabilityEvent).resolves.toEqual({ projectId: 'project', scopes: ['capabilities'] })

      await mkdir(join(root, '.craft-hub'), { recursive: true })
      const projectEvent = nextEvent(events, 1)
      await writeFile(join(root, '.craft-hub', 'project.yaml'), 'version: 1\nproject:\n  name: Renamed\n')
      await writeFile(join(root, '.craft-hub', 'project.yaml'), 'version: 1\nproject:\n  name: Renamed Again\n')
      await expect(projectEvent).resolves.toEqual({ projectId: 'project', scopes: ['capabilities', 'project'] })

      await writeFile(join(root, 'README.md'), 'not a capability source')
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(events).toHaveLength(2)
    }
    finally {
      await watcher.close()
    }
  })
})

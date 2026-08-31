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
    await mkdir(join(root, 'apps', 'widget'), { recursive: true })
    await mkdir(join(root, 'dist', 'generated'), { recursive: true })
    const project: ProjectRecord = {
      id: 'project',
      name: 'Project',
      path: root,
      trust: 'untrusted',
      addedAt: new Date().toISOString(),
    }
    const events: ProjectChangeEvent[] = []
    const watcher = new ProjectWatcher(event => events.push(event))

    try {
      await watcher.watch(project)
      const capabilityEvent = nextEvent(events, 0)
      await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest --run' } }))
      await expect(capabilityEvent).resolves.toEqual({ projectId: 'project', scopes: ['capabilities'] })
      // Let macOS FSEvents settle before creating a file in an existing nested directory.
      await new Promise(resolve => setTimeout(resolve, 150))

      const workspaceCapabilityEvent = nextEvent(events, 1)
      await writeFile(join(root, 'apps', 'widget', 'package.json'), JSON.stringify({ scripts: { deploy: 'widget deploy' } }))
      await expect(workspaceCapabilityEvent).resolves.toEqual({ projectId: 'project', scopes: ['capabilities'] })

      await mkdir(join(root, '.craft-hub'), { recursive: true })
      await new Promise(resolve => setTimeout(resolve, 250))
      expect(events).toHaveLength(2)
      const projectEvent = nextEvent(events, 2)
      await writeFile(join(root, '.craft-hub', 'project.jsonc'), '{ "version": 1, "project": { "name": "Renamed" } }\n')
      await writeFile(join(root, '.craft-hub', 'project.jsonc'), '{ "version": 1, "project": { "name": "Renamed Again" } }\n')
      await expect(projectEvent).resolves.toEqual({ projectId: 'project', scopes: ['capabilities', 'overview', 'project'] })

      await mkdir(join(root, 'workspaces'), { recursive: true })
      await writeFile(join(root, 'workspaces', 'pair.code-workspace'), '{ "folders": [] }')

      const overviewEvent = nextEvent(events, 3)
      await writeFile(join(root, 'README.md'), '# Project overview')
      await expect(overviewEvent).resolves.toEqual({ projectId: 'project', scopes: ['overview'] })

      await writeFile(join(root, 'dist', 'generated', 'package.json'), JSON.stringify({ scripts: { generated: 'true' } }))
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(events).toHaveLength(4)
    }
    finally {
      await watcher.close()
    }
  })
})

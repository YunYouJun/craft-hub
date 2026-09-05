import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const launcherPath = resolve(import.meta.dirname, '../../../plugins/craft-hub/scripts/open-craft-hub.mjs')

async function launch(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [launcherPath, ...args, '--print'])
  return stdout.trim()
}

describe('craft Hub Codex launcher', () => {
  it('opens top-level views', async () => {
    await expect(launch('home')).resolves.toBe('craft-hub://open?v=1')
    await expect(launch('marketplace')).resolves.toBe('craft-hub://open?v=1&view=marketplace')
    await expect(launch('settings')).resolves.toBe('craft-hub://open?v=1&view=settings')
  })

  it('requests one in-app celebration', async () => {
    await expect(launch('celebrate')).resolves.toBe('craft-hub://celebrate?v=1')
  })

  it('opens an exact workspace and owner scope', async () => {
    await expect(
      launch('workspace', '--id', 'workspace-1', '--scope', 'team-1'),
    )
      .resolves
      .toBe('craft-hub://workspace?v=1&id=workspace-1&scope=team-1')
  })

  it('opens project and capability references without local runtime dependencies', async () => {
    await expect(
      launch('project', '--repository', 'https://example.com/acme/widgets.git', '--subdir', 'apps/web'),
    )
      .resolves
      .toBe('craft-hub://project?v=1&repo=https%3A%2F%2Fexample.com%2Facme%2Fwidgets&subdir=apps%2Fweb')
    await expect(
      launch('capability', '--id', 'dev', '--repository', 'git@example.com:acme/widgets.git'),
    )
      .resolves
      .toBe('craft-hub://project?v=1&repo=https%3A%2F%2Fexample.com%2Facme%2Fwidgets&capability=dev')
    await expect(
      launch('project', '--repository', 'https://secret@example.com/acme/widgets.git'),
    )
      .resolves
      .toBe('craft-hub://project?v=1&repo=https%3A%2F%2Fexample.com%2Facme%2Fwidgets')
  })

  it('rejects incomplete navigation targets', async () => {
    await expect(launch('workspace')).rejects.toThrow('workspace requires --id <workspace-id>')
    await expect(launch('capability', '--repository', 'https://example.com/acme/widgets.git')).rejects.toThrow('capability requires --id <capability-id>')
  })
})

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { identifyProjectReference, normalizeProjectReference, normalizeRepositoryUrl, resolveProjectReference, verifyProjectReference } from '../src/project-reference'

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

async function repository(remote = 'git@github.com:Example/Workbench.git'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-project-reference-'))
  temporaryDirectories.push(root)
  await execFileAsync('git', ['init', root])
  await execFileAsync('git', ['-C', root, 'remote', 'add', 'origin', remote])
  return root
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('project references', () => {
  it('normalizes common credential-free Git remote forms', () => {
    expect(normalizeRepositoryUrl('git@GitHub.com:Example/Workbench.git')).toBe('https://github.com/Example/Workbench')
    expect(normalizeRepositoryUrl('ssh://git@gitlab.com/team/workbench.git/')).toBe('https://gitlab.com/team/workbench')
    expect(normalizeRepositoryUrl('https://token@example.com/team/workbench.git')).toBe('https://example.com/team/workbench')
    expect(() => normalizeRepositoryUrl('file:///tmp/workbench')).toThrow('HTTPS or SSH')
  })

  it('rejects local or escaping external references', () => {
    expect(() => normalizeProjectReference({ repository: '/tmp/workbench' })).toThrow()
    expect(() => normalizeProjectReference({ repository: 'https://example.com/team/workbench', subdir: '../apps/web' })).toThrow('repository-relative')
    expect(() => normalizeProjectReference({ repository: 'https://example.com/team/workbench', subdir: '/apps/web' })).toThrow('repository-relative')
  })

  it('derives repository identity and subdirectory from Git facts', async () => {
    const root = await repository()
    const projectPath = join(root, 'apps', 'web')
    await mkdir(projectPath, { recursive: true })

    await expect(identifyProjectReference(projectPath)).resolves.toEqual({
      repository: 'https://github.com/Example/Workbench',
      subdir: 'apps/web',
    })
  })

  it('matches every registered checkout and verifies an explicit selection', async () => {
    const first = await repository('https://github.com/example/workbench.git')
    const second = await repository('ssh://git@github.com/example/workbench.git')
    const unrelated = await repository('https://github.com/example/other.git')
    const target = { repository: 'https://github.com/example/workbench' }
    const projects = [first, second, unrelated].map((path, index) => ({
      id: `${index}`,
      name: `${index}`,
      path,
      trust: 'untrusted' as const,
      addedAt: '2026-01-01T00:00:00.000Z',
    }))

    await expect(resolveProjectReference(projects, target)).resolves.toEqual(projects.slice(0, 2))
    await expect(verifyProjectReference(first, target)).resolves.toEqual(target)
    await expect(verifyProjectReference(unrelated, target)).rejects.toThrow('does not match')
  })
})

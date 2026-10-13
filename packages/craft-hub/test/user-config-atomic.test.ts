import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OwnerScopeService } from '../src/owner-scopes'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
const roots: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'craft-user-config-atomic-'))
  roots.push(root)
  const configDir = join(root, 'config')
  const dataDir = join(root, 'data')
  const path = join(configDir, 'owner-scopes.jsonc')
  const original = '{\n  // Preserve this comment during a Team rename.\n  "schemaVersion": 1,\n  "teams": [{ "id": "acme", "kind": "team", "name": "Acme" }],\n  "extensions": { "example": { "color": "blue" } }\n}\n'
  await mkdir(configDir)
  await writeFile(path, original)
  const scopes = new OwnerScopeService(configDir, dataDir)
  await scopes.list()
  const recoveryDir = join(dataDir, 'user-config-last-good')
  const recoveryFiles = await readdir(recoveryDir)
  expect(recoveryFiles).toHaveLength(1)
  return { configDir, original, path, recoveryPath: join(recoveryDir, recoveryFiles[0]!), scopes }
}

function lockDestination(path: string, code: string, failures: number) {
  const error = Object.assign(new Error(`Injected ${code} rename failure`), { code })
  let attempts = 0
  vi.mocked(rename).mockImplementation(async (source, destination) => {
    if (destination === path && ++attempts <= failures)
      throw error
    await actualFs.rename(source, destination)
  })
  return { attempts: () => attempts, error }
}

afterEach(async () => {
  vi.mocked(rename).mockImplementation(actualFs.rename).mockClear()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('atomic user JSONC writes', () => {
  it.each(['EPERM', 'EACCES', 'EBUSY'])('retries a temporary %s lock while preserving the Team id, JSONC comments and extensions', async (code) => {
    const paths = await fixture()
    const lock = lockDestination(paths.path, code, 2)

    await expect(paths.scopes.renameTeam('acme', 'Acme Platform')).resolves.toEqual({ id: 'acme', kind: 'team', name: 'Acme Platform' })

    const content = await readFile(paths.path, 'utf8')
    expect(content).toContain('// Preserve this comment during a Team rename.')
    expect(content).toContain('"color": "blue"')
    expect(lock.attempts()).toBe(3)
    expect(await readdir(paths.configDir)).toEqual(['owner-scopes.jsonc'])
    expect(await readFile(paths.recoveryPath, 'utf8')).toBe(content)
  })

  it('bounds retries and keeps the original document and recovery snapshot when the lock persists', async () => {
    const paths = await fixture()
    const lock = lockDestination(paths.path, 'EPERM', Number.POSITIVE_INFINITY)

    await expect(paths.scopes.renameTeam('acme', 'Acme Platform')).rejects.toBe(lock.error)

    expect(lock.attempts()).toBe(6)
    expect(await readFile(paths.path, 'utf8')).toBe(paths.original)
    expect(await readFile(paths.recoveryPath, 'utf8')).toBe(paths.original)
    expect(await readdir(paths.configDir)).toEqual(['owner-scopes.jsonc'])
    await expect(paths.scopes.get('acme')).resolves.toEqual({ id: 'acme', kind: 'team', name: 'Acme' })
  })

  it('fails immediately on other errors while retaining the original file and cleaning up the temporary file', async () => {
    const paths = await fixture()
    const failure = lockDestination(paths.path, 'EIO', Number.POSITIVE_INFINITY)

    await expect(paths.scopes.renameTeam('acme', 'Acme Platform')).rejects.toBe(failure.error)

    expect(failure.attempts()).toBe(1)
    expect(await readFile(paths.path, 'utf8')).toBe(paths.original)
    expect(await readdir(paths.configDir)).toEqual(['owner-scopes.jsonc'])
  })
})

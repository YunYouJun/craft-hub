import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OwnerScopeService } from '../src/index'

describe('owner scopes', () => {
  it('always provides Personal and persists Team identities independently from active navigation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-owner-scopes-'))
    const scopes = new OwnerScopeService(join(root, 'config'), join(root, 'data'))

    await expect(scopes.list()).resolves.toEqual([{ id: 'personal', kind: 'personal', name: 'Personal' }])
    const team = await scopes.createTeam('Acme')
    await expect(scopes.list()).resolves.toEqual([
      { id: 'personal', kind: 'personal', name: 'Personal' },
      { id: 'acme', kind: 'team', name: 'Acme' },
    ])
    await expect(scopes.activate(team.id)).resolves.toEqual({ activeScopeId: team.id })
    await expect(scopes.uiState()).resolves.toEqual({ activeScopeId: team.id })
    expect(await readFile(join(root, 'config', 'owner-scopes.yaml'), 'utf8')).toContain('kind: team')
  })

  it('rejects duplicate names and unknown active scopes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-owner-scopes-'))
    const scopes = new OwnerScopeService(join(root, 'config'), join(root, 'data'))
    await scopes.createTeam('YunLeFun')

    await expect(scopes.createTeam('yunlefun')).rejects.toThrow('already exists')
    await expect(scopes.activate('missing')).rejects.toThrow('Unknown owner scope')
  })

  it('renames a Team without changing its stable id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-owner-scopes-'))
    const scopes = new OwnerScopeService(join(root, 'config'), join(root, 'data'))
    const team = await scopes.createTeam('Acme')
    await scopes.createTeam('YunLeFun')

    await expect(scopes.renameTeam(team.id, 'Acme Platform')).resolves.toEqual({ id: team.id, kind: 'team', name: 'Acme Platform' })
    await expect(scopes.renameTeam(team.id, 'yunlefun')).rejects.toThrow('already exists')
    await expect(scopes.renameTeam('personal', 'Mine')).rejects.toThrow('Unknown owner scope')
  })
})

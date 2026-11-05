import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OwnerScopeService } from '../src/owner-scopes'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

const logo = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#2563eb"/></svg>').toString('base64')}`

describe('team logos', () => {
  it('persists artwork, restores icon-only changes and retains stable Team identity when renamed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'team-icons-'))
    try {
      const scopes = new OwnerScopeService(join(root, 'config'), join(root, 'data'))
      const team = await scopes.createTeam('Acme', logo)
      await scopes.renameTeam(team.id, 'Acme Studio')
      const reopened = new OwnerScopeService(join(root, 'config'), join(root, 'data'))
      expect(await reopened.get(team.id)).toEqual({ ...team, name: 'Acme Studio' })
      await reopened.ensureTeam({ ...team, name: 'Acme Studio', icon: 'https://example.com/new.png' })
      expect((await scopes.get(team.id)).icon).toBe('https://example.com/new.png')
      await scopes.updateTeamIcon(team.id)
      expect(await reopened.get(team.id)).toEqual({ id: team.id, name: 'Acme Studio', kind: 'team' })
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })

  it('supports create, replace and reset through the API without changing project trust or running commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'team-icons-api-'))
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const projectPath = join(root, 'project')
    await mkdir(projectPath)
    await writeFile(join(projectPath, 'package.json'), JSON.stringify({ scripts: { hello: 'node --version' } }))
    const project = await runtime.projects.add(projectPath)
    const host = await startCraftHubServer({ runtime, port: 0 })
    const call = (path: string, method: string, body: unknown) => fetch(`${host.url}/api/owner-scopes${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    try {
      const created = await call('', 'POST', { name: 'Acme', icon: logo })
      expect(created.status).toBe(201)
      const team = await created.json() as { id: string, icon: string }
      expect(team.icon).toBe(logo)
      const replaced = await call(`/${team.id}/icon`, 'PUT', { icon: 'https://example.com/logo.png' })
      expect(replaced.status).toBe(200)
      expect(await replaced.json()).toMatchObject({ id: team.id, icon: 'https://example.com/logo.png' })
      const invalid = ['file:///private/logo.png', 'http://example.com/logo.png', 'javascript:alert(1)', 'https://user:secret@example.com/logo.png', `data:image/png;base64,${Buffer.alloc(256 * 1024 + 1).toString('base64')}`]
      for (const icon of invalid) {
        expect((await call(`/${team.id}/icon`, 'PUT', { icon })).status).toBe(400)
        expect((await runtime.ownerScopes.get(team.id)).icon).toBe('https://example.com/logo.png')
      }
      expect((await call('/personal/icon', 'PUT', { icon: logo })).status).toBe(400)
      expect((await call(`/${team.id}/icon`, 'PUT', { icon: null })).status).toBe(200)
      expect((await runtime.ownerScopes.get(team.id)).icon).toBeUndefined()
      expect((await runtime.capabilities(project.id)).some(capability => capability.kind === 'command' && capability.name === 'hello')).toBe(true)
      expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
      expect(await runtime.store.listRuns()).toEqual([])
    }
    finally {
      await host.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

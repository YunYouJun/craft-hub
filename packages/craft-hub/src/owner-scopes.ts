import type { OwnerScope, OwnerScopeUiState } from './types'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import { PERSONAL_OWNER_SCOPE_ID } from './types'

interface OwnerScopeCatalog {
  schemaVersion: 1
  teams: OwnerScope[]
}

interface PersistedOwnerScopeUiState {
  schemaVersion: 1
  activeScopeId: string
}

const personalScope: OwnerScope = {
  id: PERSONAL_OWNER_SCOPE_ID,
  kind: 'personal',
  name: 'Personal',
}

/** Own stable Personal and Team identities separately from their sync targets. */
export class OwnerScopeService {
  private readonly catalogPath: string
  private readonly statePath: string

  constructor(configDir: string, dataDir: string) {
    this.catalogPath = join(configDir, 'owner-scopes.yaml')
    this.statePath = join(dataDir, 'owner-scope-state.json')
  }

  /** List Personal first, followed by Teams in creation order. */
  async list(): Promise<OwnerScope[]> {
    return [personalScope, ...(await this.catalog()).teams]
  }

  /** Resolve one stable owner-scope identity. */
  async get(id: string): Promise<OwnerScope> {
    const scope = (await this.list()).find(item => item.id === id)
    if (!scope)
      throw new Error(`Unknown owner scope: ${id}`)
    return scope
  }

  /** Create a Team identity without coupling it to a particular Git target. */
  async createTeam(name: string): Promise<OwnerScope> {
    const trimmed = validateTeamName(name)
    const catalog = await this.catalog()
    const existing = await this.list()
    assertUniqueTeamName(existing, trimmed)
    const base = slug(trimmed) || `team-${randomUUID()}`
    let id = base === PERSONAL_OWNER_SCOPE_ID ? `team-${base}` : base
    let suffix = 2
    while (existing.some(scope => scope.id === id))
      id = `${base}-${suffix++}`
    const team: OwnerScope = { id, kind: 'team', name: trimmed }
    await writeAtomic(this.catalogPath, stringify({ ...catalog, teams: [...catalog.teams, team] }, { lineWidth: 0 }))
    return team
  }

  /** Rename a Team while preserving its stable owner-scope identity. */
  async renameTeam(id: string, name: string): Promise<OwnerScope> {
    const trimmed = validateTeamName(name)
    const catalog = await this.catalog()
    const existing = catalog.teams.find(team => team.id === id)
    if (!existing)
      throw new Error(`Unknown owner scope: ${id}`)
    assertUniqueTeamName(await this.list(), trimmed, id)
    const team = { ...existing, name: trimmed }
    await writeAtomic(this.catalogPath, stringify({
      ...catalog,
      teams: catalog.teams.map(item => item.id === id ? team : item),
    }, { lineWidth: 0 }))
    return team
  }

  /** Remove an empty Team identity, primarily to roll back failed setup. */
  async deleteTeam(id: string): Promise<void> {
    if (id === PERSONAL_OWNER_SCOPE_ID)
      throw new Error('Personal owner scope cannot be deleted')
    const catalog = await this.catalog()
    if (!catalog.teams.some(team => team.id === id))
      throw new Error(`Unknown owner scope: ${id}`)
    await writeAtomic(this.catalogPath, stringify({ ...catalog, teams: catalog.teams.filter(team => team.id !== id) }, { lineWidth: 0 }))
    if ((await this.uiState()).activeScopeId === id)
      await this.activate(PERSONAL_OWNER_SCOPE_ID)
  }

  /** Read the last active scope, falling back to Personal when it no longer exists. */
  async uiState(): Promise<OwnerScopeUiState> {
    try {
      const value = JSON.parse(await readFile(this.statePath, 'utf8')) as PersistedOwnerScopeUiState
      if (value.schemaVersion !== 1 || typeof value.activeScopeId !== 'string')
        throw new Error('Unsupported owner scope state schema')
      const activeScopeId = (await this.list()).some(scope => scope.id === value.activeScopeId)
        ? value.activeScopeId
        : PERSONAL_OWNER_SCOPE_ID
      return { activeScopeId }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { activeScopeId: PERSONAL_OWNER_SCOPE_ID }
      throw error
    }
  }

  /** Persist the active scope after validating that it exists. */
  async activate(id: string): Promise<OwnerScopeUiState> {
    await this.get(id)
    await writeJsonAtomic(this.statePath, { schemaVersion: 1, activeScopeId: id })
    return { activeScopeId: id }
  }

  private async catalog(): Promise<OwnerScopeCatalog> {
    try {
      const value = parse(await readFile(this.catalogPath, 'utf8')) as OwnerScopeCatalog
      if (value.schemaVersion !== 1 || !Array.isArray(value.teams))
        throw new Error('Unsupported owner scope catalog schema')
      if (value.teams.some(scope => scope.kind !== 'team' || !scope.id || !scope.name?.trim()))
        throw new Error('Owner scope catalog contains an invalid Team')
      return value
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { schemaVersion: 1, teams: [] }
      throw error
    }
  }
}

function slug(value: string): string {
  return value.toLowerCase().trim().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '')
}

function validateTeamName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed)
    throw new Error('Team name is required')
  return trimmed
}

function assertUniqueTeamName(scopes: OwnerScope[], name: string, exceptId?: string): void {
  if (scopes.some(scope => scope.id !== exceptId && scope.name.toLocaleLowerCase() === name.toLocaleLowerCase()))
    throw new Error(`Owner scope already exists: ${name}`)
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, path)
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

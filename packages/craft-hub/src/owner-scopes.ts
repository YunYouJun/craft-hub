import type { OwnerScope, OwnerScopeUiState } from './types'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PERSONAL_OWNER_SCOPE_ID } from './types'
import { ownerScopesFileName, ownerScopesSchemaUrl, UserConfigService } from './user-config'

interface OwnerScopeCatalog {
  schemaVersion: 1
  teams: OwnerScope[]
  extensions?: Record<string, unknown>
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
  private readonly userConfig: UserConfigService

  constructor(configDir: string, dataDir: string, userConfig?: UserConfigService) {
    this.catalogPath = ownerScopesFileName
    this.statePath = join(dataDir, 'owner-scope-state.json')
    this.userConfig = userConfig ?? new UserConfigService(configDir, dataDir)
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
    await this.writeCatalog({ ...catalog, teams: [...catalog.teams, team] })
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
    await this.writeCatalog({
      ...catalog,
      teams: catalog.teams.map(item => item.id === id ? team : item),
    })
    return team
  }

  /** Remove an empty Team identity, primarily to roll back failed setup. */
  async deleteTeam(id: string): Promise<void> {
    if (id === PERSONAL_OWNER_SCOPE_ID)
      throw new Error('Personal owner scope cannot be deleted')
    const catalog = await this.catalog()
    if (!catalog.teams.some(team => team.id === id))
      throw new Error(`Unknown owner scope: ${id}`)
    await this.writeCatalog({ ...catalog, teams: catalog.teams.filter(team => team.id !== id) })
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
    return this.userConfig.read(this.catalogPath, validateOwnerScopeCatalog, () => ({ schemaVersion: 1, teams: [] }))
  }

  private writeCatalog(catalog: OwnerScopeCatalog): Promise<void> {
    return this.userConfig.write(this.catalogPath, catalog, ownerScopesSchemaUrl, ['schemaVersion', 'teams', 'extensions'], validateOwnerScopeCatalog)
  }
}

function validateOwnerScopeCatalog(input: unknown): OwnerScopeCatalog {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Owner scope catalog must contain an object')
  const record = input as Record<string, unknown>
  const unknown = Object.keys(record).filter(key => !['$schema', 'schemaVersion', 'teams', 'extensions'].includes(key))
  if (unknown.length)
    throw new Error(`Owner scope catalog contains unknown fields: ${unknown.join(', ')}`)
  if (record.schemaVersion !== 1 || !Array.isArray(record.teams))
    throw new Error('Unsupported owner scope catalog schema')
  const teams = record.teams as OwnerScope[]
  if (teams.some(scope => !scope || typeof scope !== 'object' || Array.isArray(scope)
    || Object.keys(scope).some(key => !['id', 'kind', 'name'].includes(key))
    || scope.kind !== 'team'
    || typeof scope.id !== 'string'
    || !/^[a-z0-9][a-z0-9-]*$/.test(scope.id)
    || typeof scope.name !== 'string'
    || !scope.name.trim())) {
    throw new Error('Owner scope catalog contains an invalid Team')
  }
  if (new Set(teams.map(team => team.id)).size !== teams.length)
    throw new Error('Owner scope catalog Team ids must be unique')
  if (record.extensions !== undefined && (!record.extensions || typeof record.extensions !== 'object' || Array.isArray(record.extensions)))
    throw new Error('Owner scope catalog extensions must contain an object')
  return {
    schemaVersion: 1,
    teams,
    ...(record.extensions && typeof record.extensions === 'object' && !Array.isArray(record.extensions) ? { extensions: record.extensions as Record<string, unknown> } : {}),
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

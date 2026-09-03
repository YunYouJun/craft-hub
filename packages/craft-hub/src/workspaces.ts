import type { ProjectRegistry } from './projects'
import type { PortableWorkspaceSnapshot, ResolvedWorkspaceMember, WorkspaceCatalog, WorkspaceGroup, WorkspaceManifest, WorkspaceRecord, WorkspaceUiState } from './types'
import type { UserConfigDocument } from './user-config'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PERSONAL_OWNER_SCOPE_ID, projectAccentColors } from './types'
import { userConfigCatalogFileName, userConfigCatalogSchemaUrl, UserConfigService, workspaceFileExtension, workspaceSchemaUrl } from './user-config'

const workspaceManifestKeys = ['schemaVersion', 'id', 'ownerScopeId', 'name', 'icon', 'color', 'pinned', 'primaryProject', 'members', 'extensions']
const workspaceCatalogKeys = ['schemaVersion', 'workspaceOrder', 'groups', 'workspaceGroups', 'extensions']

interface WorkspaceBindings {
  schemaVersion: 1
  projects: Record<string, string>
  projectPaths: Record<string, string>
  projectsByScope?: Record<string, Record<string, string>>
  projectPathsByScope?: Record<string, Record<string, string>>
  projectGroups: Record<string, string>
  projectGroupsByScope?: Record<string, Record<string, string>>
  expandedWorkspaces: string[]
  selectedWorkspace?: string
  selectedProject?: string
  scopeUiStates?: Record<string, WorkspaceUiState>
}

/** Optimistic input used to save a portable workspace manifest. */
export interface SaveWorkspaceInput {
  manifest: WorkspaceManifest
  revision?: string
}

/** Machine-local member discovered while importing an external workspace document. */
export interface ImportedWorkspaceMemberInput {
  name: string
  path: string
  projectId?: string
  available?: boolean
}

/** Recoverable portable and machine-local state removed with one Team. */
export interface OwnerScopeWorkspaceData {
  snapshot: PortableWorkspaceSnapshot
  projectBindings: Record<string, string>
  projectPaths: Record<string, string>
  projectGroups: Record<string, string>
  uiState?: WorkspaceUiState
}

/** Raised when a workspace changes after the caller read it. */
export class WorkspaceConflictError extends Error {
  constructor(readonly actualRevision: string) {
    super('Workspace changed on disk. Reload it before saving.')
  }
}

/** Manage portable workspace manifests separately from machine-local bindings. */
export class WorkspaceService {
  private readonly bindingsPath: string
  private readonly userConfig: UserConfigService

  constructor(
    readonly configDir: string,
    dataDir: string,
    private readonly projects: ProjectRegistry,
    userConfig?: UserConfigService,
  ) {
    this.bindingsPath = join(dataDir, 'workspace-bindings.json')
    this.userConfig = userConfig ?? new UserConfigService(configDir, dataDir)
  }

  async list(ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<WorkspaceRecord[]> {
    const names = await this.userConfig.list('workspaces')
    const records = (await Promise.all(names.map(name => this.readFile(name))))
      .filter(record => workspaceOwnerScopeId(record) === ownerScopeId)
    const catalog = await this.catalog()
    const positions = new Map(catalog.workspaceOrder.map((id, index) => [id, index]))
    return records.map(record => ({ ...record, groupId: catalog.workspaceGroups[record.id] })).sort((left, right) => {
      if (Boolean(left.pinned) !== Boolean(right.pinned))
        return left.pinned ? -1 : 1
      return (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER)
        || left.name.localeCompare(right.name)
    })
  }

  async get(id: string, ownerScopeId?: string): Promise<WorkspaceRecord> {
    assertWorkspaceId(id)
    const [workspace, catalog] = await Promise.all([this.readFile(this.workspaceRelativePath(id)), this.catalog()])
    if (ownerScopeId && workspaceOwnerScopeId(workspace) !== ownerScopeId)
      throw new Error(`Workspace ${id} does not belong to owner scope ${ownerScopeId}`)
    return { ...workspace, groupId: catalog.workspaceGroups[id] }
  }

  async create(name: string, ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<WorkspaceRecord> {
    const id = slug(name) || randomUUID()
    let candidate = id
    let suffix = 2
    const existing = new Set(await this.userConfig.list('workspaces'))
    while (existing.has(this.workspaceRelativePath(candidate)))
      candidate = `${id}-${suffix++}`
    const record = await this.save({
      manifest: { schemaVersion: 1, id: candidate, name: name.trim(), ownerScopeId: portableOwnerScopeId(ownerScopeId), members: [] },
    })
    const catalog = await this.catalog()
    await this.saveCatalog({ ...catalog, workspaceOrder: [...catalog.workspaceOrder.filter(item => item !== candidate), candidate] })
    return record
  }

  /** List editable workspace groups in navigation order. */
  async groups(ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<WorkspaceGroup[]> {
    return (await this.catalog()).groups.filter(group => groupOwnerScopeId(group) === ownerScopeId)
  }

  /** Create an editable workspace group. */
  async createGroup(name: string, ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<WorkspaceGroup> {
    if (!name.trim())
      throw new Error('Workspace group name is required')
    const catalog = await this.catalog()
    const base = slug(name) || randomUUID()
    let id = base
    let suffix = 2
    while (catalog.groups.some(group => group.id === id))
      id = `${base}-${suffix++}`
    const group = { id, name: name.trim(), ownerScopeId: portableOwnerScopeId(ownerScopeId) }
    await this.saveCatalog({ ...catalog, groups: [...catalog.groups, group] })
    return group
  }

  /** Rename an editable workspace group. */
  async renameGroup(id: string, name: string, ownerScopeId?: string): Promise<WorkspaceGroup> {
    if (!name.trim())
      throw new Error('Workspace group name is required')
    const catalog = await this.catalog()
    const existing = catalog.groups.find(group => group.id === id)
    if (!existing)
      throw new Error(`Unknown workspace group: ${id}`)
    assertGroupScope(existing, ownerScopeId)
    const group = { ...existing, name: name.trim() }
    await this.saveCatalog({ ...catalog, groups: catalog.groups.map(item => item.id === id ? group : item) })
    return group
  }

  /** Set the optional portable icon or emoji for one workspace group. */
  async setGroupIcon(id: string, icon?: string, ownerScopeId?: string): Promise<WorkspaceGroup> {
    const catalog = await this.catalog()
    const existing = catalog.groups.find(group => group.id === id)
    if (!existing)
      throw new Error(`Unknown workspace group: ${id}`)
    assertGroupScope(existing, ownerScopeId)
    const group = { ...existing, icon: icon?.trim() || undefined }
    await this.saveCatalog({ ...catalog, groups: catalog.groups.map(item => item.id === id ? group : item) })
    return group
  }

  /** Delete a group without deleting its workspaces or standalone projects. */
  async deleteGroup(id: string, ownerScopeId?: string): Promise<void> {
    const catalog = await this.catalog()
    const existing = catalog.groups.find(group => group.id === id)
    if (!existing)
      throw new Error(`Unknown workspace group: ${id}`)
    assertGroupScope(existing, ownerScopeId)
    await this.saveCatalog({
      ...catalog,
      groups: catalog.groups.filter(group => group.id !== id),
      workspaceGroups: Object.fromEntries(Object.entries(catalog.workspaceGroups).filter(([, groupId]) => groupId !== id)),
    })
    const bindings = await this.bindings()
    const scopeId = groupOwnerScopeId(existing)
    const projectGroupsByScope = { ...bindings.projectGroupsByScope }
    projectGroupsByScope[scopeId] = Object.fromEntries(Object.entries(projectGroups(bindings, scopeId)).filter(([, groupId]) => groupId !== id))
    await writeJsonAtomic(this.bindingsPath, {
      ...bindings,
      projectGroups: scopeId === PERSONAL_OWNER_SCOPE_ID ? projectGroupsByScope[scopeId] : bindings.projectGroups,
      projectGroupsByScope,
    })
  }

  /** Move one workspace into a group, or remove it from grouping. */
  async assignGroup(workspaceId: string, groupId?: string, ownerScopeId?: string): Promise<WorkspaceRecord> {
    const workspace = await this.get(workspaceId, ownerScopeId)
    const catalog = await this.catalog()
    const group = groupId ? catalog.groups.find(item => item.id === groupId) : undefined
    if (groupId && !group)
      throw new Error(`Unknown workspace group: ${groupId}`)
    if (group && groupOwnerScopeId(group) !== workspaceOwnerScopeId(workspace))
      throw new Error('Workspace and group must belong to the same owner scope')
    const workspaceGroups = { ...catalog.workspaceGroups }
    if (groupId)
      workspaceGroups[workspaceId] = groupId
    else
      delete workspaceGroups[workspaceId]
    await this.saveCatalog({ ...catalog, workspaceGroups })
    return this.getWithGroup(workspaceId)
  }

  /** List machine-local group assignments for registered standalone projects. */
  async projectGroupAssignments(ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<Record<string, string>> {
    const [bindings, catalog, projects] = await Promise.all([this.bindings(), this.catalog(), this.projects.list()])
    const projectIds = new Set(projects.map(project => project.id))
    const groupIds = new Set(catalog.groups.map(group => group.id))
    return Object.fromEntries(Object.entries(projectGroups(bindings, ownerScopeId))
      .filter(([projectId, groupId]) => projectIds.has(projectId) && groupIds.has(groupId)))
  }

  /** Map registered projects to the non-Personal owner scopes that explicitly reference them. */
  async projectOwnerScopes(ownerScopeIds: string[]): Promise<Record<string, string[]>> {
    const scopes = [...new Set(ownerScopeIds.filter(ownerScopeId => ownerScopeId !== PERSONAL_OWNER_SCOPE_ID))]
    scopes.forEach(assertOwnerScopeId)
    const entries = await Promise.all(scopes.map(async (ownerScopeId) => {
      const [workspaces, groupedProjects] = await Promise.all([
        this.list(ownerScopeId),
        this.projectGroupAssignments(ownerScopeId),
      ])
      const projectIds = new Set([
        ...Object.keys(groupedProjects),
        ...workspaces.flatMap(workspace => workspace.members.map(member => member.projectId).filter((projectId): projectId is string => Boolean(projectId))),
      ])
      return { ownerScopeId, projectIds }
    }))
    const result: Record<string, string[]> = {}
    for (const { ownerScopeId, projectIds } of entries) {
      for (const projectId of projectIds)
        result[projectId] = [...(result[projectId] ?? []), ownerScopeId]
    }
    return result
  }

  /** Move one registered standalone project into a navigation group, or leave it ungrouped. */
  async assignProjectGroup(projectId: string, groupId?: string, ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<Record<string, string>> {
    await this.projects.get(projectId)
    const [bindings, catalog] = await Promise.all([this.bindings(), this.catalog()])
    if (groupId && !catalog.groups.some(group => group.id === groupId && groupOwnerScopeId(group) === ownerScopeId))
      throw new Error(`Unknown workspace group: ${groupId}`)
    const assignments = { ...projectGroups(bindings, ownerScopeId) }
    if (groupId)
      assignments[projectId] = groupId
    else
      delete assignments[projectId]
    await writeJsonAtomic(this.bindingsPath, {
      ...bindings,
      projectGroups: ownerScopeId === PERSONAL_OWNER_SCOPE_ID ? assignments : bindings.projectGroups,
      projectGroupsByScope: { ...bindings.projectGroupsByScope, [ownerScopeId]: assignments },
    })
    return this.projectGroupAssignments(ownerScopeId)
  }

  /** Create one owned workspace from imported members and retain paths only in local bindings. */
  async importWorkspace(name: string, members: ImportedWorkspaceMemberInput[], groupId: string, ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<WorkspaceRecord> {
    let workspace = await this.create(name, ownerScopeId)
    const bindings = await this.bindings()
    const scopedProjects = scopeProjects(bindings, ownerScopeId)
    const scopedProjectPaths = scopeProjectPaths(bindings, ownerScopeId)
    const used = new Set([...Object.keys(scopedProjects), ...Object.keys(scopedProjectPaths), ...workspace.members.map(member => member.project)])
    const manifest = portableManifest(workspace)
    for (const member of members) {
      let key: string
      if (member.projectId) {
        key = await this.projectKey(member.projectId, workspace)
      }
      else {
        const existing = Object.entries(scopedProjectPaths).find(([, path]) => path === member.path)?.[0]
        if (existing) {
          key = existing
        }
        else {
          const base = slug(member.name) || 'project'
          key = base
          let suffix = 2
          while (used.has(key))
            key = `${base}-${suffix++}`
        }
      }
      used.add(key)
      manifest.members.push({ project: key, label: member.name, discoveryHint: basenameHint(member.path) })
      await this.rememberProjectPath(key, member.path, ownerScopeId)
    }
    manifest.primaryProject = manifest.members[0]?.project
    workspace = await this.save({ manifest, revision: workspace.revision })
    return this.assignGroup(workspace.id, groupId, ownerScopeId)
  }

  async save(input: SaveWorkspaceInput): Promise<WorkspaceRecord> {
    const manifest = validateManifest(input.manifest)
    const path = this.workspaceRelativePath(manifest.id)
    const current = await this.workspaceSource(manifest.id)
    if (current) {
      const currentManifest = current.value
      if ((currentManifest.ownerScopeId ?? PERSONAL_OWNER_SCOPE_ID) !== (input.manifest.ownerScopeId ?? PERSONAL_OWNER_SCOPE_ID))
        throw new Error('Changing workspace owner scope requires an explicit copy operation')
    }
    const actualRevision = revision(current?.content ?? '')
    if (current && input.revision !== actualRevision)
      throw new WorkspaceConflictError(actualRevision)
    if (!current && input.revision)
      throw new WorkspaceConflictError(revision(''))
    await this.userConfig.write(path, manifest, workspaceSchemaUrl, workspaceManifestKeys, validateManifest)
    return this.get(input.manifest.id)
  }

  async delete(id: string, expectedRevision: string, ownerScopeId?: string): Promise<void> {
    const current = await this.get(id, ownerScopeId)
    if (current.revision !== expectedRevision)
      throw new WorkspaceConflictError(current.revision)
    await this.userConfig.remove(this.workspaceRelativePath(id))
    const catalog = await this.catalog()
    const workspaceGroups = { ...catalog.workspaceGroups }
    delete workspaceGroups[id]
    await this.saveCatalog({ ...catalog, workspaceOrder: catalog.workspaceOrder.filter(item => item !== id), workspaceGroups })
  }

  async reorder(workspaceOrder: string[], ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<WorkspaceCatalog> {
    const known = new Set((await this.list(ownerScopeId)).map(workspace => workspace.id))
    if (new Set(workspaceOrder).size !== workspaceOrder.length || workspaceOrder.some(id => !known.has(id)))
      throw new Error('Workspace order must contain unique, known workspace ids')
    const current = await this.catalog()
    const catalog = {
      ...current,
      workspaceOrder: replaceScopeOrder(current.workspaceOrder, known, workspaceOrder),
    }
    await this.saveCatalog(catalog)
    return catalog
  }

  /** Export only user-owned workspace manifests and their portable order. */
  async portableSnapshot(ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<PortableWorkspaceSnapshot> {
    const workspaces = await this.list(ownerScopeId)
    const catalog = await this.catalog()
    const groupIds = new Set(catalog.groups.filter(group => groupOwnerScopeId(group) === ownerScopeId).map(group => group.id))
    return {
      schemaVersion: 1,
      workspaces: workspaces.map(portableManifest),
      workspaceOrder: catalog.workspaceOrder.filter(id => workspaces.some(workspace => workspace.id === id)),
      groups: catalog.groups.filter(group => groupIds.has(group.id)),
      workspaceGroups: Object.fromEntries(Object.entries(catalog.workspaceGroups).filter(([id, groupId]) => workspaces.some(workspace => workspace.id === id) && groupIds.has(groupId))),
    }
  }

  /** Apply one portable manifest while preserving this machine's project bindings and trust. */
  async applyPortableManifest(manifest: WorkspaceManifest, ownerScopeId = manifest.ownerScopeId ?? PERSONAL_OWNER_SCOPE_ID): Promise<WorkspaceRecord> {
    validateManifest(manifest)
    const scopedManifest = { ...manifest, ownerScopeId: portableOwnerScopeId(ownerScopeId) }
    try {
      const current = await this.get(manifest.id, ownerScopeId)
      return this.save({ manifest: scopedManifest, revision: current.revision })
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return this.save({ manifest: scopedManifest })
      throw error
    }
  }

  /** Apply portable ordering without deleting local-only workspaces. */
  async applyPortableOrder(remoteOrder: string[], ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<WorkspaceCatalog> {
    const known = (await this.list(ownerScopeId)).map(workspace => workspace.id)
    const remoteKnown = remoteOrder.filter(id => known.includes(id))
    return this.reorder([...new Set([...remoteKnown, ...known])], ownerScopeId)
  }

  /** Apply portable ordering and groups without deleting local-only workspaces or groups. */
  async applyPortableCatalog(input: Pick<WorkspaceCatalog, 'groups' | 'workspaceGroups' | 'workspaceOrder'>, ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<WorkspaceCatalog> {
    if (!Array.isArray(input.groups) || input.groups.some(group => !group.id || !group.name?.trim()))
      throw new Error('Cloud workspace groups are invalid')
    if (!input.workspaceGroups || typeof input.workspaceGroups !== 'object')
      throw new Error('Cloud workspace group assignments are invalid')
    const [knownWorkspaces, local] = await Promise.all([this.list(ownerScopeId), this.catalog()])
    const foreignGroupIds = new Set(local.groups.filter(group => groupOwnerScopeId(group) !== ownerScopeId).map(group => group.id))
    if (input.groups.some(group => foreignGroupIds.has(group.id)))
      throw new Error('Workspace group id belongs to another owner scope')
    const knownIds = new Set(knownWorkspaces.map(workspace => workspace.id))
    const remoteOrder = input.workspaceOrder.filter(id => knownIds.has(id))
    const remoteGroupIds = new Set(input.groups.map(group => group.id))
    const remoteGroups = input.groups.map(group => ({ ...group, ownerScopeId: portableOwnerScopeId(ownerScopeId) }))
    const groups = [
      ...local.groups.filter(group => groupOwnerScopeId(group) !== ownerScopeId),
      ...remoteGroups,
      ...local.groups.filter(group => groupOwnerScopeId(group) === ownerScopeId && !remoteGroupIds.has(group.id)),
    ]
    const workspaceGroups = {
      ...Object.fromEntries(Object.entries(local.workspaceGroups).filter(([id]) => !input.workspaceOrder.includes(id))),
      ...Object.fromEntries(Object.entries(input.workspaceGroups).filter(([id, groupId]) => knownIds.has(id) && groups.some(group => group.id === groupId))),
    }
    const catalog = {
      schemaVersion: 1 as const,
      workspaceOrder: replaceScopeOrder(local.workspaceOrder, knownIds, [...new Set([...remoteOrder, ...knownWorkspaces.map(workspace => workspace.id)])]),
      groups,
      workspaceGroups,
    }
    await this.saveCatalog(catalog)
    return catalog
  }

  /** Replace portable workspace state while retaining machine-local project bindings and UI state. */
  async replacePortableSnapshot(snapshot: PortableWorkspaceSnapshot, ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<WorkspaceCatalog> {
    if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.workspaces))
      throw new Error('Portable workspace snapshot is invalid')
    const ids = snapshot.workspaces.map(workspace => workspace.id)
    if (new Set(ids).size !== ids.length)
      throw new Error('Portable workspace ids must be unique')
    if (!Array.isArray(snapshot.groups) || snapshot.groups.some(group => !group.id || !group.name?.trim()))
      throw new Error('Portable workspace groups are invalid')
    if (!snapshot.workspaceGroups || typeof snapshot.workspaceGroups !== 'object')
      throw new Error('Portable workspace group assignments are invalid')
    if (!Array.isArray(snapshot.workspaceOrder) || new Set(snapshot.workspaceOrder).size !== snapshot.workspaceOrder.length || snapshot.workspaceOrder.some(id => !ids.includes(id)))
      throw new Error('Portable workspace order is invalid')
    for (const manifest of snapshot.workspaces)
      validateManifest(manifest)
    const currentCatalog = await this.catalog()
    const foreignGroupIds = new Set(currentCatalog.groups.filter(group => groupOwnerScopeId(group) !== ownerScopeId).map(group => group.id))
    if (snapshot.groups.some(group => foreignGroupIds.has(group.id)))
      throw new Error('Workspace group id belongs to another owner scope')
    const previousWorkspaces = await this.list(ownerScopeId)
    const previousIds = new Set(previousWorkspaces.map(workspace => workspace.id))
    for (const manifest of snapshot.workspaces) {
      const existing = await this.workspaceSource(manifest.id)
      if (existing) {
        const existingManifest = existing.value
        if ((existingManifest.ownerScopeId ?? PERSONAL_OWNER_SCOPE_ID) !== ownerScopeId)
          throw new Error(`Workspace id belongs to another owner scope: ${manifest.id}`)
      }
    }
    for (const manifest of snapshot.workspaces) {
      const scopedManifest = validateManifest({ ...manifest, ownerScopeId: portableOwnerScopeId(ownerScopeId) })
      await this.userConfig.write(this.workspaceRelativePath(manifest.id), scopedManifest, workspaceSchemaUrl, workspaceManifestKeys, validateManifest)
    }
    const retained = new Set(ids)
    for (const workspace of previousWorkspaces) {
      if (!retained.has(workspace.id))
        await this.userConfig.remove(this.workspaceRelativePath(workspace.id))
    }
    const replacedGroupIds = new Set(currentCatalog.groups.filter(group => groupOwnerScopeId(group) === ownerScopeId).map(group => group.id))
    const scopedGroups = snapshot.groups.map(group => ({ ...group, ownerScopeId: portableOwnerScopeId(ownerScopeId) }))
    const catalog: WorkspaceCatalog = {
      schemaVersion: 1,
      workspaceOrder: replaceScopeOrder(currentCatalog.workspaceOrder, previousIds, snapshot.workspaceOrder.filter(id => retained.has(id))),
      groups: [...currentCatalog.groups.filter(group => groupOwnerScopeId(group) !== ownerScopeId), ...scopedGroups],
      workspaceGroups: {
        ...Object.fromEntries(Object.entries(currentCatalog.workspaceGroups).filter(([workspaceId, groupId]) => !retained.has(workspaceId) && !replacedGroupIds.has(groupId))),
        ...Object.fromEntries(Object.entries(snapshot.workspaceGroups).filter(([id, groupId]) => retained.has(id) && scopedGroups.some(group => group.id === groupId))),
      },
    }
    await this.saveCatalog(catalog)
    return catalog
  }

  /** Remove every portable and machine-local record owned by one Team. */
  async deleteOwnerScopeData(ownerScopeId: string): Promise<OwnerScopeWorkspaceData> {
    if (ownerScopeId === PERSONAL_OWNER_SCOPE_ID)
      throw new Error('Personal workspace data cannot be deleted as an owner scope')
    assertOwnerScopeId(ownerScopeId)
    const [snapshot, catalog, bindings] = await Promise.all([
      this.portableSnapshot(ownerScopeId),
      this.catalog(),
      this.bindings(),
    ])
    const data: OwnerScopeWorkspaceData = {
      snapshot,
      projectBindings: { ...scopeProjects(bindings, ownerScopeId) },
      projectPaths: { ...scopeProjectPaths(bindings, ownerScopeId) },
      projectGroups: { ...projectGroups(bindings, ownerScopeId) },
      uiState: bindings.scopeUiStates?.[ownerScopeId],
    }
    const workspaceIds = new Set(snapshot.workspaces.map(workspace => workspace.id))
    const groupIds = new Set(snapshot.groups.map(group => group.id))
    try {
      for (const workspaceId of workspaceIds)
        await this.userConfig.remove(this.workspaceRelativePath(workspaceId))
      await this.saveCatalog({
        ...catalog,
        workspaceOrder: catalog.workspaceOrder.filter(id => !workspaceIds.has(id)),
        groups: catalog.groups.filter(group => !groupIds.has(group.id)),
        workspaceGroups: Object.fromEntries(Object.entries(catalog.workspaceGroups)
          .filter(([workspaceId, groupId]) => !workspaceIds.has(workspaceId) && !groupIds.has(groupId))),
      })
      const projectsByScope = { ...bindings.projectsByScope }
      const projectPathsByScope = { ...bindings.projectPathsByScope }
      const projectGroupsByScope = { ...bindings.projectGroupsByScope }
      const scopeUiStates = { ...bindings.scopeUiStates }
      delete projectsByScope[ownerScopeId]
      delete projectPathsByScope[ownerScopeId]
      delete projectGroupsByScope[ownerScopeId]
      delete scopeUiStates[ownerScopeId]
      await writeJsonAtomic(this.bindingsPath, {
        ...bindings,
        projectsByScope,
        projectPathsByScope,
        projectGroupsByScope,
        scopeUiStates,
      })
      return data
    }
    catch (error) {
      await this.restoreOwnerScopeData(ownerScopeId, data)
      throw error
    }
  }

  /** Restore a Team state receipt after a later lifecycle operation fails. */
  async restoreOwnerScopeData(ownerScopeId: string, data: OwnerScopeWorkspaceData): Promise<void> {
    if (ownerScopeId === PERSONAL_OWNER_SCOPE_ID)
      throw new Error('Personal workspace data cannot be restored as a Team owner scope')
    await this.replacePortableSnapshot(data.snapshot, ownerScopeId)
    const bindings = await this.bindings()
    const scopeUiStates = { ...bindings.scopeUiStates }
    if (data.uiState)
      scopeUiStates[ownerScopeId] = data.uiState
    else
      delete scopeUiStates[ownerScopeId]
    await writeJsonAtomic(this.bindingsPath, {
      ...bindings,
      projectsByScope: { ...bindings.projectsByScope, [ownerScopeId]: data.projectBindings },
      projectPathsByScope: { ...bindings.projectPathsByScope, [ownerScopeId]: data.projectPaths },
      projectGroupsByScope: { ...bindings.projectGroupsByScope, [ownerScopeId]: data.projectGroups },
      scopeUiStates,
    })
  }

  /** Resolve a portable project key through this machine's bindings without changing trust. */
  async resolveProjectKey(projectKey: string, ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<string | undefined> {
    const projectId = scopeProjects(await this.bindings(), ownerScopeId)[projectKey]
    if (!projectId)
      return undefined
    return (await this.projects.list()).some(project => project.id === projectId) ? projectId : undefined
  }

  async bind(projectKey: string, projectId: string, ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<void> {
    await this.projects.get(projectId)
    const bindings = await this.bindings()
    const projects = { ...scopeProjects(bindings, ownerScopeId), [projectKey]: projectId }
    await writeJsonAtomic(this.bindingsPath, {
      ...bindings,
      projects: ownerScopeId === PERSONAL_OWNER_SCOPE_ID ? projects : bindings.projects,
      projectsByScope: { ...bindings.projectsByScope, [ownerScopeId]: projects },
    })
  }

  /** Resolve and register a member from its retained import path without granting trust. */
  async registerImportedProject(workspaceId: string, projectKey: string, locatedPath?: string, ownerScopeId?: string): Promise<WorkspaceRecord> {
    const workspace = await this.get(workspaceId, ownerScopeId)
    if (!workspace.members.some(member => member.project === projectKey))
      throw new Error(`Unknown workspace member: ${projectKey}`)
    const workspaceScopeId = workspaceOwnerScopeId(workspace)
    const path = locatedPath ?? scopeProjectPaths(await this.bindings(), workspaceScopeId)[projectKey]
    if (!path)
      throw new Error(`Workspace member path is unavailable: ${projectKey}`)
    const project = await this.projects.add(path)
    if (locatedPath)
      await this.rememberProjectPath(projectKey, project.path, workspaceScopeId)
    await this.bind(projectKey, project.id, workspaceScopeId)
    return this.getWithGroup(workspaceId)
  }

  async uiState(ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<WorkspaceUiState> {
    const bindings = await this.bindings()
    const scoped = bindings.scopeUiStates?.[ownerScopeId]
    return {
      expandedWorkspaceIds: scoped?.expandedWorkspaceIds ?? (ownerScopeId === PERSONAL_OWNER_SCOPE_ID ? bindings.expandedWorkspaces : []),
      selectedWorkspaceId: scoped?.selectedWorkspaceId ?? (ownerScopeId === PERSONAL_OWNER_SCOPE_ID ? bindings.selectedWorkspace : undefined),
      selectedProjectId: scoped?.selectedProjectId ?? (ownerScopeId === PERSONAL_OWNER_SCOPE_ID ? bindings.selectedProject : undefined),
    }
  }

  async updateUiState(state: WorkspaceUiState, ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<WorkspaceUiState> {
    if (!Array.isArray(state.expandedWorkspaceIds) || !state.expandedWorkspaceIds.every(id => typeof id === 'string'))
      throw new Error('Expanded workspace ids must be an array of strings')
    const bindings = await this.bindings()
    const scoped = {
      expandedWorkspaceIds: [...new Set(state.expandedWorkspaceIds)],
      selectedWorkspaceId: state.selectedWorkspaceId || undefined,
      selectedProjectId: state.selectedProjectId || undefined,
    }
    await writeJsonAtomic(this.bindingsPath, {
      ...bindings,
      expandedWorkspaces: ownerScopeId === PERSONAL_OWNER_SCOPE_ID ? scoped.expandedWorkspaceIds : bindings.expandedWorkspaces,
      selectedWorkspace: ownerScopeId === PERSONAL_OWNER_SCOPE_ID ? scoped.selectedWorkspaceId : bindings.selectedWorkspace,
      selectedProject: ownerScopeId === PERSONAL_OWNER_SCOPE_ID ? scoped.selectedProjectId : bindings.selectedProject,
      scopeUiStates: { ...bindings.scopeUiStates, [ownerScopeId]: scoped },
    })
    return this.uiState(ownerScopeId)
  }

  async addProject(workspaceId: string, projectId: string, ownerScopeId?: string): Promise<WorkspaceRecord> {
    const workspace = await this.get(workspaceId, ownerScopeId)
    const key = await this.projectKey(projectId, workspace)
    if (workspace.members.some(member => member.project === key))
      return workspace
    const manifest = portableManifest(workspace)
    manifest.members.push({ project: key })
    manifest.primaryProject ??= key
    return this.save({ manifest, revision: workspace.revision })
  }

  async removeProject(workspaceId: string, projectIdOrKey: string, ownerScopeId?: string): Promise<WorkspaceRecord> {
    const workspace = await this.get(workspaceId, ownerScopeId)
    const member = workspace.members.find(item => item.projectId === projectIdOrKey || item.project === projectIdOrKey)
    if (!member)
      return workspace
    const manifest = portableManifest(workspace)
    manifest.members = manifest.members.filter(item => item.project !== member.project)
    if (manifest.primaryProject === member.project)
      manifest.primaryProject = manifest.members[0]?.project
    return this.save({ manifest, revision: workspace.revision })
  }

  async projectKey(projectId: string, workspace?: WorkspaceRecord): Promise<string> {
    const bindings = await this.bindings()
    const ownerScopeId = workspaceOwnerScopeId(workspace ?? {})
    const scopedProjects = scopeProjects(bindings, ownerScopeId)
    const existing = Object.entries(scopedProjects).find(([, id]) => id === projectId)?.[0]
    if (existing)
      return existing
    const project = await this.projects.get(projectId)
    const base = slug(project.name) || project.id
    const used = new Set([
      ...Object.keys(scopedProjects),
      ...(workspace?.members.map(member => member.project) ?? []),
    ])
    let key = base
    let suffix = 2
    while (used.has(key))
      key = `${base}-${suffix++}`
    await this.bind(key, projectId, ownerScopeId)
    return key
  }

  private async readFile(path: string): Promise<WorkspaceRecord> {
    const { content, value: manifest } = await this.userConfig.readSource(path, validateManifest)
    const bindings = await this.bindings()
    const projects = await this.projects.list()
    const members: ResolvedWorkspaceMember[] = manifest.members.map((member) => {
      const projectId = scopeProjects(bindings, manifest.ownerScopeId ?? PERSONAL_OWNER_SCOPE_ID)[member.project]
      const resolved = Boolean(projectId && projects.some(project => project.id === projectId))
      return {
        ...member,
        projectId: resolved ? projectId : undefined,
        resolved,
        path: resolved ? undefined : scopeProjectPaths(bindings, manifest.ownerScopeId ?? PERSONAL_OWNER_SCOPE_ID)[member.project],
      }
    })
    return { ...manifest, ownerScopeId: manifest.ownerScopeId ?? PERSONAL_OWNER_SCOPE_ID, members, revision: revision(content) }
  }

  private async catalog(): Promise<WorkspaceCatalog> {
    const value = await this.userConfig.read(userConfigCatalogFileName, validateCatalog, emptyCatalog)
    return {
      ...value,
      groups: Array.isArray(value.groups) ? value.groups.map(group => ({ ...group, ownerScopeId: portableOwnerScopeId(groupOwnerScopeId(group)) })) : [],
      workspaceGroups: value.workspaceGroups && typeof value.workspaceGroups === 'object' ? value.workspaceGroups : {},
    }
  }

  private async saveCatalog(catalog: WorkspaceCatalog): Promise<void> {
    await this.userConfig.write(userConfigCatalogFileName, catalog, userConfigCatalogSchemaUrl, workspaceCatalogKeys, validateCatalog)
  }

  private async bindings(): Promise<WorkspaceBindings> {
    try {
      const bindings = JSON.parse(await readFile(this.bindingsPath, 'utf8')) as WorkspaceBindings
      const personalProjectGroups = bindings.projectGroupsByScope?.[PERSONAL_OWNER_SCOPE_ID] ?? bindings.projectGroups ?? {}
      const personalProjects = bindings.projectsByScope?.[PERSONAL_OWNER_SCOPE_ID] ?? bindings.projects ?? {}
      const personalProjectPaths = bindings.projectPathsByScope?.[PERSONAL_OWNER_SCOPE_ID] ?? bindings.projectPaths ?? {}
      const personalUiState = bindings.scopeUiStates?.[PERSONAL_OWNER_SCOPE_ID] ?? {
        expandedWorkspaceIds: bindings.expandedWorkspaces ?? [],
        selectedWorkspaceId: bindings.selectedWorkspace,
        selectedProjectId: bindings.selectedProject,
      }
      return {
        ...bindings,
        projects: personalProjects,
        projectPaths: personalProjectPaths,
        projectsByScope: { ...bindings.projectsByScope, [PERSONAL_OWNER_SCOPE_ID]: personalProjects },
        projectPathsByScope: { ...bindings.projectPathsByScope, [PERSONAL_OWNER_SCOPE_ID]: personalProjectPaths },
        projectGroups: personalProjectGroups,
        projectGroupsByScope: { ...bindings.projectGroupsByScope, [PERSONAL_OWNER_SCOPE_ID]: personalProjectGroups },
        expandedWorkspaces: bindings.expandedWorkspaces ?? [],
        scopeUiStates: { ...bindings.scopeUiStates, [PERSONAL_OWNER_SCOPE_ID]: personalUiState },
      }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { schemaVersion: 1, projects: {}, projectPaths: {}, projectGroups: {}, expandedWorkspaces: [] }
      throw error
    }
  }

  private async rememberProjectPath(projectKey: string, path: string, ownerScopeId = PERSONAL_OWNER_SCOPE_ID): Promise<void> {
    const bindings = await this.bindings()
    const projectPaths = { ...scopeProjectPaths(bindings, ownerScopeId), [projectKey]: path }
    await writeJsonAtomic(this.bindingsPath, {
      ...bindings,
      projectPaths: ownerScopeId === PERSONAL_OWNER_SCOPE_ID ? projectPaths : bindings.projectPaths,
      projectPathsByScope: { ...bindings.projectPathsByScope, [ownerScopeId]: projectPaths },
    })
  }

  private async getWithGroup(id: string): Promise<WorkspaceRecord> {
    return this.get(id)
  }

  private workspaceRelativePath(id: string): string {
    assertWorkspaceId(id)
    return `workspaces/${id}${workspaceFileExtension}`
  }

  private async workspaceSource(id: string): Promise<UserConfigDocument<WorkspaceManifest> | undefined> {
    try {
      return await this.userConfig.readSource(this.workspaceRelativePath(id), validateManifest)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return undefined
      throw error
    }
  }
}

function emptyCatalog(): WorkspaceCatalog {
  return { schemaVersion: 1, workspaceOrder: [], groups: [], workspaceGroups: {} }
}

function basenameHint(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? path
}

function portableManifest(record: WorkspaceRecord): WorkspaceManifest {
  return {
    schemaVersion: 1,
    id: record.id,
    ownerScopeId: portableOwnerScopeId(workspaceOwnerScopeId(record)),
    name: record.name,
    icon: record.icon,
    color: record.color,
    pinned: record.pinned,
    primaryProject: record.primaryProject,
    members: record.members.map(({ project, label, pinned, discoveryHint }) => ({ project, label, pinned, discoveryHint })),
  }
}

function validateManifest(input: unknown): WorkspaceManifest {
  const value = configRecord(input, workspaceManifestKeys, 'Workspace manifest') as unknown as WorkspaceManifest
  if (value.schemaVersion !== 1)
    throw new Error('Unsupported workspace schema version')
  assertWorkspaceId(value.id)
  if (value.ownerScopeId !== undefined)
    assertOwnerScopeId(value.ownerScopeId)
  if (!value.name?.trim())
    throw new Error('Workspace name is required')
  if (value.icon !== undefined && typeof value.icon !== 'string')
    throw new Error('Workspace icon must be a string')
  if (value.color && !projectAccentColors.includes(value.color))
    throw new Error('Workspace color is invalid')
  if (value.pinned !== undefined && typeof value.pinned !== 'boolean')
    throw new Error('Workspace pinned state must be a boolean')
  if (value.primaryProject !== undefined && typeof value.primaryProject !== 'string')
    throw new Error('Workspace primary project must be a string')
  if (!Array.isArray(value.members) || value.members.some(member => !isConfigRecord(member)))
    throw new Error('Workspace members must contain objects')
  if (value.members.some(member => Object.keys(member).some(key => !['project', 'label', 'pinned', 'discoveryHint'].includes(key))))
    throw new Error('Workspace members contain unknown fields')
  if (value.members.some(member => typeof member.project !== 'string' || !member.project.trim()))
    throw new Error('Workspace members require project keys')
  if (value.members.some(member => member.label !== undefined && (typeof member.label !== 'string' || !member.label.trim())))
    throw new Error('Workspace member labels must be non-empty strings')
  if (value.members.some(member => member.pinned !== undefined && typeof member.pinned !== 'boolean'))
    throw new Error('Workspace member pinned states must be booleans')
  if (value.members.some(member => member.discoveryHint !== undefined && typeof member.discoveryHint !== 'string'))
    throw new Error('Workspace member discovery hints must be strings')
  if (new Set(value.members.map(member => member.project)).size !== value.members.length)
    throw new Error('Workspace members must be unique')
  if (value.primaryProject && !value.members.some(member => member.project === value.primaryProject))
    throw new Error('Primary project must be a workspace member')
  if (value.extensions !== undefined && !isConfigRecord(value.extensions))
    throw new Error('Workspace extensions must contain an object')
  return value
}

function validateCatalog(input: unknown): WorkspaceCatalog {
  const value = configRecord(input, workspaceCatalogKeys, 'Craft Hub config') as unknown as WorkspaceCatalog
  if (value.schemaVersion !== 1 || !Array.isArray(value.workspaceOrder))
    throw new Error('Unsupported Craft Hub config schema')
  if (new Set(value.workspaceOrder).size !== value.workspaceOrder.length || value.workspaceOrder.some(id => typeof id !== 'string'))
    throw new Error('Craft Hub config workspace order is invalid')
  if (value.groups !== undefined && !Array.isArray(value.groups))
    throw new Error('Craft Hub config groups are invalid')
  if ((value.groups ?? []).some(group => !isConfigRecord(group)
    || Object.keys(group).some(key => !['id', 'name', 'icon', 'ownerScopeId'].includes(key))
    || typeof group.id !== 'string'
    || !group.id
    || typeof group.name !== 'string'
    || !group.name.trim()
    || (group.icon !== undefined && typeof group.icon !== 'string')
    || (group.ownerScopeId !== undefined && typeof group.ownerScopeId !== 'string'))) {
    throw new Error('Craft Hub config groups contain invalid entries')
  }
  if (value.workspaceGroups !== undefined && (!value.workspaceGroups || typeof value.workspaceGroups !== 'object' || Array.isArray(value.workspaceGroups)))
    throw new Error('Craft Hub config workspace groups are invalid')
  if (Object.values(value.workspaceGroups ?? {}).some(groupId => typeof groupId !== 'string'))
    throw new Error('Craft Hub config workspace group assignments are invalid')
  if (value.extensions !== undefined && !isConfigRecord(value.extensions))
    throw new Error('Craft Hub config extensions must contain an object')
  return value
}

function isConfigRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input)
}

function configRecord(input: unknown, knownKeys: string[], label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error(`${label} must contain an object`)
  const record = input as Record<string, unknown>
  const unknown = Object.keys(record).filter(key => key !== '$schema' && !knownKeys.includes(key))
  if (unknown.length)
    throw new Error(`${label} contains unknown fields: ${unknown.join(', ')}`)
  const { $schema: _schema, ...value } = record
  return value
}

function assertOwnerScopeId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
    throw new Error('Owner scope id must contain lowercase letters, numbers, and hyphens')
}

function groupOwnerScopeId(group: WorkspaceGroup): string {
  return group.ownerScopeId ?? PERSONAL_OWNER_SCOPE_ID
}

function workspaceOwnerScopeId(workspace: Pick<WorkspaceManifest, 'ownerScopeId'>): string {
  return workspace.ownerScopeId ?? PERSONAL_OWNER_SCOPE_ID
}

function portableOwnerScopeId(ownerScopeId: string): string | undefined {
  assertOwnerScopeId(ownerScopeId)
  return ownerScopeId === PERSONAL_OWNER_SCOPE_ID ? undefined : ownerScopeId
}

function assertGroupScope(group: WorkspaceGroup, ownerScopeId?: string): void {
  if (ownerScopeId && groupOwnerScopeId(group) !== ownerScopeId)
    throw new Error(`Workspace group ${group.id} does not belong to owner scope ${ownerScopeId}`)
}

function projectGroups(bindings: WorkspaceBindings, ownerScopeId: string): Record<string, string> {
  return bindings.projectGroupsByScope?.[ownerScopeId]
    ?? (ownerScopeId === PERSONAL_OWNER_SCOPE_ID ? bindings.projectGroups : {})
}

function scopeProjects(bindings: WorkspaceBindings, ownerScopeId: string): Record<string, string> {
  return bindings.projectsByScope?.[ownerScopeId]
    ?? (ownerScopeId === PERSONAL_OWNER_SCOPE_ID ? bindings.projects : {})
}

function scopeProjectPaths(bindings: WorkspaceBindings, ownerScopeId: string): Record<string, string> {
  return bindings.projectPathsByScope?.[ownerScopeId]
    ?? (ownerScopeId === PERSONAL_OWNER_SCOPE_ID ? bindings.projectPaths : {})
}

function replaceScopeOrder(currentOrder: string[], scopeIds: Set<string>, nextScopeOrder: string[]): string[] {
  const remaining = currentOrder.filter(id => !scopeIds.has(id))
  const firstScopeIndex = currentOrder.findIndex(id => scopeIds.has(id))
  if (firstScopeIndex < 0)
    return [...remaining, ...nextScopeOrder]
  return [...remaining.slice(0, firstScopeIndex), ...nextScopeOrder, ...remaining.slice(firstScopeIndex)]
}

function assertWorkspaceId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
    throw new Error('Workspace id must contain lowercase letters, numbers, and hyphens')
}

function slug(value: string): string {
  return value.toLowerCase().trim().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '')
}

function revision(content: string): string {
  return createHash('sha256').update(content).digest('hex')
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

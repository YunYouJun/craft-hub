import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { PersonalGitSyncResolution } from './personal-git-sync'
import type { CommandInputValues, ProjectAccentColor, ProjectCatalogSnapshot, ProjectDescriptionChange, WorkspaceManifest } from './types'
import { Buffer } from 'node:buffer'
import { createReadStream } from 'node:fs'
import { access } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { ZodError } from 'zod'
import { CommandInputValidationError } from './command-inputs'
import { projectConfigSchemaRevision } from './config'
import { GitIntegrationConflictError, GitIntegrationValidationError } from './git-integration'
import { CraftHubRuntime } from './runtime'
import { SettingsConflictError, SettingsValidationError } from './settings'
import { TeamLifecycleValidationError } from './teams'
import { PERSONAL_OWNER_SCOPE_ID, projectAccentColors } from './types'
import { ProjectWatcher } from './watcher'
import { WorkspaceConflictError } from './workspaces'

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request)
    chunks.push(Buffer.from(chunk))
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {}
}

function commandInputValues(value: unknown): CommandInputValues {
  if (value === undefined)
    return {}
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CommandInputValidationError('inputs must be an object of strings')
  const entries = Object.entries(value)
  if (!entries.every(([, input]) => typeof input === 'string'))
    throw new CommandInputValidationError('inputs must be an object of strings')
  return Object.fromEntries(entries) as CommandInputValues
}

function projectDescriptionChanges(value: unknown): ProjectDescriptionChange[] {
  if (!Array.isArray(value))
    throw new TypeError('changes must be an array')
  return value.map((change) => {
    if (!change || typeof change !== 'object' || Array.isArray(change))
      throw new TypeError('Every description change must be an object')
    const record = change as Record<string, unknown>
    if (typeof record.id !== 'string' || (record.target !== 'command' && record.target !== 'package') || typeof record.key !== 'string')
      throw new TypeError('Every description change must include id, target, and key')
    if (!record.description || typeof record.description !== 'object' || Array.isArray(record.description))
      throw new TypeError('Every description change must include localized description text')
    const entries = Object.entries(record.description)
    if (!entries.length || !entries.every((entry): entry is [string, string] => typeof entry[1] === 'string'))
      throw new TypeError('Description locale values must be strings')
    return { id: record.id, target: record.target, key: record.key, description: Object.fromEntries(entries) }
  })
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

async function serveStatic(response: ServerResponse, staticDir: string, pathname: string): Promise<void> {
  const relativePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
  let path = join(staticDir, relativePath || 'index.html')
  try {
    await access(path)
  }
  catch {
    path = join(staticDir, 'index.html')
  }
  response.writeHead(200, {
    'content-security-policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:`,
    'content-type': contentTypes[extname(path)] ?? 'application/octet-stream',
  })
  createReadStream(path).pipe(response)
}

export interface CraftHubServerOptions {
  host?: string
  port?: number
  staticDir?: string
  runtime?: CraftHubRuntime
}

export interface CraftHubServer {
  runtime: CraftHubRuntime
  server: Server
  url: string
  close: () => Promise<void>
}

/** Start the local-only HTTP API used by the web and Electron clients. */
export async function startCraftHubServer(options: CraftHubServerOptions = {}): Promise<CraftHubServer> {
  const runtime = options.runtime ?? new CraftHubRuntime()
  const eventClients = new Set<ServerResponse>()
  const broadcastEvent = (name: string, event: unknown): void => {
    const message = `event: ${name}\ndata: ${JSON.stringify(event)}\n\n`
    for (const client of eventClients)
      client.write(message)
  }
  const watcher = new ProjectWatcher(event => broadcastEvent('project-change', event))
  const stopRunEvents = runtime.onRunsChanged(summary => broadcastEvent('run-change', summary))
  const stopAgentTaskEvents = runtime.agentTasks.onChanged(task => broadcastEvent('agent-task-change', task))
  const stopSettingsEvents = runtime.settings.onChanged(snapshot => broadcastEvent('settings-change', snapshot))
  const stopPluginEvents = runtime.pluginManager.onChanged(() => broadcastEvent('plugin-change', { changedAt: new Date().toISOString() }))
  const watchProjects = async (): Promise<ProjectCatalogSnapshot> => {
    const snapshot = await runtime.projects.snapshot()
    await Promise.allSettled(snapshot.projects.map(project => watcher.watch(project)))
    return snapshot
  }
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const parts = url.pathname.split('/').filter(Boolean)
      const requestedOwnerScopeId = url.searchParams.get('ownerScopeId') ?? PERSONAL_OWNER_SCOPE_ID
      const ownerScopeId = async (): Promise<string> => {
        await runtime.ownerScopes.get(requestedOwnerScopeId)
        return requestedOwnerScopeId
      }

      if (request.method === 'GET' && url.pathname === '/api/health') {
        return sendJson(response, 200, {
          distribution: {
            id: runtime.distribution.id,
            name: runtime.distribution.name,
          },
          projectConfigSchemaRevision,
          status: 'ok',
        })
      }

      if (request.method === 'GET' && url.pathname === '/api/events') {
        response.writeHead(200, {
          'cache-control': 'no-cache, no-transform',
          'connection': 'keep-alive',
          'content-type': 'text/event-stream; charset=utf-8',
          'x-accel-buffering': 'no',
        })
        response.write('retry: 1000\n\n')
        eventClients.add(response)
        request.once('close', () => eventClients.delete(response))
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/owner-scopes')
        return sendJson(response, 200, await runtime.ownerScopes.list())

      if (request.method === 'POST' && url.pathname === '/api/owner-scopes') {
        const body = await jsonBody(request)
        if (typeof body.name !== 'string' || !body.name.trim() || typeof body.repositoryPath !== 'string' || !body.repositoryPath.trim())
          return sendJson(response, 400, { error: 'name and repositoryPath are required' })
        if (body.directory !== undefined && typeof body.directory !== 'string')
          return sendJson(response, 400, { error: 'directory must be a string when provided' })
        return sendJson(response, 201, await runtime.teams.create({
          name: body.name,
          repositoryPath: body.repositoryPath,
          directory: body.directory as string | undefined,
        }))
      }

      if (parts[0] === 'api' && parts[1] === 'owner-scopes' && parts[2] && parts.length === 3) {
        const scopeId = parts[2]
        if (request.method === 'PATCH') {
          const body = await jsonBody(request)
          if (typeof body.name !== 'string' || !body.name.trim())
            return sendJson(response, 400, { error: 'name is required' })
          return sendJson(response, 200, await runtime.teams.rename(scopeId, body.name))
        }
        if (request.method === 'DELETE') {
          const body = await jsonBody(request)
          if (typeof body.confirmationName !== 'string')
            return sendJson(response, 400, { error: 'confirmationName is required' })
          return sendJson(response, 200, await runtime.teams.delete(scopeId, body.confirmationName))
        }
      }

      if (request.method === 'GET' && url.pathname === '/api/owner-scopes/state')
        return sendJson(response, 200, await runtime.ownerScopes.uiState())

      if (request.method === 'PUT' && url.pathname === '/api/owner-scopes/state') {
        const body = await jsonBody(request)
        if (typeof body.activeScopeId !== 'string')
          return sendJson(response, 400, { error: 'activeScopeId is required' })
        return sendJson(response, 200, await runtime.ownerScopes.activate(body.activeScopeId))
      }

      if (parts[0] === 'api' && parts[1] === 'owner-scopes' && parts[2] && parts[3] === 'git-sync') {
        const scopeId = parts[2]
        if (request.method === 'GET' && parts.length === 4)
          return sendJson(response, 200, await runtime.teamGitSync.status(scopeId))
        if (request.method === 'PUT' && parts.length === 4) {
          const body = await jsonBody(request)
          if (typeof body.repositoryPath !== 'string' || (body.directory !== undefined && typeof body.directory !== 'string'))
            return sendJson(response, 400, { error: 'repositoryPath is required and directory must be a string' })
          return sendJson(response, 200, await runtime.teamGitSync.configure(scopeId, { repositoryPath: body.repositoryPath, directory: body.directory as string | undefined }))
        }
        if (request.method === 'POST' && parts[4] === 'synchronize') {
          const body = await jsonBody(request)
          const resolution = body.resolution ?? 'auto'
          if (resolution !== 'auto' && resolution !== 'use-local' && resolution !== 'use-repository')
            return sendJson(response, 400, { error: 'resolution must be auto, use-local, or use-repository' })
          return sendJson(response, 200, await runtime.teamGitSync.synchronize(scopeId, resolution as PersonalGitSyncResolution))
        }
      }

      if (request.method === 'GET' && url.pathname === '/api/projects')
        return sendJson(response, 200, await watchProjects())

      if (request.method === 'GET' && url.pathname === '/api/projects/owner-scopes') {
        const teamIds = (await runtime.ownerScopes.list()).filter(scope => scope.kind === 'team').map(scope => scope.id)
        return sendJson(response, 200, await runtime.workspaces.projectOwnerScopes(teamIds))
      }

      if (request.method === 'GET' && url.pathname === '/api/workspaces')
        return sendJson(response, 200, await runtime.workspaces.list(await ownerScopeId()))

      if (request.method === 'GET' && url.pathname === '/api/workspace-groups')
        return sendJson(response, 200, await runtime.workspaces.groups(await ownerScopeId()))

      if (request.method === 'GET' && url.pathname === '/api/workspace-groups/project-assignments')
        return sendJson(response, 200, await runtime.workspaces.projectGroupAssignments(await ownerScopeId()))

      if (request.method === 'GET' && url.pathname === '/api/personal-git-sync')
        return sendJson(response, 200, await runtime.personalGitSync.status())

      if (request.method === 'PUT' && url.pathname === '/api/personal-git-sync') {
        const body = await jsonBody(request)
        if (typeof body.repositoryPath !== 'string' || (body.directory !== undefined && typeof body.directory !== 'string'))
          return sendJson(response, 400, { error: 'repositoryPath is required and directory must be a string' })
        return sendJson(response, 200, await runtime.personalGitSync.configure({
          repositoryPath: body.repositoryPath,
          directory: body.directory as string | undefined,
        }))
      }

      if (request.method === 'POST' && url.pathname === '/api/personal-git-sync/synchronize') {
        const body = await jsonBody(request)
        const resolution = body.resolution ?? 'auto'
        if (resolution !== 'auto' && resolution !== 'use-local' && resolution !== 'use-repository')
          return sendJson(response, 400, { error: 'resolution must be auto, use-local, or use-repository' })
        return sendJson(response, 200, await runtime.personalGitSync.synchronize(resolution as PersonalGitSyncResolution))
      }

      if (request.method === 'POST' && url.pathname === '/api/workspace-groups') {
        const body = await jsonBody(request)
        if (typeof body.name !== 'string' || !body.name.trim())
          return sendJson(response, 400, { error: 'name is required' })
        return sendJson(response, 201, await runtime.workspaces.createGroup(body.name, await ownerScopeId()))
      }

      if (request.method === 'POST' && url.pathname === '/api/workspaces/import/vscode/preview') {
        const body = await jsonBody(request)
        if (typeof body.sourceDirectory !== 'string' || !body.sourceDirectory.trim())
          return sendJson(response, 400, { error: 'sourceDirectory is required' })
        return sendJson(response, 200, await runtime.workspaceImports.previewVscodeDirectory(
          body.sourceDirectory,
          typeof body.groupName === 'string' ? body.groupName : undefined,
          await ownerScopeId(),
        ))
      }

      if (request.method === 'POST' && url.pathname === '/api/workspaces/import/vscode') {
        const body = await jsonBody(request)
        if (typeof body.sourceDirectory !== 'string' || !body.sourceDirectory.trim() || typeof body.expectedRevision !== 'string')
          return sendJson(response, 400, { error: 'sourceDirectory and expectedRevision are required' })
        return sendJson(response, 201, await runtime.workspaceImports.importVscodeDirectory(
          body.sourceDirectory,
          typeof body.groupName === 'string' ? body.groupName : undefined,
          body.expectedRevision,
          await ownerScopeId(),
        ))
      }

      if (request.method === 'POST' && url.pathname === '/api/workspaces/register-member') {
        const body = await jsonBody(request)
        if (typeof body.workspaceId !== 'string' || typeof body.project !== 'string')
          return sendJson(response, 400, { error: 'workspaceId and project are required' })
        return sendJson(response, 201, await runtime.workspaces.registerImportedProject(
          body.workspaceId,
          body.project,
          typeof body.path === 'string' ? body.path : undefined,
          await ownerScopeId(),
        ))
      }

      if (request.method === 'POST' && url.pathname === '/api/workspaces') {
        const body = await jsonBody(request)
        if (typeof body.name !== 'string' || !body.name.trim())
          return sendJson(response, 400, { error: 'name is required' })
        return sendJson(response, 201, await runtime.workspaces.create(body.name, await ownerScopeId()))
      }

      if (request.method === 'PUT' && url.pathname === '/api/workspaces/order') {
        const body = await jsonBody(request)
        if (!Array.isArray(body.workspaceOrder) || !body.workspaceOrder.every(id => typeof id === 'string'))
          return sendJson(response, 400, { error: 'workspaceOrder must be an array of strings' })
        return sendJson(response, 200, await runtime.workspaces.reorder(body.workspaceOrder, await ownerScopeId()))
      }

      if (request.method === 'GET' && url.pathname === '/api/workspaces/state')
        return sendJson(response, 200, await runtime.workspaces.uiState(await ownerScopeId()))

      if (request.method === 'PUT' && url.pathname === '/api/workspaces/state') {
        const body = await jsonBody(request)
        if (!Array.isArray(body.expandedWorkspaceIds) || !body.expandedWorkspaceIds.every(id => typeof id === 'string'))
          return sendJson(response, 400, { error: 'expandedWorkspaceIds must be an array of strings' })
        return sendJson(response, 200, await runtime.workspaces.updateUiState({
          expandedWorkspaceIds: body.expandedWorkspaceIds as string[],
          selectedWorkspaceId: typeof body.selectedWorkspaceId === 'string' ? body.selectedWorkspaceId : undefined,
          selectedProjectId: typeof body.selectedProjectId === 'string' ? body.selectedProjectId : undefined,
        }, await ownerScopeId()))
      }

      if (request.method === 'GET' && url.pathname === '/api/runs/summary')
        return sendJson(response, 200, runtime.projectRunSummaries())

      if (request.method === 'GET' && url.pathname === '/api/runs')
        return sendJson(response, 200, await runtime.runs())

      if (request.method === 'GET' && url.pathname === '/api/agent-tasks')
        return sendJson(response, 200, await runtime.agentTasks.list())

      if (request.method === 'POST' && url.pathname === '/api/agent-tasks') {
        const body = await jsonBody(request)
        if (typeof body.prompt !== 'string' || typeof body.primaryProjectId !== 'string'
          || !Array.isArray(body.projectIds) || !body.projectIds.every(id => typeof id === 'string')) {
          return sendJson(response, 400, { error: 'prompt, primaryProjectId, and projectIds are required' })
        }
        return sendJson(response, 202, await runtime.agentTasks.start({
          prompt: body.prompt,
          projectIds: body.projectIds as string[],
          primaryProjectId: body.primaryProjectId,
          capabilityId: typeof body.capabilityId === 'string' ? body.capabilityId : undefined,
          workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : undefined,
          parentTaskId: typeof body.parentTaskId === 'string' ? body.parentTaskId : undefined,
        }))
      }

      if (request.method === 'POST' && url.pathname === '/api/runs/cleanup') {
        const body = await jsonBody(request)
        const projectIds = Array.isArray(body.projectIds) && body.projectIds.every(id => typeof id === 'string')
          ? body.projectIds as string[]
          : undefined
        return sendJson(response, 200, await runtime.cleanupRuns({
          projectIds,
          includeAllUnpinned: body.includeAllUnpinned === true,
          olderThan: typeof body.olderThan === 'string' ? body.olderThan : undefined,
          maxBytes: typeof body.maxBytes === 'number' ? body.maxBytes : undefined,
          preview: body.preview === true,
        }))
      }

      if (request.method === 'GET' && url.pathname === '/api/settings')
        return sendJson(response, 200, await runtime.settings.get())

      if (request.method === 'GET' && url.pathname === '/api/settings/schema')
        return sendJson(response, 200, runtime.settings.schema())

      if (request.method === 'GET' && url.pathname === '/api/marketplace/catalog')
        return sendJson(response, 200, await runtime.pluginManager.catalog())

      if (request.method === 'GET' && url.pathname === '/api/marketplace/sources')
        return sendJson(response, 200, await runtime.pluginManager.listSources())

      if (request.method === 'POST' && url.pathname === '/api/marketplace/sources/preview') {
        const body = await jsonBody(request)
        if (typeof body.catalogUrl !== 'string')
          return sendJson(response, 400, { error: 'catalogUrl is required' })
        return sendJson(response, 200, await runtime.pluginManager.previewSource({
          name: typeof body.name === 'string' ? body.name : undefined,
          catalogUrl: body.catalogUrl,
          registry: typeof body.registry === 'string' ? body.registry : undefined,
        }))
      }

      if (request.method === 'POST' && url.pathname === '/api/marketplace/sources') {
        const body = await jsonBody(request)
        if (typeof body.name !== 'string' || typeof body.catalogUrl !== 'string')
          return sendJson(response, 400, { error: 'name and catalogUrl are required' })
        return sendJson(response, 201, await runtime.pluginManager.addSource({
          name: body.name,
          catalogUrl: body.catalogUrl,
          registry: typeof body.registry === 'string' ? body.registry : undefined,
        }))
      }

      if (request.method === 'GET' && url.pathname === '/api/plugins')
        return sendJson(response, 200, await runtime.pluginManager.listInstalled())

      if (request.method === 'GET' && url.pathname === '/api/plugins/document') {
        const sourceId = url.searchParams.get('sourceId')
        const packageName = url.searchParams.get('package')
        if (!sourceId || !packageName)
          return sendJson(response, 400, { error: 'sourceId and package are required' })
        return sendJson(response, 200, await runtime.pluginManager.pluginDocument({
          sourceId,
          package: packageName,
          version: url.searchParams.get('version') ?? undefined,
          path: url.searchParams.get('path') ?? undefined,
        }))
      }

      if (request.method === 'GET' && url.pathname === '/api/plugins/document-asset') {
        const sourceId = url.searchParams.get('sourceId')
        const packageName = url.searchParams.get('package')
        const path = url.searchParams.get('path')
        if (!sourceId || !packageName || !path)
          return sendJson(response, 400, { error: 'sourceId, package, and path are required' })
        const asset = await runtime.pluginManager.pluginDocumentAsset({
          sourceId,
          package: packageName,
          version: url.searchParams.get('version') ?? undefined,
          path,
        })
        if (!asset)
          return sendJson(response, 404, { error: 'Asset not found' })
        response.writeHead(200, {
          'cache-control': 'private, max-age=3600',
          'content-length': asset.content.byteLength,
          'content-type': asset.contentType,
          'x-content-type-options': 'nosniff',
        })
        response.end(asset.content)
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/plugins/local') {
        const body = await jsonBody(request)
        if (typeof body.path !== 'string' || !body.path.trim())
          return sendJson(response, 400, { error: 'path is required' })
        return sendJson(response, 201, await runtime.pluginManager.linkLocal(body.path))
      }

      if (request.method === 'GET' && url.pathname === '/api/plugins/updates')
        return sendJson(response, 200, await runtime.pluginManager.planUpdates())

      if (request.method === 'POST' && url.pathname === '/api/plugins/updates')
        return sendJson(response, 200, await runtime.pluginManager.updateAll({ refreshSources: true }))

      if (request.method === 'POST' && url.pathname === '/api/plugins/install/preview') {
        const body = await jsonBody(request)
        if (typeof body.sourceId !== 'string' || typeof body.package !== 'string')
          return sendJson(response, 400, { error: 'sourceId and package are required' })
        return sendJson(response, 200, await runtime.pluginManager.planInstall({
          sourceId: body.sourceId,
          package: body.package,
          version: typeof body.version === 'string' ? body.version : undefined,
        }))
      }

      if (request.method === 'POST' && url.pathname === '/api/plugins/install') {
        const body = await jsonBody(request)
        if (typeof body.sourceId !== 'string' || typeof body.package !== 'string')
          return sendJson(response, 400, { error: 'sourceId and package are required' })
        return sendJson(response, 201, await runtime.pluginManager.install({
          sourceId: body.sourceId,
          package: body.package,
          version: typeof body.version === 'string' ? body.version : undefined,
        }))
      }

      if (request.method === 'PATCH' && url.pathname === '/api/settings') {
        const body = await jsonBody(request)
        if (typeof body.revision !== 'string' || !body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings))
          return sendJson(response, 400, { error: 'revision and settings are required' })
        return sendJson(response, 200, await runtime.settings.update(body.settings as Record<string, unknown>, body.revision))
      }

      if (request.method === 'POST' && url.pathname === '/api/settings/export') {
        const body = await jsonBody(request)
        if (body.mode !== 'minimal' && body.mode !== 'full')
          return sendJson(response, 400, { error: 'mode must be minimal or full' })
        return sendJson(response, 200, await runtime.settings.export(body.mode))
      }

      if (request.method === 'POST' && url.pathname === '/api/settings/import/preview') {
        const body = await jsonBody(request)
        if ((body.strategy !== 'merge' && body.strategy !== 'replace') || !body.document)
          return sendJson(response, 400, { error: 'document and strategy are required' })
        return sendJson(response, 200, await runtime.settings.previewImport(body.document, body.strategy))
      }

      if (request.method === 'POST' && url.pathname === '/api/settings/import') {
        const body = await jsonBody(request)
        if ((body.strategy !== 'merge' && body.strategy !== 'replace') || !body.document || typeof body.revision !== 'string')
          return sendJson(response, 400, { error: 'document, strategy, and revision are required' })
        return sendJson(response, 200, await runtime.settings.import(body.document, body.strategy, body.revision))
      }

      if (request.method === 'POST' && url.pathname === '/api/projects') {
        const body = await jsonBody(request)
        if (typeof body.path !== 'string')
          return sendJson(response, 400, { error: 'path is required' })
        const project = await runtime.addProject(body.path)
        await watcher.watch(project)
        return sendJson(response, 201, project)
      }

      if (request.method === 'PUT' && url.pathname === '/api/projects/order') {
        const body = await jsonBody(request)
        if (!Array.isArray(body.projectOrder) || !body.projectOrder.every(id => typeof id === 'string'))
          return sendJson(response, 400, { error: 'projectOrder must be an array of strings' })
        return sendJson(response, 200, await runtime.projects.reorder(body.projectOrder as string[]))
      }

      if (parts[0] === 'api' && parts[1] === 'runs' && parts[2]) {
        const runId = parts[2]
        if (request.method === 'DELETE' && parts.length === 3)
          return sendJson(response, 200, await runtime.cancelRun(runId))
        if (request.method === 'POST' && parts[3] === 'input') {
          const body = await jsonBody(request)
          if (typeof body.data !== 'string')
            return sendJson(response, 400, { error: 'data is required' })
          runtime.writeRun(runId, body.data)
          return sendJson(response, 202, { accepted: true })
        }
        if (request.method === 'POST' && parts[3] === 'resize') {
          const body = await jsonBody(request)
          if (typeof body.columns !== 'number' || typeof body.rows !== 'number')
            return sendJson(response, 400, { error: 'columns and rows are required' })
          runtime.resizeRun(runId, body.columns, body.rows)
          return sendJson(response, 202, { accepted: true })
        }
        if (request.method === 'PUT' && parts[3] === 'pin') {
          const body = await jsonBody(request)
          if (typeof body.pinned !== 'boolean')
            return sendJson(response, 400, { error: 'pinned is required' })
          return sendJson(response, 200, await runtime.pinRun(runId, body.pinned))
        }
      }

      if (parts[0] === 'api' && parts[1] === 'agent-tasks' && parts[2] && request.method === 'DELETE')
        return sendJson(response, 200, await runtime.agentTasks.cancel(parts[2]))

      if (parts[0] === 'api' && parts[1] === 'marketplace' && parts[2] === 'sources' && parts[3]) {
        const sourceId = decodeURIComponent(parts[3])
        if (request.method === 'POST' && parts[4] === 'refresh')
          return sendJson(response, 200, await runtime.pluginManager.refreshSource(sourceId))
        if (request.method === 'DELETE' && parts.length === 4) {
          await runtime.pluginManager.removeSource(sourceId)
          return sendJson(response, 200, { deleted: true })
        }
      }

      if (parts[0] === 'api' && parts[1] === 'plugins' && parts[2] === 'local' && parts[3]) {
        const packageName = decodeURIComponent(parts[3])
        if (request.method === 'POST' && parts[4] === 'refresh')
          return sendJson(response, 200, await runtime.pluginManager.refreshLocal(packageName))
        if (request.method === 'DELETE' && parts.length === 4) {
          await runtime.pluginManager.unlinkLocal(packageName)
          return sendJson(response, 200, { unlinked: true })
        }
      }

      if (parts[0] === 'api' && parts[1] === 'plugins' && parts[2] && parts[2] !== 'install' && parts[2] !== 'updates' && parts[2] !== 'local') {
        const packageName = decodeURIComponent(parts[2])
        if (request.method === 'PUT' && parts[3] === 'enabled') {
          const body = await jsonBody(request)
          if (typeof body.enabled !== 'boolean')
            return sendJson(response, 400, { error: 'enabled is required' })
          return sendJson(response, 200, await runtime.pluginManager.setEnabled(packageName, body.enabled))
        }
        if (request.method === 'POST' && parts[3] === 'rollback')
          return sendJson(response, 200, await runtime.pluginManager.rollback(packageName))
        if (request.method === 'DELETE' && parts.length === 3) {
          const body = await jsonBody(request)
          await runtime.pluginManager.remove(packageName, body.deleteData === true)
          return sendJson(response, 200, { deleted: true })
        }
      }

      if (parts[0] === 'api' && parts[1] === 'workspaces' && parts[2]) {
        const workspaceId = parts[2]
        const scopeId = await ownerScopeId()
        if (request.method === 'GET' && parts.length === 3)
          return sendJson(response, 200, await runtime.workspaces.get(workspaceId, scopeId))
        if (request.method === 'PUT' && parts.length === 3) {
          const body = await jsonBody(request)
          if (!body.manifest || typeof body.manifest !== 'object' || Array.isArray(body.manifest))
            return sendJson(response, 400, { error: 'manifest is required' })
          const manifest = body.manifest as WorkspaceManifest
          if (manifest.ownerScopeId && manifest.ownerScopeId !== scopeId)
            return sendJson(response, 400, { error: 'manifest ownerScopeId must match the requested owner scope' })
          return sendJson(response, 200, await runtime.workspaces.save({
            manifest: { ...manifest, ownerScopeId: scopeId === PERSONAL_OWNER_SCOPE_ID ? undefined : scopeId },
            revision: typeof body.revision === 'string' ? body.revision : undefined,
          }))
        }
        if (request.method === 'DELETE' && parts.length === 3) {
          const body = await jsonBody(request)
          if (typeof body.revision !== 'string')
            return sendJson(response, 400, { error: 'revision is required' })
          await runtime.workspaces.delete(workspaceId, body.revision, scopeId)
          return sendJson(response, 200, { deleted: true })
        }
        if (request.method === 'POST' && parts[3] === 'bindings') {
          const body = await jsonBody(request)
          if (typeof body.project !== 'string' || typeof body.projectId !== 'string')
            return sendJson(response, 400, { error: 'project and projectId are required' })
          await runtime.workspaces.get(workspaceId, scopeId)
          await runtime.workspaces.bind(body.project, body.projectId, scopeId)
          return sendJson(response, 200, await runtime.workspaces.get(workspaceId, scopeId))
        }
        if (request.method === 'POST' && parts[3] === 'members') {
          const body = await jsonBody(request)
          if (typeof body.projectId !== 'string')
            return sendJson(response, 400, { error: 'projectId is required' })
          return sendJson(response, 200, await runtime.workspaces.addProject(workspaceId, body.projectId, scopeId))
        }
        if (request.method === 'DELETE' && parts[3] === 'members' && parts[4])
          return sendJson(response, 200, await runtime.workspaces.removeProject(workspaceId, parts[4], scopeId))
        if (request.method === 'PUT' && parts[3] === 'group') {
          const body = await jsonBody(request)
          if (body.groupId !== undefined && typeof body.groupId !== 'string')
            return sendJson(response, 400, { error: 'groupId must be a string when provided' })
          return sendJson(response, 200, await runtime.workspaces.assignGroup(workspaceId, body.groupId || undefined, scopeId))
        }
      }

      if (parts[0] === 'api' && parts[1] === 'workspace-groups' && parts[2]) {
        const groupId = parts[2]
        const scopeId = await ownerScopeId()
        if (request.method === 'PATCH' && parts.length === 3) {
          const body = await jsonBody(request)
          const icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim() : undefined
          return sendJson(response, 200, await runtime.workspaces.setGroupIcon(groupId, icon, scopeId))
        }
        if (request.method === 'PUT' && parts.length === 3) {
          const body = await jsonBody(request)
          if (typeof body.name !== 'string' || !body.name.trim())
            return sendJson(response, 400, { error: 'name is required' })
          return sendJson(response, 200, await runtime.workspaces.renameGroup(groupId, body.name, scopeId))
        }
        if (request.method === 'DELETE' && parts.length === 3) {
          await runtime.workspaces.deleteGroup(groupId, scopeId)
          return sendJson(response, 200, { deleted: true })
        }
      }

      if (parts[0] === 'api' && parts[1] === 'projects' && parts[2]) {
        const projectId = parts[2]
        if (request.method === 'PUT' && parts[3] === 'group') {
          const body = await jsonBody(request)
          if (body.groupId !== undefined && typeof body.groupId !== 'string')
            return sendJson(response, 400, { error: 'groupId must be a string when provided' })
          return sendJson(response, 200, await runtime.workspaces.assignProjectGroup(projectId, body.groupId || undefined, await ownerScopeId()))
        }
        if (request.method === 'PATCH' && parts.length === 3) {
          const body = await jsonBody(request)
          const icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim() : undefined
          const color = typeof body.color === 'string' && projectAccentColors.includes(body.color as ProjectAccentColor)
            ? body.color as ProjectAccentColor
            : undefined
          return sendJson(response, 200, await runtime.projects.setVisual(projectId, { icon, color }))
        }
        if (request.method === 'DELETE' && parts.length === 3) {
          const project = await runtime.unregisterProject(projectId)
          await watcher.unwatch(projectId)
          return sendJson(response, 200, project)
        }
        if (request.method === 'GET' && parts[3] === 'capabilities')
          return sendJson(response, 200, await runtime.capabilities(projectId))
        if (request.method === 'GET' && parts[3] === 'capability-discovery')
          return sendJson(response, 200, await runtime.capabilityDiscovery(projectId))
        if (request.method === 'GET' && parts[3] === 'overview') {
          const packagePath = url.searchParams.get('package') ?? '.'
          const locale = url.searchParams.get('locale')
          if (locale !== null && locale !== 'en' && locale !== 'zh-CN')
            return sendJson(response, 400, { error: 'locale must be en or zh-CN' })
          return sendJson(response, 200, await runtime.projectOverview(projectId, packagePath, locale ?? undefined))
        }
        if (request.method === 'GET' && parts[3] === 'overview-asset') {
          const path = url.searchParams.get('path')
          if (!path)
            return sendJson(response, 400, { error: 'path is required' })
          const asset = await runtime.projectOverviewAsset(projectId, path)
          if (!asset)
            return sendJson(response, 404, { error: 'Asset not found' })
          response.writeHead(200, {
            'cache-control': 'private, max-age=60',
            'content-length': asset.content.byteLength,
            'content-type': asset.contentType,
            'x-content-type-options': 'nosniff',
          })
          response.end(asset.content)
          return
        }
        if (request.method === 'POST' && parts[3] === 'git-integration' && parts[4] === 'plan') {
          const body = await jsonBody(request)
          if (body.targetBranch !== undefined && typeof body.targetBranch !== 'string')
            return sendJson(response, 400, { error: 'targetBranch must be a string when provided' })
          if (body.deleteSourceBranch !== undefined && typeof body.deleteSourceBranch !== 'boolean')
            return sendJson(response, 400, { error: 'deleteSourceBranch must be a boolean when provided' })
          return sendJson(response, 200, await runtime.planGitIntegration(projectId, {
            targetBranch: body.targetBranch as string | undefined,
            deleteSourceBranch: body.deleteSourceBranch as boolean | undefined,
          }))
        }
        if (request.method === 'POST' && parts[3] === 'git-integration' && parts[4] === 'apply') {
          const body = await jsonBody(request)
          if (typeof body.expectedRevision !== 'string')
            return sendJson(response, 400, { error: 'expectedRevision is required' })
          if (body.targetBranch !== undefined && typeof body.targetBranch !== 'string')
            return sendJson(response, 400, { error: 'targetBranch must be a string when provided' })
          if (body.deleteSourceBranch !== undefined && typeof body.deleteSourceBranch !== 'boolean')
            return sendJson(response, 400, { error: 'deleteSourceBranch must be a boolean when provided' })
          if ((await runtime.projects.get(projectId)).trust !== 'trusted')
            return sendJson(response, 403, { error: 'Project must be trusted before integrating Git branches' })
          return sendJson(response, 200, await runtime.applyGitIntegration(projectId, {
            expectedRevision: body.expectedRevision,
            targetBranch: body.targetBranch as string | undefined,
            deleteSourceBranch: body.deleteSourceBranch as boolean | undefined,
          }))
        }
        if (request.method === 'POST' && parts[3] === 'release-plan' && parts[4]) {
          const body = await jsonBody(request)
          return sendJson(response, 200, await runtime.releasePlan(projectId, decodeURIComponent(parts[4]), commandInputValues(body.inputs)))
        }
        if (parts[3] === 'agent-actions') {
          const locale = url.searchParams.get('locale') ?? (await runtime.settings.get()).settings['workbench.locale']
          if (locale !== 'en' && locale !== 'zh-CN')
            return sendJson(response, 400, { error: 'locale must be en or zh-CN' })
          if (request.method === 'GET' && parts.length === 4)
            return sendJson(response, 200, await runtime.agentActions.list(projectId, locale))
          if (request.method === 'GET' && parts[4] === 'improve-project-config' && parts[5] === 'audit')
            return sendJson(response, 200, await runtime.agentActions.audit(projectId, locale))
          if (request.method === 'POST' && parts[4] === 'improve-project-config' && parts[5] === 'apply') {
            const body = await jsonBody(request)
            if (typeof body.taskId !== 'string')
              return sendJson(response, 400, { error: 'taskId is required' })
            return sendJson(response, 200, await runtime.agentActions.apply(projectId, body.taskId, projectDescriptionChanges(body.changes)))
          }
          if (request.method === 'POST' && parts[4] === 'improve-project-config' && parts.length === 5)
            return sendJson(response, 202, await runtime.agentActions.start(projectId, 'improve-project-config', locale))
        }
        if (request.method === 'GET' && parts[3] === 'pins')
          return sendJson(response, 200, await runtime.capabilityPins(projectId))
        if (request.method === 'PUT' && parts[3] === 'pins') {
          const body = await jsonBody(request)
          if (!Array.isArray(body.capabilityIds) || !body.capabilityIds.every(id => typeof id === 'string'))
            return sendJson(response, 400, { error: 'capabilityIds must be an array of strings' })
          return sendJson(response, 200, await runtime.updateCapabilityPins(projectId, body.capabilityIds))
        }
        if (request.method === 'GET' && parts[3] === 'icon') {
          const path = await runtime.projects.iconPath(projectId)
          if (!path)
            return sendJson(response, 404, { error: 'Project does not have a file icon' })
          response.writeHead(200, {
            'cache-control': 'no-cache',
            'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'`,
            'content-type': contentTypes[extname(path)] ?? 'application/octet-stream',
            'x-content-type-options': 'nosniff',
          })
          createReadStream(path).pipe(response)
          return
        }
        if (request.method === 'POST' && parts[3] === 'trust')
          return sendJson(response, 200, await runtime.projects.setTrust(projectId, 'trusted'))
        if (request.method === 'POST' && parts[3] === 'config' && parts[4] === 'initialize') {
          const body = await jsonBody(request)
          if (body.mode !== 'preview' && body.mode !== 'apply')
            return sendJson(response, 400, { error: 'mode must be preview or apply' })
          if (body.mode === 'apply' && typeof body.expectedRevision !== 'string')
            return sendJson(response, 400, { error: 'expectedRevision is required when applying' })
          if (body.mode === 'apply' && (await runtime.projects.get(projectId)).trust !== 'trusted')
            return sendJson(response, 403, { error: 'Project must be trusted before creating project configuration' })
          const expectedRevision = typeof body.expectedRevision === 'string' ? body.expectedRevision : undefined
          return sendJson(response, 200, await runtime.initializeProjectConfig(projectId, body.mode, expectedRevision))
        }
        if (request.method === 'POST' && parts[3] === 'preview-command') {
          const body = await jsonBody(request)
          if (typeof body.capabilityId !== 'string')
            return sendJson(response, 400, { error: 'capabilityId is required' })
          return sendJson(response, 200, await runtime.previewCommand(projectId, body.capabilityId, commandInputValues(body.inputs)))
        }
        if (request.method === 'POST' && parts[3] === 'run') {
          const body = await jsonBody(request)
          if (typeof body.capabilityId !== 'string')
            return sendJson(response, 400, { error: 'capabilityId is required' })
          const pendingOutput: string[] = []
          let streaming = false
          const handle = await runtime.run(projectId, body.capabilityId, (event) => {
            const line = `${JSON.stringify({ type: 'output', ...event })}\n`
            if (streaming)
              response.write(line)
            else
              pendingOutput.push(line)
          }, commandInputValues(body.inputs))
          response.writeHead(200, {
            'cache-control': 'no-cache, no-transform',
            'content-type': 'application/x-ndjson; charset=utf-8',
            'x-accel-buffering': 'no',
          })
          response.write(`${JSON.stringify({ type: 'start', run: handle.run })}\n`)
          streaming = true
          for (const line of pendingOutput)
            response.write(line)
          const run = await handle.completion
          response.end(`${JSON.stringify({ type: 'complete', run })}\n`)
          return
        }
      }

      if (options.staticDir)
        return serveStatic(response, options.staticDir, url.pathname)
      sendJson(response, 404, { error: 'Not found' })
    }
    catch (error) {
      if (error instanceof SettingsConflictError)
        return sendJson(response, 409, { error: error.message, actualRevision: error.actualRevision })
      if (error instanceof WorkspaceConflictError)
        return sendJson(response, 409, { error: error.message, actualRevision: error.actualRevision })
      if (error instanceof GitIntegrationConflictError)
        return sendJson(response, 409, { error: error.message, actualRevision: error.actualRevision })
      if (error instanceof CommandInputValidationError || error instanceof GitIntegrationValidationError || error instanceof SettingsValidationError || error instanceof TeamLifecycleValidationError || error instanceof ZodError || error instanceof SyntaxError)
        return sendJson(response, 400, { error: error.message })
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  let closing: Promise<void> | undefined
  const close = (): Promise<void> => {
    closing ??= (async () => {
      if (heartbeat)
        clearInterval(heartbeat)
      stopRunEvents()
      stopAgentTaskEvents()
      stopSettingsEvents()
      stopPluginEvents()
      for (const client of eventClients)
        client.end()
      eventClients.clear()

      const cleanup = [
        runtime.close(),
        watcher.close(),
        runtime.settings.close(),
      ]
      if (server.listening) {
        cleanup.push(new Promise<void>((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve())
        }))
      }
      const results = await Promise.allSettled(cleanup)
      const errors = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => result.reason)
      if (errors.length)
        throw new AggregateError(errors, 'Failed to close Craft Hub server resources')
    })()
    return closing
  }

  try {
    await watchProjects()
    await runtime.settings.startWatching()
    heartbeat = setInterval(() => {
      for (const client of eventClients)
        client.write(': keep-alive\n\n')
    }, 15_000)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(options.port ?? 4318, options.host ?? '127.0.0.1', resolve)
    })
    void runtime.pluginManager.updateAll({ refreshSources: true })
      .then(result => broadcastEvent('plugin-update', result))
      .catch(error => broadcastEvent('plugin-update', { error: error instanceof Error ? error.message : String(error) }))
  }
  catch (error) {
    try {
      await close()
    }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Craft Hub server failed to start and clean up')
    }
    throw error
  }
  const address = server.address() as AddressInfo
  return {
    runtime,
    server,
    url: `http://${address.address}:${address.port}`,
    close,
  }
}

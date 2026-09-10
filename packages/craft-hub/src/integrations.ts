import type { ResourcePage, ResourcePageAdapter } from './resource-pages'
import { satisfies, validRange } from 'semver'
import { z } from 'zod'

export const integrationEffectSchema = z.enum(['local-read', 'local-write', 'remote-read', 'remote-write'])
export const integrationConfirmationSchema = z.enum(['never', 'risk-based', 'always'])
export const integrationOperationSchema = z.enum([
  'resources.read',
  'resources.update',
  'resources.execute',
  'connection.status',
  'connection.update',
  'configuration.list',
  'configuration.update',
  'work-items.get',
  'work-items.search',
  'work-items.list',
  'work-items.transitions',
  'work-items.update-status',
  'workspaces.get',
  'repositories.search',
  'merge-requests.list',
  'merge-requests.create',
  'merge-requests.add-reviewer',
  'issues.list',
  'ci.status',
])

const integrationIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/)
const remoteWriteOperations = new Set<IntegrationOperation>([
  'resources.execute',
  'merge-requests.add-reviewer',
  'merge-requests.create',
  'work-items.update-status',
])
const integrationViewBlockSchema = z.object({
  id: integrationIdSchema,
  type: z.enum(['connection-status', 'entity-search', 'entity-list', 'action-form', 'resource-browser']),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  actionId: integrationIdSchema,
  collapsible: z.boolean().optional(),
  requiresProject: z.boolean().optional(),
  statusFilter: z.enum(['active', 'all']).optional(),
  assigneeFilter: z.enum(['current-user', 'all']).optional(),
  fields: z.array(z.object({
    id: z.string().regex(/^[a-z]\w*$/i).refine(value => !['constructor', 'prototype', '__proto__'].includes(value), 'Invalid field id'),
    label: z.string().min(1),
    type: z.enum(['text', 'textarea', 'number', 'string-list', 'select', 'checkbox']).default('text'),
    required: z.boolean().optional(),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    suggestions: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    placeholder: z.string().optional(),
  })).optional(),
  previewInput: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  input: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
})

export const integrationContributionSchema = z.object({
  id: integrationIdSchema,
  translations: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  provider: z.object({
    id: integrationIdSchema,
    requires: z.string().refine(value => validRange(value) !== null, 'Provider requirement must be a valid SemVer range'),
  }),
  actions: z.array(z.object({
    id: integrationIdSchema,
    title: z.string().min(1),
    description: z.string().min(1).optional(),
    operation: integrationOperationSchema,
    effect: integrationEffectSchema,
    confirmation: integrationConfirmationSchema.default('risk-based'),
  })).default([]),
  views: z.array(z.object({
    id: integrationIdSchema,
    title: z.string().min(1),
    icon: z.string().min(1),
    placement: z.literal('primary-sidebar'),
    showInSidebar: z.boolean().optional(),
    order: z.number().int().optional(),
    scope: z.enum(['global', 'project', 'global-and-project']),
    blocks: z.array(integrationViewBlockSchema).default([]),
  })).default([]),
}).superRefine((integration, context) => {
  const actionIds = new Set<string>()
  for (const [index, action] of integration.actions.entries()) {
    if (actionIds.has(action.id))
      context.addIssue({ code: 'custom', message: `Duplicate integration action id: ${action.id}`, path: ['actions', index, 'id'] })
    if (remoteWriteOperations.has(action.operation) && action.effect !== 'remote-write')
      context.addIssue({ code: 'custom', message: `${action.operation} must declare the remote-write effect`, path: ['actions', index, 'effect'] })
    if (action.effect === 'local-read' && action.operation !== 'configuration.list')
      context.addIssue({ code: 'custom', message: 'Local read is reserved for configuration.list', path: ['actions', index, 'effect'] })
    if (action.operation === 'configuration.list' && action.effect !== 'local-read')
      context.addIssue({ code: 'custom', message: 'configuration.list must declare local-read', path: ['actions', index, 'effect'] })
    if (['configuration.update', 'connection.update', 'resources.update'].includes(action.operation) !== (action.effect === 'local-write'))
      context.addIssue({ code: 'custom', message: 'Configuration and connection updates must declare local-write', path: ['actions', index, 'effect'] })
    actionIds.add(action.id)
  }
  const viewIds = new Set<string>()
  for (const [viewIndex, view] of integration.views.entries()) {
    if (viewIds.has(view.id))
      context.addIssue({ code: 'custom', message: `Duplicate integration view id: ${view.id}`, path: ['views', viewIndex, 'id'] })
    viewIds.add(view.id)
    for (const [blockIndex, block] of view.blocks.entries()) {
      if (block.statusFilter && !['entity-list', 'entity-search'].includes(block.type))
        context.addIssue({ code: 'custom', message: 'Status filters require an entity list or search', path: ['views', viewIndex, 'blocks', blockIndex] })
      if (block.assigneeFilter && !['entity-list', 'entity-search'].includes(block.type))
        context.addIssue({ code: 'custom', message: 'Assignee filters require an entity list or search', path: ['views', viewIndex, 'blocks', blockIndex] })
      if ((block.collapsible || block.requiresProject) && block.type !== 'action-form')
        context.addIssue({ code: 'custom', message: 'Form presentation options require an action form', path: ['views', viewIndex, 'blocks', blockIndex] })
      if (block.type === 'action-form' && !block.fields?.length)
        context.addIssue({ code: 'custom', message: 'Action forms require fields', path: ['views', viewIndex, 'blocks', blockIndex, 'fields'] })
      if (block.type !== 'action-form' && integration.actions.find(action => action.id === block.actionId)?.effect.endsWith('write'))
        context.addIssue({ code: 'custom', message: 'Writes require an explicit action form', path: ['views', viewIndex, 'blocks', blockIndex, 'actionId'] })
      if (block.previewInput && integration.actions.find(action => action.id === block.actionId)?.effect !== 'local-read')
        context.addIssue({ code: 'custom', message: 'Preview inputs require a local-read action', path: ['views', viewIndex, 'blocks', blockIndex, 'previewInput'] })
      if (!actionIds.has(block.actionId))
        context.addIssue({ code: 'custom', message: `Unknown integration action: ${block.actionId}`, path: ['views', viewIndex, 'blocks', blockIndex, 'actionId'] })
    }
  }
})

export type IntegrationEffect = z.infer<typeof integrationEffectSchema>
export type IntegrationConfirmation = z.infer<typeof integrationConfirmationSchema>
export type IntegrationOperation = z.infer<typeof integrationOperationSchema>
export type IntegrationContribution = z.infer<typeof integrationContributionSchema>

export interface IntegrationProviderContext {
  /** Host-derived project catalog for cross-project reads and execution scope checks. */
  projects?: Array<{ id: string, name: string, path: string, trust: 'trusted' | 'untrusted' }>
  /** Whether the host reviewed and confirmed the current action invocation. */
  confirmed?: boolean
  /** Host-derived OAuth callback URL, never accepted from action input. */
  callbackUrl?: string
  locale?: 'en' | 'zh-CN'
  projectId?: string
  projectPath?: string
}

/** Display-safe setup form; credentials are submitted once and never returned. */
export interface IntegrationConnectionForm {
  id: string
  title: string
  description?: string
  submitLabel: string
  fields: Array<{ id: string, label: string, type: 'text' | 'password', required?: boolean, value?: string, placeholder?: string }>
}

export interface IntegrationConnectionStatus {
  connected: boolean
  accountLabel?: string
  message?: string
  forms?: IntegrationConnectionForm[]
  links?: Array<{ title: string, url: string }>
  authorizationUrl?: string
}

export interface IntegrationEntity {
  configurationToggle?: { enabled: boolean, inherited: boolean, revision: string, scope: 'global' | 'project' }
  id: string
  /** Provider availability hint for this entity and request context; writes still require server authorization. */
  statusUpdateAvailable?: boolean
  title: string
  url?: string
  status?: string
  /** Archived entities are excluded from unfinished work regardless of workflow status. */
  archived?: boolean
  /** Display copy and semantic state; status remains the provider's native value for writes. */
  statusLabel?: string
  statusCategory?: 'open' | 'planning' | 'active' | 'testing' | 'review' | 'releasing' | 'resolved' | 'done' | 'closed' | 'cancelled' | 'unknown'
  /** Exact provider account identifiers; multi-assignee items include every current handler. */
  assignees?: Array<{ id: string, label?: string, url?: string, urlLabel?: string }>
  /** Provider-normalized presentation; native priority values remain in metadata. */
  priority?: { label: string, tone?: 'danger' | 'warning' | 'success' | 'info' | 'neutral' }
  description?: string
  metadata?: Record<string, string | number | boolean | null>
  /** Root-to-parent context, independent of this item's status and the current result filters. */
  ancestors?: Array<Pick<IntegrationEntity, 'id' | 'title' | 'url' | 'status' | 'statusLabel' | 'statusCategory' | 'archived' | 'metadata'>>
  /** Display-safe fields supplied by the provider, never raw configuration. */
  details?: Array<{ label: string, value: string, sourcePath?: string }>
}

export interface IntegrationEntityQuery {
  keyword?: string
  limit?: number
  cursor?: string
  /** Declarative provider-specific filters forwarded as inert data. */
  [key: string]: unknown
}

export interface IntegrationEntityPage {
  items: IntegrationEntity[]
  /** Identity of the account authorized with this provider, never inferred from the host user. */
  currentUser?: { id: string, label?: string }
  nextCursor?: string
}

export interface WorkItemIntegrationAdapter {
  get?: (context: IntegrationProviderContext, input: Record<string, unknown>) => Promise<IntegrationEntity>
  search: (context: IntegrationProviderContext, query: IntegrationEntityQuery) => Promise<IntegrationEntityPage>
  list: (context: IntegrationProviderContext, query: IntegrationEntityQuery) => Promise<IntegrationEntityPage>
  transitions?: (context: IntegrationProviderContext, input: Record<string, unknown>) => Promise<IntegrationStatusTransitionPage>
  updateStatus?: (context: IntegrationProviderContext, input: Record<string, unknown>) => Promise<IntegrationEntity>
}

export interface IntegrationStatusTransition {
  id: string
  title: string
  fromStatus: string
  toStatus: string
  requiredFields: string[]
}

export interface IntegrationStatusTransitionPage {
  currentStatus: string
  transitions: IntegrationStatusTransition[]
}

export interface WorkspaceIntegrationAdapter {
  get: (context: IntegrationProviderContext, input: Record<string, unknown>) => Promise<IntegrationEntity>
}

export interface RepositoryIntegrationAdapter {
  search: (context: IntegrationProviderContext, query: IntegrationEntityQuery) => Promise<IntegrationEntityPage>
}

export interface MergeRequestIntegrationAdapter {
  list: (context: IntegrationProviderContext, query: IntegrationEntityQuery) => Promise<IntegrationEntityPage>
  create?: (context: IntegrationProviderContext, input: Record<string, unknown>) => Promise<IntegrationEntity>
  addReviewer?: (context: IntegrationProviderContext, input: Record<string, unknown>) => Promise<IntegrationEntity>
}

export interface IssueIntegrationAdapter {
  list: (context: IntegrationProviderContext, query: IntegrationEntityQuery) => Promise<IntegrationEntityPage>
}

export interface CiIntegrationAdapter {
  status: (context: IntegrationProviderContext, input: Record<string, unknown>) => Promise<IntegrationEntityPage>
}

/** Trusted host implementation used by declarative marketplace integrations. */
export interface IntegrationProvider {
  resources?: ResourcePageAdapter
  id: string
  apiVersion: string
  connectionStatus: (context: IntegrationProviderContext) => Promise<IntegrationConnectionStatus>
  connection?: {
    update: (context: IntegrationProviderContext, input: Record<string, unknown>) => Promise<IntegrationConnectionStatus>
    complete?: (context: IntegrationProviderContext, input: Record<string, unknown>) => Promise<IntegrationConnectionStatus>
  }
  configuration?: { update?: (context: IntegrationProviderContext, input: Record<string, unknown>) => Promise<IntegrationEntityPage>, list: (context: IntegrationProviderContext, input?: Record<string, unknown>) => Promise<IntegrationEntityPage> }
  workItems?: WorkItemIntegrationAdapter
  workspaces?: WorkspaceIntegrationAdapter
  repositories?: RepositoryIntegrationAdapter
  mergeRequests?: MergeRequestIntegrationAdapter
  issues?: IssueIntegrationAdapter
  ci?: CiIntegrationAdapter
}

export interface InstalledIntegrationContribution extends IntegrationContribution {
  pluginId: string
  source: string
}

export type ResolvedIntegrationAction = IntegrationContribution['actions'][number] & {
  effectiveConfirmation: IntegrationConfirmation
}

export type IntegrationActionResult
  = ResourcePage
    | IntegrationConnectionStatus
    | IntegrationEntity
    | IntegrationEntityPage
    | IntegrationStatusTransitionPage

export interface ResolvedIntegrationContribution extends Omit<InstalledIntegrationContribution, 'actions'> {
  actions: ResolvedIntegrationAction[]
  providerVersion: string
}

export interface IntegrationDiagnostic {
  integrationId: string
  pluginId: string
  message: string
}

/** Raised before an integration performs a remote write that has not been reviewed. */
export class IntegrationConfirmationRequiredError extends Error {
  constructor(readonly integrationId: string, readonly actionId: string) {
    super(`Integration action requires confirmation: ${integrationId}/${actionId}`)
    this.name = 'IntegrationConfirmationRequiredError'
  }
}

const operationSupport: Record<IntegrationOperation, (provider: IntegrationProvider) => boolean> = {
  'resources.read': provider => Boolean(provider.resources),
  'resources.update': provider => Boolean(provider.resources),
  'resources.execute': provider => Boolean(provider.resources),
  'connection.status': () => true,
  'connection.update': provider => provider.connection !== undefined,
  'configuration.list': provider => provider.configuration !== undefined,
  'configuration.update': provider => provider.configuration?.update !== undefined,
  'work-items.get': provider => provider.workItems?.get !== undefined,
  'work-items.search': provider => provider.workItems !== undefined,
  'work-items.list': provider => provider.workItems !== undefined,
  'work-items.transitions': provider => provider.workItems?.transitions !== undefined,
  'work-items.update-status': provider => provider.workItems?.updateStatus !== undefined,
  'workspaces.get': provider => provider.workspaces?.get !== undefined,
  'repositories.search': provider => provider.repositories !== undefined,
  'merge-requests.list': provider => provider.mergeRequests !== undefined,
  'merge-requests.create': provider => provider.mergeRequests?.create !== undefined,
  'merge-requests.add-reviewer': provider => provider.mergeRequests?.addReviewer !== undefined,
  'issues.list': provider => provider.issues !== undefined,
  'ci.status': provider => provider.ci !== undefined,
}

/**
 * Resolve active declarative integrations against trusted host providers.
 *
 * The registry owns compatibility checks and host confirmation floors so UI
 * callers only consume integrations that can actually run.
 */
export class IntegrationRegistry {
  private readonly authorizations = new Map<string, { integrationId: string, context: IntegrationProviderContext, expires: number }>()
  private readonly providers = new Map<string, IntegrationProvider>()

  constructor(providers: IntegrationProvider[] = []) {
    for (const provider of providers) {
      if (this.providers.has(provider.id))
        throw new Error(`Duplicate integration provider id: ${provider.id}`)
      this.providers.set(provider.id, provider)
    }
  }

  resolve(contributions: InstalledIntegrationContribution[]): { integrations: ResolvedIntegrationContribution[], diagnostics: IntegrationDiagnostic[] } {
    const integrations: ResolvedIntegrationContribution[] = []
    const diagnostics: IntegrationDiagnostic[] = []
    const ids = new Set<string>()

    for (const contribution of contributions) {
      if (ids.has(contribution.id)) {
        diagnostics.push(this.diagnostic(contribution, `Duplicate integration id: ${contribution.id}`))
        continue
      }
      ids.add(contribution.id)
      const provider = this.providers.get(contribution.provider.id)
      if (!provider) {
        diagnostics.push(this.diagnostic(contribution, `Integration provider is not available: ${contribution.provider.id}`))
        continue
      }
      if (!satisfies(provider.apiVersion, contribution.provider.requires, { includePrerelease: true })) {
        diagnostics.push(this.diagnostic(contribution, `Integration provider ${provider.id}@${provider.apiVersion} does not satisfy ${contribution.provider.requires}`))
        continue
      }
      const unsupported = contribution.actions.find(action => !operationSupport[action.operation](provider))
      if (unsupported) {
        diagnostics.push(this.diagnostic(contribution, `Integration provider ${provider.id} does not support ${unsupported.operation}`))
        continue
      }
      integrations.push({
        ...structuredClone(contribution),
        providerVersion: provider.apiVersion,
        actions: contribution.actions.map(action => ({
          ...action,
          effectiveConfirmation: effectiveConfirmation(action.effect, action.confirmation),
        })),
      })
    }

    return { integrations, diagnostics }
  }

  /** Invoke one previously resolved action through its trusted host adapter. */
  async invoke(options: {
    contribution: ResolvedIntegrationContribution
    actionId: string
    context?: IntegrationProviderContext
    input?: Record<string, unknown>
    confirmed?: boolean
  }): Promise<IntegrationActionResult> {
    const action = options.contribution.actions.find(candidate => candidate.id === options.actionId)
    if (!action)
      throw new Error(`Integration action is unavailable: ${options.actionId}`)
    if (action.effectiveConfirmation !== 'never' && options.confirmed !== true)
      throw new IntegrationConfirmationRequiredError(options.contribution.id, action.id)

    const provider = this.providers.get(options.contribution.provider.id)
    if (!provider)
      throw new Error(`Integration provider is unavailable: ${options.contribution.provider.id}`)
    const context = { ...options.context, confirmed: options.confirmed === true }
    const input = options.input ?? {}
    const query = integrationEntityQuery(input)

    switch (action.operation) {
      case 'resources.read': return requireAdapter(provider.resources, action.operation).read(context, input)
      case 'resources.update': return requireAdapter(provider.resources, action.operation).update(context, input)
      case 'resources.execute': return requireAdapter(provider.resources, action.operation).execute(context, input)
      case 'connection.status': return provider.connectionStatus(context)
      case 'connection.update': {
        const result = await requireAdapter(provider.connection, action.operation).update(context, input)
        if (result.authorizationUrl) {
          const url = new URL(result.authorizationUrl)
          const state = url.searchParams.get('state')
          if (url.protocol !== 'https:' || !state || !context.callbackUrl || !provider.connection?.complete)
            throw new Error('Invalid authorization response')
          for (const [key, pending] of this.authorizations) {
            if (pending.expires < Date.now())
              this.authorizations.delete(key)
          }
          this.authorizations.set(state, { integrationId: options.contribution.id, context, expires: Date.now() + 600_000 })
        }
        return result
      }
      case 'configuration.update': return requireMethod(provider.configuration?.update, action.operation)(context, input)
      case 'configuration.list': return requireAdapter(provider.configuration, action.operation).list(context, input)
      case 'work-items.get': return requireMethod(provider.workItems?.get, action.operation)(context, input)
      case 'work-items.search': return requireAdapter(provider.workItems, action.operation).search(context, query)
      case 'work-items.list': return requireAdapter(provider.workItems, action.operation).list(context, query)
      case 'work-items.transitions': return requireMethod(provider.workItems?.transitions, action.operation)(context, input)
      case 'work-items.update-status': return requireMethod(provider.workItems?.updateStatus, action.operation)(context, input)
      case 'workspaces.get': return requireMethod(provider.workspaces?.get, action.operation)(context, input)
      case 'repositories.search': return requireAdapter(provider.repositories, action.operation).search(context, query)
      case 'merge-requests.list': return requireAdapter(provider.mergeRequests, action.operation).list(context, query)
      case 'merge-requests.create': return requireMethod(provider.mergeRequests?.create, action.operation)(context, input)
      case 'merge-requests.add-reviewer': return requireMethod(provider.mergeRequests?.addReviewer, action.operation)(context, input)
      case 'issues.list': return requireAdapter(provider.issues, action.operation).list(context, query)
      case 'ci.status': return requireAdapter(provider.ci, action.operation).status(context, input)
    }
  }

  /** Complete a pending, explicitly initiated OAuth flow once, in its original scope. */
  async completeConnection(contribution: ResolvedIntegrationContribution, input: Record<string, unknown>): Promise<void> {
    const state = typeof input.state === 'string' ? input.state : ''
    const pending = this.authorizations.get(state)
    if (!pending || pending.integrationId !== contribution.id || pending.expires < Date.now())
      throw new Error('Authorization session is invalid or expired')
    this.authorizations.delete(state)
    const provider = this.providers.get(contribution.provider.id)
    await requireMethod(provider?.connection?.complete, 'connection.update')(pending.context, input)
  }

  private diagnostic(contribution: InstalledIntegrationContribution, message: string): IntegrationDiagnostic {
    return { integrationId: contribution.id, pluginId: contribution.pluginId, message }
  }
}

function integrationEntityQuery(input: Record<string, unknown>): IntegrationEntityQuery {
  return {
    ...structuredClone(input),
    keyword: typeof input.keyword === 'string' ? input.keyword : undefined,
    limit: typeof input.limit === 'number' ? input.limit : undefined,
    cursor: typeof input.cursor === 'string' ? input.cursor : undefined,
  }
}

function requireAdapter<T>(adapter: T | undefined, operation: IntegrationOperation): T {
  if (!adapter)
    throw new Error(`Integration provider does not support ${operation}`)
  return adapter
}

function requireMethod<T>(method: T | undefined, operation: IntegrationOperation): T {
  if (!method)
    throw new Error(`Integration provider does not support ${operation}`)
  return method
}

function effectiveConfirmation(effect: IntegrationEffect, requested: IntegrationConfirmation): IntegrationConfirmation {
  if (effect === 'local-read' || effect === 'remote-read' || requested === 'always')
    return requested
  return requested === 'never' ? 'risk-based' : requested
}

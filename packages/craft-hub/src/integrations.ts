import { satisfies, validRange } from 'semver'
import { z } from 'zod'

export const integrationEffectSchema = z.enum(['remote-read', 'remote-write'])
export const integrationConfirmationSchema = z.enum(['never', 'risk-based', 'always'])
export const integrationOperationSchema = z.enum([
  'connection.status',
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
  'merge-requests.add-reviewer',
  'merge-requests.create',
  'work-items.update-status',
])
const integrationViewBlockSchema = z.object({
  id: integrationIdSchema,
  type: z.enum(['connection-status', 'entity-search', 'entity-list']),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  actionId: integrationIdSchema,
  input: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
})

export const integrationContributionSchema = z.object({
  id: integrationIdSchema,
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
    actionIds.add(action.id)
  }
  const viewIds = new Set<string>()
  for (const [viewIndex, view] of integration.views.entries()) {
    if (viewIds.has(view.id))
      context.addIssue({ code: 'custom', message: `Duplicate integration view id: ${view.id}`, path: ['views', viewIndex, 'id'] })
    viewIds.add(view.id)
    for (const [blockIndex, block] of view.blocks.entries()) {
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
  /** Whether the host reviewed and confirmed the current action invocation. */
  confirmed?: boolean
  projectId?: string
  projectPath?: string
}

export interface IntegrationConnectionStatus {
  connected: boolean
  accountLabel?: string
  message?: string
}

export interface IntegrationEntity {
  id: string
  /** Provider availability hint for this entity and request context; writes still require server authorization. */
  statusUpdateAvailable?: boolean
  title: string
  url?: string
  status?: string
  description?: string
  metadata?: Record<string, string | number | boolean | null>
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
  id: string
  apiVersion: string
  connectionStatus: (context: IntegrationProviderContext) => Promise<IntegrationConnectionStatus>
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
  = IntegrationConnectionStatus
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
  'connection.status': () => true,
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
      case 'connection.status': return provider.connectionStatus(context)
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
  if (effect === 'remote-read' || requested === 'always')
    return requested
  return requested === 'never' ? 'risk-based' : requested
}

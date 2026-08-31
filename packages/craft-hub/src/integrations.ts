import { satisfies, validRange } from 'semver'
import { z } from 'zod'

export const integrationEffectSchema = z.enum(['remote-read', 'remote-write'])
export const integrationConfirmationSchema = z.enum(['never', 'risk-based', 'always'])
export const integrationOperationSchema = z.enum([
  'connection.status',
  'work-items.search',
  'work-items.list',
  'repositories.search',
  'merge-requests.list',
  'merge-requests.create',
  'merge-requests.add-reviewer',
  'issues.list',
  'ci.status',
])

const integrationIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/)
const integrationViewBlockSchema = z.object({
  id: integrationIdSchema,
  type: z.enum(['connection-status', 'entity-search', 'entity-list']),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  actionId: integrationIdSchema,
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
}

export interface IntegrationEntityPage {
  items: IntegrationEntity[]
  nextCursor?: string
}

export interface WorkItemIntegrationAdapter {
  search: (context: IntegrationProviderContext, query: IntegrationEntityQuery) => Promise<IntegrationEntityPage>
  list: (context: IntegrationProviderContext, query: IntegrationEntityQuery) => Promise<IntegrationEntityPage>
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

export interface ResolvedIntegrationContribution extends Omit<InstalledIntegrationContribution, 'actions'> {
  actions: ResolvedIntegrationAction[]
  providerVersion: string
}

export interface IntegrationDiagnostic {
  integrationId: string
  pluginId: string
  message: string
}

const operationSupport: Record<IntegrationOperation, (provider: IntegrationProvider) => boolean> = {
  'connection.status': () => true,
  'work-items.search': provider => provider.workItems !== undefined,
  'work-items.list': provider => provider.workItems !== undefined,
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

  private diagnostic(contribution: InstalledIntegrationContribution, message: string): IntegrationDiagnostic {
    return { integrationId: contribution.id, pluginId: contribution.pluginId, message }
  }
}

function effectiveConfirmation(effect: IntegrationEffect, requested: IntegrationConfirmation): IntegrationConfirmation {
  if (effect === 'remote-read' || requested === 'always')
    return requested
  return requested === 'never' ? 'risk-based' : requested
}

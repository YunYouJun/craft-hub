import type { IntegrationActionResult, ResolvedIntegrationAction, ResolvedIntegrationContribution } from './integrations'
import type { ResourceField, ResourceInput } from './resource-pages'
import type { ProjectRecord } from './types'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { connectionReviewRevision } from './integration-connection-review'
import { integrationFormInput } from './integration-form-inputs'
import { IntegrationConfirmationRequiredError, IntegrationReviewChangedError } from './integrations'

const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()])
const selectorSchema = z.object({ viewId: z.string().min(1), blockId: z.string().min(1), resource: z.object({ input: z.record(z.string(), scalar), formId: z.string().min(1) }).strict().optional() }).strict()
const prepareSchema = z.object({ selector: selectorSchema, values: z.record(z.string(), z.string().max(1_000_000)), locale: z.enum(['en', 'zh-CN']).default('en') }).strict()
/** Stable declaration or resource-form location, with no client-supplied executable action. */
export type IntegrationFormSelector = z.infer<typeof selectorSchema>
/** A bounded, in-memory, one-use review. The server retains the immutable typed input. */
export interface IntegrationFormPlan {
  version: 1
  planId: string
  title: string
  description?: string
  effect: string
  operation: string
  requiresConfirmation: boolean
  expiresAt: string
  project?: { id: string, name: string, trust: string }
  fields: Array<{ label: string, value: string }>
}
/** Form-specific errors carry a public HTTP status without exposing submitted values. */
export class IntegrationFormError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'IntegrationFormError'
  }
}
interface Invocation { integrationId: string, actionId: string, projectId?: string, input?: Record<string, unknown>, confirmed?: boolean, reviewedAction?: unknown, callbackUrl?: string }
interface Host {
  catalog: () => Promise<{ integrations: ResolvedIntegrationContribution[] }>
  project: (id: string) => Promise<ProjectRecord>
  invoke: (options: Invocation) => Promise<IntegrationActionResult>
}
interface ResolvedForm {
  action: ResolvedIntegrationAction
  fields: ResourceField[]
  input: ResourceInput
  title: string
  description?: string
  revision: string
  translate: (value: string) => string
  project?: ProjectRecord
}
interface StoredPlan {
  integration: string
  project?: string
  selector: IntegrationFormSelector
  locale: 'en' | 'zh-CN'
  input: Record<string, unknown>
  revision: string
  action: ResolvedIntegrationAction
  plan: IntegrationFormPlan
  bytes: number
  timer: ReturnType<typeof setTimeout>
}

/** Preparation never invokes submitted form input; execution revalidates and consumes each plan at most once. */
export class IntegrationFormService {
  private readonly plans = new Map<string, StoredPlan>()
  constructor(private readonly host: Host, private readonly now: () => number = Date.now) {}

  /** Resolve current fields and retain normalized input for a scoped, expiring review. */
  async prepare(integration: string, project: string | undefined, raw: unknown): Promise<IntegrationFormPlan> {
    const { selector, values, locale } = prepareSchema.parse(raw)
    const form = await this.resolve(integration, project, selector, locale)
    let input: Record<string, unknown>
    try {
      input = integrationFormInput(form.fields.map(field => ({ ...field, label: form.translate(field.label) })), values, form.input)
    }
    catch (error) {
      throw new IntegrationFormError(400, error instanceof Error ? error.message : 'Invalid form input')
    }
    const plan: IntegrationFormPlan = {
      version: 1,
      planId: randomUUID(),
      title: form.translate(form.title),
      ...(form.description && { description: form.translate(form.description) }),
      effect: form.action.effect,
      operation: form.action.operation,
      requiresConfirmation: form.action.effectiveConfirmation !== 'never',
      expiresAt: new Date(this.now() + 600_000).toISOString(),
      ...(form.project && { project: { id: form.project.id, name: form.project.name, trust: form.project.trust } }),
      fields: Object.entries(input).filter(([id]) => id !== 'locale').map(([id, value]) => ({ label: form.translate(form.fields.find(field => field.id === id)?.label ?? id), value: typeof value === 'string' ? value : JSON.stringify(value) })),
    }
    const bytes = Buffer.byteLength(JSON.stringify({ selector, input, plan }))
    if (bytes > 1_048_576)
      throw new IntegrationFormError(413, 'The form review is too large')
    for (const [id, stored] of this.plans) {
      if (Date.parse(stored.plan.expiresAt) <= this.now())
        this.drop(id)
    }
    while (this.plans.size >= 200 || [...this.plans.values()].reduce((sum, item) => sum + item.bytes, bytes) > 8_388_608)
      this.drop(this.plans.keys().next().value!)
    const timer = setTimeout(() => this.drop(plan.planId), 600_000)
    timer.unref()
    this.plans.set(plan.planId, { integration, project, selector, locale, input: structuredClone(input), revision: form.revision, action: form.action, plan, bytes, timer })
    return structuredClone(plan)
  }

  /** Consume a review before revalidation; existing runtime confirmation and trust checks still apply. */
  async execute(integration: string, project: string | undefined, raw: unknown, callbackUrl?: string): Promise<IntegrationActionResult> {
    const body = z.object({ planId: z.string(), confirmed: z.boolean().default(false) }).strict().parse(raw)
    const stored = this.plans.get(body.planId)
    if (!stored || stored.integration !== integration || stored.project !== project || Date.parse(stored.plan.expiresAt) <= this.now())
      throw new IntegrationReviewChangedError()
    if (stored.plan.requiresConfirmation && !body.confirmed)
      throw new IntegrationConfirmationRequiredError(integration, stored.action.id)
    // Consume before asynchronous revalidation so double-clicks, concurrent requests and unknown outcomes cannot replay.
    this.drop(body.planId)
    const fresh = await this.resolve(integration, project, stored.selector, stored.locale)
    if (fresh.revision !== stored.revision || Date.parse(stored.plan.expiresAt) <= this.now())
      throw new IntegrationReviewChangedError()
    return this.host.invoke({ integrationId: integration, actionId: fresh.action.id, projectId: project, input: stored.input, confirmed: body.confirmed, callbackUrl, reviewedAction: { operation: fresh.action.operation, effect: fresh.action.effect } })
  }

  /** Idempotently discard only a review owned by the specified integration and project scope. */
  discard(integration: string, project: string | undefined, raw: unknown): void {
    const { planId } = z.object({ planId: z.string() }).strict().parse(raw)
    const stored = this.plans.get(planId)
    if (stored?.integration === integration && stored.project === project)
      this.drop(planId)
  }

  /** Clear transient inputs and expiry timers when the host closes. */
  close(): void {
    for (const id of this.plans.keys())
      this.drop(id)
  }

  private drop(id: string): void {
    clearTimeout(this.plans.get(id)?.timer)
    this.plans.delete(id)
  }

  private async resolve(integration: string, projectId: string | undefined, selector: IntegrationFormSelector, locale: 'en' | 'zh-CN'): Promise<ResolvedForm> {
    const contribution = (await this.host.catalog()).integrations.find(item => item.id === integration)
    const view = contribution?.views.find(item => item.id === selector.viewId)
    const block = view?.blocks.find(item => item.id === selector.blockId)
    if (!contribution || !view || !block || (view.scope === 'project' && !projectId) || (block.requiresProject && !projectId))
      throw new IntegrationReviewChangedError()
    const project = projectId ? await this.host.project(projectId) : undefined
    let action = contribution.actions.find(item => item.id === block.actionId)
    let fields = block.fields ?? []
    let input = block.input ?? {}
    let title = block.title ?? action?.title ?? block.id
    let description = block.description
    let resourceDefinition: unknown
    if (selector.resource) {
      if (block.type !== 'resource-browser' || action?.operation !== 'resources.read' || action.effect !== 'remote-read' || action.effectiveConfirmation !== 'never')
        throw new IntegrationReviewChangedError()
      const page = await this.host.invoke({ integrationId: integration, actionId: action.id, projectId, input: { ...selector.resource.input, locale }, reviewedAction: { operation: 'resources.read', effect: 'remote-read' } })
      if (!('kind' in page) || page.kind !== 'resource-page')
        throw new IntegrationReviewChangedError()
      const forms = page.forms?.filter(item => item.id === selector.resource!.formId) ?? []
      if (forms.length !== 1)
        throw new IntegrationReviewChangedError()
      const form = forms[0]!
      action = contribution.actions.find(item => item.operation === `resources.${form.effect}`)
      fields = form.fields
      input = form.input
      title = form.title
      description = form.description
      resourceDefinition = { input: page.input, form }
    }
    else if (block.type !== 'action-form' || (view.scope === 'global' && projectId)) {
      throw new IntegrationReviewChangedError()
    }
    if (!action)
      throw new IntegrationReviewChangedError()
    const connectionAction = contribution.actions.find(item => item.operation === 'connection.status' && item.effect === 'remote-read' && item.effectiveConfirmation === 'never')
    let connectionRevision: string | undefined
    if (connectionAction) {
      const status = await this.host.invoke({ integrationId: integration, actionId: connectionAction.id, projectId, input: { locale }, reviewedAction: { operation: 'connection.status', effect: 'remote-read' } })
      if (!('connected' in status))
        throw new IntegrationReviewChangedError()
      connectionRevision = connectionReviewRevision(status)
    }
    const translate = selector.resource ? (value: string) => value : (value: string) => contribution.translations?.[locale]?.[value] ?? value
    const revision = createHash('sha256').update(JSON.stringify({ provider: contribution.provider, providerVersion: contribution.providerVersion, view: { id: view.id, scope: view.scope }, block, action, resourceDefinition, connectionRevision, translations: contribution.translations?.[locale] })).digest('hex')
    return { action, fields, input, title, description, revision, translate, project }
  }
}

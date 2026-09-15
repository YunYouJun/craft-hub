import { createHash } from 'node:crypto'
import { z } from 'zod'

export const deliveryId = z.string().min(1).max(200)
export const workItemRefSchema = z.object({
  provider: deliveryId,
  containerId: deliveryId,
  kind: deliveryId,
  itemId: deliveryId,
  title: z.string().min(1).max(500),
  url: z.string().url().max(2048).refine(value => ['http:', 'https:'].includes(new URL(value).protocol)),
  status: z.string().max(200),
  fetchedAt: z.number().int().nonnegative(),
}).strict()

/** Verified external identity. Container and kind are required to avoid cross-project collisions. */
export type DeliveryWorkItemRef = z.infer<typeof workItemRefSchema>

export function deliveryWorkItemKey(input: DeliveryWorkItemRef): string {
  const item = workItemRefSchema.parse(input)
  return createHash('sha256').update(JSON.stringify([item.provider, item.containerId, item.kind, item.itemId])).digest('hex')
}

/** Authentication is supplied by the host, never inferred from chat text. */
export interface DeliveryActor { id: string }
export type DeliveryPermission = 'read' | 'channel-read' | 'execute' | 'share' | 'manage' | 'deliver'
export interface DeliveryLink {
  id: string
  ownerId: string
  projectId: string
  primary: DeliveryWorkItemRef
  related: DeliveryWorkItemRef[]
  channels: string[]
  createdAt: number
}
export interface DeliveryDevice {
  id: string
  ownerId: string
  name: string
  tokenHash: string
  projectIds: string[]
  capabilities: { worktree: boolean, followup: boolean }
  lastSeenAt: number
  revoked: boolean
}
export type DeliveryRequestStatus = 'draft' | 'awaiting_acceptance' | 'dispatched' | 'starting' | 'running' | 'needs_attention' | 'cancel_requested' | 'completed' | 'failed' | 'cancelled' | 'declined'
export interface DeliveryRequest {
  id: string
  deliveryId: string
  requesterId: string
  executorId: string
  deviceId: string
  projectId: string
  prompt: string
  mode: 'worktree' | 'checkout'
  status: DeliveryRequestStatus
  createdAt: number
  updatedAt: number
  parentId?: string
  continuation?: boolean
  localTaskId?: string
  summary?: string
  reportSequence: number
}
export interface DeliveryOperationPlan {
  kind: string
  projectId: string
  revision: string
  title: string
  details: Record<string, string>
}
export interface DeliveryOperation {
  id: string
  deliveryId: string
  actorId: string
  plan: DeliveryOperationPlan
  fingerprint: string
  status: 'awaiting_confirmation' | 'executing' | 'succeeded' | 'failed' | 'unknown' | 'expired'
  expiresAt: number
  result?: string
}
export interface DeliveryOperationProvider {
  plan: (actor: DeliveryActor, link: DeliveryLink, kind: string, input: Record<string, string>) => Promise<DeliveryOperationPlan>
  /** Must enforce plan.revision atomically at the destination. Never retry uncertain writes. */
  execute: (actor: DeliveryActor, plan: DeliveryOperationPlan, operationId: string) => Promise<string>
  reconcile?: (actor: DeliveryActor, plan: DeliveryOperationPlan, operationId: string) => Promise<{ status: 'succeeded' | 'failed' | 'unknown', result: string }>
}
export interface DeliveryState {
  version: 1
  links: DeliveryLink[]
  devices: DeliveryDevice[]
  requests: DeliveryRequest[]
  operations: DeliveryOperation[]
  deduplication: Record<string, { id: string, fingerprint: string }>
  pairings: Array<{ id: string, verifierHash: string, name: string, expiresAt: number, ownerId?: string, projectIds: string[] }>
}
export function initialDeliveryState(): DeliveryState {
  return { version: 1, links: [], devices: [], requests: [], operations: [], pairings: [], deduplication: {} }
}
/** Expected domain error; hosts map this status without exposing internal exceptions. */
export class DeliveryError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

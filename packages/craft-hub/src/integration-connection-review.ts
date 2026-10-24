import type { IntegrationConnectionStatus } from './integrations'
import { createHash } from 'node:crypto'

/** A display revision binds connection approval to the account, grant and currently offered form definitions. */
export function connectionReviewRevision(status: IntegrationConnectionStatus): string {
  const view = {
    connected: status.connected,
    account: status.accountLabel ?? null,
    cacheKey: status.session?.cacheKey ?? null,
    create: status.capabilities?.create ?? null,
    authorizationUrl: status.authorizationUrl ?? null,
    device: status.deviceAuthorization ? [status.deviceAuthorization.verificationUrl, status.deviceAuthorization.userCode, status.deviceAuthorization.expiresAt] : null,
    forms: (status.forms ?? []).map(form => ({
      id: form.id,
      title: form.title,
      description: form.description ?? null,
      submitLabel: form.submitLabel,
      fields: form.fields.map(field => ({ id: field.id, label: field.label, type: field.type, required: field.required === true, value: field.type === 'password' ? null : field.value ?? null, placeholder: field.placeholder ?? null })),
    })),
  }
  return createHash('sha256').update(JSON.stringify(view)).digest('hex')
}

/** Check a native review without executing or persisting its submitted credentials. Legacy requests remain unchanged. */
export function matchesConnectionReview(status: IntegrationConnectionStatus, revision: unknown, input: Record<string, unknown>): boolean {
  if (typeof revision !== 'string' || revision !== connectionReviewRevision(status))
    return false
  const forms = status.forms?.filter(form => form.id === input.method) ?? []
  if (forms.length !== 1)
    return false
  const fields = forms[0]!.fields
  if (fields.some(field => ['method', 'locale', '__proto__', 'prototype', 'constructor'].includes(field.id)) || new Set(fields.map(field => field.id)).size !== fields.length)
    return false
  const keys = new Set(['method', 'locale', ...fields.map(field => field.id)])
  return Object.entries(input).every(([key, value]) => keys.has(key) && typeof value === 'string')
    && fields.every(field => (!field.required && input[field.id] === undefined) || (typeof input[field.id] === 'string' && (!field.required || String(input[field.id]).trim().length > 0)))
}

/** Never forward a provider's password default to a native form or its review. */
export function presentConnection(status: IntegrationConnectionStatus): IntegrationConnectionStatus & { reviewRevision: string } {
  return {
    ...status,
    ...(status.forms && { forms: status.forms.map(form => ({ ...form, fields: form.fields.map(({ value, ...field }) => ({ ...field, ...(field.type !== 'password' && value !== undefined && { value }) })) })) }),
    reviewRevision: connectionReviewRevision(status),
  }
}

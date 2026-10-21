import type { HostDiagnosticReport, OperationSupport } from 'craft-hub'

export const configurationOperations = ['inspect', 'preview', 'apply', 'restore', 'history', 'git-status', 'git-fetch', 'git-commit', 'git-publish', 'repositories', 'repositories-update', 'backup-preview'] as const
export const softwareOperations = ['catalog', 'preview', 'install', 'runs', 'cancel', 'open'] as const
const reasonCodes = new Set(['unsupported-platform', 'unsupported-version', 'unavailable'])
export const unsupportedMessage = 'This Workstation version does not support capability negotiation. Update the local CLI to enable managed operations.'
export const unavailableMessage = 'Workstation capability negotiation is unavailable. Configure the local CLI and refresh.'
const invalidMessage = 'Workstation capability response is invalid. Update the local CLI and refresh.'

/** Safe transport status; process output and parser errors are never exposed. */
export class WorkstationHostError extends Error {
  constructor(readonly code: 'unsupported' | 'unavailable' | 'invalid') {
    super(code === 'unsupported' ? unsupportedMessage : code === 'invalid' ? invalidMessage : unavailableMessage)
  }
}

/** Only negotiated operations can authorize management; legacy reads remain separate. */
export interface WorkstationSupport {
  configuration: OperationSupport
  software: OperationSupport
  doctor: boolean
  repositoryValidation: boolean
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
    && [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
}

function denied(keys: readonly string[], reason: string): OperationSupport['operations'] {
  return Object.fromEntries(keys.map(key => [key, { supported: false, reason }]))
}

/** Missing, incompatible, or invalid negotiation closes every management operation. */
export function unavailableSupport(error: unknown): WorkstationSupport {
  const failure = error instanceof WorkstationHostError ? error : new WorkstationHostError('unavailable')
  const state = failure.code === 'unsupported' ? 'unsupported' : 'unavailable'
  const reason = state === 'unsupported' ? 'unsupported-version' : 'unavailable'
  return {
    configuration: { state, message: failure.message, operations: denied([...configurationOperations, 'software-open'], reason) },
    software: { state, message: failure.message, operations: denied(softwareOperations, reason) },
    doctor: false,
    repositoryValidation: false,
  }
}

function permissions(value: unknown, keys: readonly string[], compatible: boolean): OperationSupport['operations'] {
  if (!compatible)
    return denied(keys, 'unsupported-version')
  if (!record(value))
    throw new WorkstationHostError('invalid')
  const operations: OperationSupport['operations'] = {}
  for (const key of keys) {
    const permission = value[key]
    if (permission === undefined && ['repositories', 'repositories-update', 'backup-preview'].includes(key)) {
      operations[key] = { supported: false, reason: 'unsupported-version' }
      continue
    }
    if (!record(permission) || typeof permission.supported !== 'boolean'
      || (permission.reason !== undefined && (typeof permission.reason !== 'string' || !reasonCodes.has(permission.reason)))) {
      throw new WorkstationHostError('invalid')
    }
    operations[key] = { supported: permission.supported, ...(permission.reason ? { reason: permission.reason as string } : {}) }
  }
  return operations
}

/** Normalize a host protocol result into vendor-neutral display and operation contracts. */
export function workstationSupport(value: unknown): WorkstationSupport {
  if (!record(value) || value.version !== 1)
    throw new WorkstationHostError('unsupported')
  if (!boundedText(value.cliVersion, 128) || !/^\d+\.\d+\.\d+(?:[-+][a-z0-9.+-]+)?$/i.test(value.cliVersion)
    || !boundedText(value.platform, 32) || !/^[a-z0-9-]+$/.test(value.platform)
    || !record(value.protocols) || !record(value.operations)) {
    throw new WorkstationHostError('invalid')
  }
  if (value.protocols.host !== 1)
    throw new WorkstationHostError('unsupported')
  if (![value.protocols.configuration, value.protocols.software].every(version => Number.isSafeInteger(version) && Number(version) > 0))
    throw new WorkstationHostError('invalid')
  const configuration = permissions(value.operations.configuration, configurationOperations, value.protocols.configuration === 1)
  const software = permissions(value.operations.software, softwareOperations, value.protocols.software === 1)
  const doctor = permissions({ doctor: value.operations.doctor }, ['doctor'], true).doctor!.supported
  // This additive domain can be absent on an older CLI without disabling existing domains.
  const repositoryValidation = value.protocols.repositoryValidation === 1
    && record(value.operations.repositoryValidation) && value.operations.repositoryValidation.supported === true
  return {
    configuration: { state: 'available', cliVersion: value.cliVersion, platform: value.platform, operations: { ...configuration, 'software-open': software.open! } },
    software: { state: 'available', cliVersion: value.cliVersion, platform: value.platform, operations: software },
    doctor,
    repositoryValidation,
  }
}

/** Copy bounded doctor observations; source content and unknown fields never cross the adapter. */
export function workstationDoctor(value: unknown, support: WorkstationSupport): HostDiagnosticReport {
  if (!record(value) || value.version !== 1 || !boundedText(value.checkedAt, 80)
    || !/^\d{4}-\d{2}-\d{2}T/.test(value.checkedAt) || !Number.isFinite(Date.parse(value.checkedAt))
    || !Array.isArray(value.checks) || !value.checks.length || value.checks.length > 200) {
    throw new Error('Workstation doctor response is invalid. Update the local CLI and refresh.')
  }
  const checks = value.checks.map((check) => {
    if (!record(check) || !boundedText(check.code, 128) || !/^[a-z0-9.-]+$/.test(check.code)
      || !['info', 'warning', 'error'].includes(String(check.severity)) || !boundedText(check.message, 2000)
      || (check.path !== undefined && !boundedText(check.path, 4096))) {
      throw new Error('Workstation doctor response is invalid. Update the local CLI and refresh.')
    }
    return { code: check.code, severity: check.severity as 'info' | 'warning' | 'error', message: check.message, ...(check.path ? { path: check.path as string } : {}), target: { type: 'integration' as const, integrationId: 'workstation' } }
  })
  return {
    version: 1,
    checkedAt: value.checkedAt,
    checks,
    metadata: { version: support.configuration.cliVersion, platform: support.configuration.platform },
  }
}

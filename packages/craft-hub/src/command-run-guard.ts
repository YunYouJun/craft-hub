import type { CommandCapability, CommandInputValues, ProjectRecord } from './types'
import { isDeepStrictEqual } from 'node:util'

/** Frozen host approval checked again immediately before a reviewed command starts. */
export interface CommandRunGuard {
  projectPath: string
  capability: CommandCapability
  inputs?: CommandInputValues
  expiresAt: number
  signal?: AbortSignal
}

/** A stale host review never authorizes a changed command at the process boundary. */
export class CommandRunGuardError extends Error {}

/** Check cancellation and expiry synchronously at the final process-spawn boundary. */
export function assertCommandRunGuardActive(guard: CommandRunGuard): void {
  if (guard.signal?.aborted || !Number.isFinite(guard.expiresAt) || guard.expiresAt <= Date.now())
    throw new CommandRunGuardError('The command approval expired or was cancelled')
}

/** A changed package script, invocation, declaration or project requires a new host approval. */
export function assertCommandRunGuardMatches(guard: CommandRunGuard, project: ProjectRecord, capability: CommandCapability | undefined, inputs: CommandInputValues): void {
  assertCommandRunGuardActive(guard)
  if (project.trust !== 'trusted' || project.path !== guard.projectPath || !isDeepStrictEqual(capability, guard.capability) || !isDeepStrictEqual(inputs, guard.inputs ?? {}))
    throw new CommandRunGuardError('The reviewed project or command changed; review it again before running')
}

import type { ResourceInput } from 'craft-hub'

/** Select an installed resource block; native code resolves the source and Keychain scope itself. */
export interface ResourceDesktopContext {
  integrationId: string
  viewId: string
  blockId: string
  projectId?: string
  input: ResourceInput
}

/** Opaque, short-lived native grant. Availability lookups contain no password bytes. */
export interface ResourceDesktopSession {
  sessionId: string
  availableRowIds: string[]
}

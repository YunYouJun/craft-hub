export type TrustState = 'trusted' | 'untrusted'

export interface ProjectRecord {
  id: string
  name: string
  path: string
  icon?: string
  trust: TrustState
  addedAt: string
}

export type CapabilitySource = string

export interface CommandInvocation {
  command: string
  args: string[]
  cwd: string
  requiredEnv: string[]
}

export interface CommandCapability {
  id: string
  kind: 'command'
  name: string
  description?: string
  source: CapabilitySource
  invocation: CommandInvocation
}

export interface SkillCapability {
  id: string
  kind: 'skill'
  name: string
  description?: string
  source: CapabilitySource
  path: string
  contentHash: string
  content: string
}

export type Capability = CommandCapability | SkillCapability

export interface RunRecord {
  id: string
  projectId: string
  capabilityId: string
  command: string
  args: string[]
  cwd: string
  startedAt: string
  finishedAt?: string
  exitCode?: number | null
  signal?: NodeJS.Signals | null
  stdout: string
  stderr: string
  status: 'running' | 'completed' | 'cancelled' | 'failed'
}

export interface RunOutputEvent {
  stream: 'stdout' | 'stderr'
  chunk: string
}

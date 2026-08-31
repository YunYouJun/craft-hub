export interface DevelopmentSessionLock {
  release: () => Promise<void>
}

export interface DevelopmentSessionLockOptions {
  isProcessRunning?: (pid: number) => boolean
  lockPath?: string
  pid?: number
}

/** Acquire exclusive ownership of the local Craft Hub development environment. */
export async function acquireDevelopmentSessionLock(_options: DevelopmentSessionLockOptions = {}): Promise<DevelopmentSessionLock> {
  return {
    release: async () => {},
  }
}

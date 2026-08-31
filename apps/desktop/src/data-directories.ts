import type { DistributionConfig } from 'craft-hub'
import { resolve } from 'node:path'
import { getCraftHubDataDir } from 'craft-hub'

export interface DesktopDataDirectories {
  /** Machine-local runtime state shared by development and packaged instances of one distribution. */
  runtimeDataDir: string
  /** Electron-only development profile, kept separate from the packaged application profile. */
  developmentUserDataDir?: string
}

/** Resolve shared runtime state separately from Electron's development-only browser profile. */
export function resolveDesktopDataDirectories(input: {
  appDataDir: string
  development: boolean
  distribution: DistributionConfig
  env?: NodeJS.ProcessEnv
}): DesktopDataDirectories {
  const dataDirectoryName = input.distribution.dataDirectoryName ?? input.distribution.name
  return {
    runtimeDataDir: getCraftHubDataDir(input.env, dataDirectoryName),
    ...(input.development
      ? { developmentUserDataDir: resolve(input.appDataDir, `${dataDirectoryName} Dev`) }
      : {}),
  }
}

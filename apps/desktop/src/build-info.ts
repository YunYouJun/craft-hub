import { readFileSync } from 'node:fs'

export interface DesktopBuildInfo {
  schemaVersion: 1
  updatesEnabled: boolean
}

/** Create the packaged metadata that separates signed releases from local ad-hoc builds. */
export function createDesktopBuildInfo(updatesEnabled: boolean): DesktopBuildInfo {
  return { schemaVersion: 1, updatesEnabled }
}

/** Load packaged desktop metadata; source and legacy local builds default to no automatic updates. */
export function loadDesktopBuildInfo(path: string): DesktopBuildInfo {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<DesktopBuildInfo>
    if (parsed.schemaVersion !== 1 || typeof parsed.updatesEnabled !== 'boolean')
      throw new Error('Desktop build info must declare schemaVersion 1 and updatesEnabled')
    return { schemaVersion: 1, updatesEnabled: parsed.updatesEnabled }
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return createDesktopBuildInfo(false)
    throw new Error(`Could not load desktop build info at ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

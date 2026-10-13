import { readFileSync } from 'node:fs'

export type DesktopCodexMode = 'bundled' | 'external'

export interface DesktopBuildInfo {
  schemaVersion: 1
  updatesEnabled: boolean
  codexMode?: DesktopCodexMode
}

/** Create the packaged metadata that separates signed releases from local ad-hoc builds. */
export function createDesktopBuildInfo(updatesEnabled: boolean, codexMode: DesktopCodexMode = 'external'): DesktopBuildInfo {
  return { schemaVersion: 1, updatesEnabled, ...(codexMode === 'external' ? { codexMode } : {}) }
}

/** Load packaged desktop metadata; source and legacy local builds default to no automatic updates. */
export function loadDesktopBuildInfo(path: string): DesktopBuildInfo {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<DesktopBuildInfo>
    if (parsed.schemaVersion !== 1 || typeof parsed.updatesEnabled !== 'boolean')
      throw new Error('Desktop build info must declare schemaVersion 1 and updatesEnabled')
    if (parsed.codexMode !== undefined && parsed.codexMode !== 'bundled' && parsed.codexMode !== 'external')
      throw new Error('Desktop build info must declare bundled or external Codex mode')
    return createDesktopBuildInfo(parsed.updatesEnabled, parsed.codexMode ?? 'bundled')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return createDesktopBuildInfo(false, 'bundled')
    throw new Error(`Could not load desktop build info at ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

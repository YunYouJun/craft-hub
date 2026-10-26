import type { SoftwareCatalogSnapshot } from './software-catalog'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, relative } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { SoftwareOperationError } from './software-catalog'

const execute = promisify(execFile)
/** Application identity accepted by navigation and catalog metadata, never an executable or a path. */
export const macosBundleIdSchema = z.string().min(3).max(255).regex(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i)
const identifier = z.string().regex(/^[a-f0-9]{64}$/)
/** Finder requests select discovered IDs only. Omitting candidateId reveals the application itself. */
export const applicationRevealRequestSchema = z.object({ candidateId: identifier.optional() }).strict()

/** One locally observed application. IDs distinguish copies that share a bundle identifier. */
export interface MaintainedApplication {
  id: string
  bundleId: string
  name: string
  path: string
}
/** Bounded scan result; missing permissions are not represented as an empty successful scan. */
export interface ApplicationMaintenanceSnapshot {
  version: 1
  supported: boolean
  applications: MaintainedApplication[]
  incomplete: boolean
}
/** A filename-based suggestion; revealing it is supported, executing it is not. */
export interface UninstallerCandidate {
  id: string
  name: string
  path: string
  evidence: 'inside-application' | 'adjacent-to-application'
  verification: 'unverified'
}
/** Documentation is attributed to its catalog instead of inferred from search results. */
export interface ApplicationUninstallGuidance {
  version: 1
  application: MaintainedApplication
  candidates: UninstallerCandidate[]
  documentation: { url: string, source: string }[]
  searchUrl: string
  incomplete: boolean
}

interface MaintenanceOptions {
  platform?: NodeJS.Platform
  roots?: string[]
  manifest?: (path: string) => Promise<Record<string, unknown>>
  reveal?: (path: string) => Promise<void>
  catalog?: () => Promise<SoftwareCatalogSnapshot>
}

const fileID = (path: string): string => createHash('sha256').update(path).digest('hex')
const safeName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 255 && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
function inside(root: string, path: string): boolean {
  const suffix = relative(root, path)
  return suffix !== '..' && !suffix.startsWith('../') && !suffix.startsWith('/')
}
const candidateName = (name: string): boolean => /(?:^|[\s._-])uninstall(?:er)?(?:$|[\s._-])|卸载/i.test(name)

async function readManifest(path: string): Promise<Record<string, unknown>> {
  const file = join(path, 'Contents/Info.plist')
  const info = await lstat(file)
  if (!info.isFile() || info.size > 1024 * 1024 || !inside(await realpath(path), await realpath(file)))
    throw new Error('Invalid application manifest')
  const { stdout } = await execute('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { timeout: 2000, maxBuffer: 1024 * 1024 })
  return JSON.parse(stdout)
}

/** Local macOS inspection. Scans app bundles and their immediate support folders, never user data. */
export class ApplicationMaintenanceService {
  private readonly platform: NodeJS.Platform
  private readonly roots: string[]
  private readonly manifest: NonNullable<MaintenanceOptions['manifest']>
  private readonly revealFile: NonNullable<MaintenanceOptions['reveal']>
  private readonly catalog?: MaintenanceOptions['catalog']

  constructor(options: MaintenanceOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.roots = options.roots ?? ['/Applications', join(homedir(), 'Applications')]
    this.manifest = options.manifest ?? readManifest
    this.revealFile = options.reveal ?? (async (path) => {
      await execute('/usr/bin/open', ['-R', path], { timeout: 5000 })
    })
    this.catalog = options.catalog
  }

  async snapshot(): Promise<ApplicationMaintenanceSnapshot> {
    const result: ApplicationMaintenanceSnapshot = { version: 1, supported: this.platform === 'darwin', applications: [], incomplete: false }
    if (!result.supported)
      return result
    let visited = 0
    const walk = async (directory: string, depth: number): Promise<void> => {
      let entries
      try {
        entries = await readdir(directory, { withFileTypes: true })
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          result.incomplete = true
        return
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (++visited > 3000 || result.applications.length >= 500) {
          result.incomplete = true
          return
        }
        if (!entry.isDirectory() || entry.name.startsWith('.') || !safeName(entry.name))
          continue
        const path = join(directory, entry.name)
        if (entry.name.toLowerCase().endsWith('.app')) {
          try {
            const info = await this.manifest(path)
            const bundleId = macosBundleIdSchema.parse(info.CFBundleIdentifier)
            const name = [info.CFBundleDisplayName, info.CFBundleName, basename(path, '.app')].find(safeName)!
            result.applications.push({ id: fileID(`${path}\0${bundleId}`), bundleId, name, path })
          }
          catch {
            result.incomplete = true
          }
        }
        else if (depth < 2) {
          await walk(path, depth + 1)
        }
      }
    }
    for (const root of this.roots) await walk(root, 0)
    result.applications.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
    return result
  }

  async guidance(id: string): Promise<ApplicationUninstallGuidance> {
    const application = await this.application(id)
    const candidates: UninstallerCandidate[] = []
    let incomplete = false
    // Never recurse into another app's package or follow a symlink to an unrelated location.
    const directories: { path: string, evidence: UninstallerCandidate['evidence'] }[] = ['Contents', 'Contents/Helpers', 'Contents/Resources', 'Contents/MacOS'].map(path => ({ path: join(application.path, path), evidence: 'inside-application' }))
    const parent = application.path.slice(0, application.path.lastIndexOf('/'))
    // A vendor-specific enclosing folder is useful; the shared Applications folder is ambiguous.
    if (!this.roots.includes(parent))
      directories.push({ path: parent, evidence: 'adjacent-to-application' })
    for (const directory of directories) {
      try {
        if (await realpath(directory.path) !== directory.path)
          continue
        const entries = (await readdir(directory.path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
        if (entries.length > 500)
          incomplete = true
        for (const entry of entries.slice(0, 500)) {
          if (candidates.length >= 20) {
            incomplete = true
            break
          }
          if (!safeName(entry.name) || !candidateName(entry.name) || entry.isSymbolicLink())
            continue
          if (!(entry.isFile() || (entry.isDirectory() && entry.name.toLowerCase().endsWith('.app'))))
            continue
          const path = join(directory.path, entry.name)
          if (path === application.path || !inside(directory.path, await realpath(path)))
            continue
          candidates.push({ id: fileID(path), name: entry.name, path, evidence: directory.evidence, verification: 'unverified' })
        }
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          incomplete = true
      }
    }
    const documentation: ApplicationUninstallGuidance['documentation'] = []
    if (this.catalog) {
      try {
        const catalog = await this.catalog()
        for (const source of catalog.sources) {
          for (const item of source.items) {
            if (item.macosBundleId === application.bundleId && item.uninstallUrl && !documentation.some(doc => doc.url === item.uninstallUrl))
              documentation.push({ url: item.uninstallUrl, source: source.title })
          }
        }
      }
      catch { incomplete = true }
    }
    const search = new URL('https://www.google.com/search')
    search.searchParams.set('q', `${application.name} macOS uninstall official`)
    return { version: 1, application, candidates, documentation: documentation.slice(0, 20), searchUrl: search.href, incomplete }
  }

  /** Recheck the app and candidate on every click. The client cannot supply a file path or launch command. */
  async reveal(id: string, candidateId?: string): Promise<{ version: 1, destination: 'finder' }> {
    const guidance = await this.guidance(id)
    const path = candidateId ? guidance.candidates.find(candidate => candidate.id === candidateId)?.path : guidance.application.path
    if (!path)
      throw new SoftwareOperationError(404, 'The candidate is no longer available. Refresh the application.')
    await this.revealFile(path)
    return { version: 1, destination: 'finder' }
  }

  private async application(id: string): Promise<MaintainedApplication> {
    if (!identifier.safeParse(id).success)
      throw new SoftwareOperationError(400, 'Invalid application identifier')
    const snapshot = await this.snapshot()
    if (!snapshot.supported)
      throw new SoftwareOperationError(503, 'Application inspection requires macOS')
    const application = snapshot.applications.find(application => application.id === id)
    if (!application)
      throw new SoftwareOperationError(404, 'The application is no longer available. Refresh the list.')
    return application
  }
}

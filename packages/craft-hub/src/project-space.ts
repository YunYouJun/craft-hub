import type { Stats } from 'node:fs'
import type { ProjectRecord } from './types'
import { lstat, opendir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Directory-name hints for explaining usage, never a statement that files can be deleted. */
export type ProjectSpaceCategory = 'dependencies' | 'build' | 'cache' | 'git' | 'other'

/** A bounded scan diagnostic; paths are relative to the registered project. */
export interface ProjectSpaceIssue {
  path: string
  reason: 'entry-limit' | 'time-limit' | 'depth-limit' | 'unreadable' | 'changed' | 'different-volume'
}

/** Measured logical file bytes in one top-level project entry. */
export interface ProjectSpaceEntry {
  path: string
  kind: 'directory' | 'file'
  bytes: number
  fileCount: number
  incomplete: boolean
}

/** Metadata-only project usage. Hard links count once; symlinks and other volumes are excluded. */
export interface ProjectSpaceSnapshot {
  projectId: string
  checkedAt: string
  durationMs: number
  status: 'complete' | 'partial'
  totalBytes: number
  fileCount: number
  scannedEntries: number
  skippedSymlinks: number
  skippedSpecialFiles: number
  duplicateFiles: number
  categories: Array<{ category: ProjectSpaceCategory, bytes: number, fileCount: number }>
  entries: ProjectSpaceEntry[]
  omittedEntries: number
  issues: ProjectSpaceIssue[]
  omittedIssues: number
  limits: { maxEntries: number, maxDurationMs: number, maxDepth: number }
}

/** Local inspection errors with an HTTP-compatible status. */
export class ProjectSpaceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const directoryCategories = new Map<string, ProjectSpaceCategory>([
  ['node_modules', 'dependencies'],
  ['.venv', 'dependencies'],
  ['venv', 'dependencies'],
  ['dist', 'build'],
  ['build', 'build'],
  ['target', 'build'],
  ['.build', 'build'],
  ['.next', 'build'],
  ['.nuxt', 'build'],
  ['.output', 'build'],
  ['coverage', 'build'],
  ['.cache', 'cache'],
  ['.turbo', 'cache'],
  ['.vite', 'cache'],
  ['__pycache__', 'cache'],
  ['.git', 'git'],
])

/** Inspect metadata inside one canonical registered root on demand, without running project code. */
export async function scanProjectSpace(project: Pick<ProjectRecord, 'id' | 'path'>, options: {
  signal?: AbortSignal
  maxEntries?: number
  maxDurationMs?: number
  maxDepth?: number
} = {}): Promise<ProjectSpaceSnapshot> {
  const started = performance.now()
  const limits = { maxEntries: options.maxEntries ?? 50_000, maxDurationMs: options.maxDurationMs ?? 5000, maxDepth: options.maxDepth ?? 48 }
  const snapshot: ProjectSpaceSnapshot = {
    projectId: project.id,
    checkedAt: new Date().toISOString(),
    durationMs: 0,
    status: 'complete',
    totalBytes: 0,
    fileCount: 0,
    scannedEntries: 0,
    skippedSymlinks: 0,
    skippedSpecialFiles: 0,
    duplicateFiles: 0,
    categories: (['dependencies', 'build', 'cache', 'git', 'other'] as const).map(category => ({ category, bytes: 0, fileCount: 0 })),
    entries: [],
    omittedEntries: 0,
    issues: [],
    omittedIssues: 0,
    limits,
  }
  options.signal?.throwIfAborted()
  const root = resolve(project.path)
  let rootMetadata: Stats
  try {
    rootMetadata = await lstat(root)
    if (!rootMetadata.isDirectory() || await realpath(root) !== root)
      throw new ProjectSpaceError(409, 'The registered project directory changed. Register its current location again.')
  }
  catch (error) {
    if (error instanceof ProjectSpaceError)
      throw error
    throw new ProjectSpaceError(409, 'The registered project directory is unavailable.')
  }
  const entries = new Map<string, ProjectSpaceEntry>()
  const files = new Set<string>()
  let stopped = false

  function issue(path: string, reason: ProjectSpaceIssue['reason']): void {
    snapshot.status = 'partial'
    if (snapshot.issues.length < 12)
      snapshot.issues.push({ path, reason })
    else
      snapshot.omittedIssues++
    const entry = entries.get(path.split('/')[0]!)
    if (entry)
      entry.incomplete = true
  }

  function withinBudget(path: string): boolean {
    options.signal?.throwIfAborted()
    if (stopped)
      return false
    const reason = performance.now() - started >= limits.maxDurationMs
      ? 'time-limit'
      : snapshot.scannedEntries >= limits.maxEntries ? 'entry-limit' : undefined
    if (reason) {
      issue(path, reason)
      stopped = true
    }
    return !stopped
  }

  async function walk(directory: string, depth: number, inheritedCategory: ProjectSpaceCategory): Promise<void> {
    const directoryPath = relative(root, directory).split(sep).join('/') || '.'
    if (!withinBudget(directoryPath))
      return
    if (depth > limits.maxDepth) {
      issue(directoryPath, 'depth-limit')
      return
    }
    try {
      // Best-effort revalidation, not an atomic filesystem snapshot.
      const metadata = await lstat(directory)
      const canonical = await realpath(directory)
      const contained = relative(root, canonical)
      if (!metadata.isDirectory() || canonical !== directory || contained.startsWith(`..${sep}`) || contained === '..' || isAbsolute(contained)
        || (depth === 0 && (metadata.dev !== rootMetadata.dev || metadata.ino !== rootMetadata.ino))) {
        issue(directoryPath, 'changed')
        return
      }
      const handle = await opendir(directory)
      for await (const child of handle) {
        const path = join(directory, child.name)
        const portablePath = relative(root, path).split(sep).join('/')
        if (!withinBudget(portablePath))
          break
        snapshot.scannedEntries++
        try {
          const childMetadata = await lstat(path)
          if (childMetadata.isSymbolicLink()) {
            snapshot.skippedSymlinks++
            continue
          }
          if (!childMetadata.isFile() && !childMetadata.isDirectory()) {
            snapshot.skippedSpecialFiles++
            continue
          }
          const topPath = portablePath.split('/')[0]!
          const entry = entries.get(topPath) ?? {
            path: topPath,
            kind: childMetadata.isDirectory() ? 'directory' : 'file',
            bytes: 0,
            fileCount: 0,
            incomplete: false,
          } satisfies ProjectSpaceEntry
          entries.set(topPath, entry)
          if (childMetadata.dev !== rootMetadata.dev) {
            issue(portablePath, 'different-volume')
            continue
          }
          if (childMetadata.isDirectory()) {
            const category = inheritedCategory === 'other' ? directoryCategories.get(child.name) ?? 'other' : inheritedCategory
            await walk(path, depth + 1, category)
          }
          else {
            const identity = `${childMetadata.dev}:${childMetadata.ino}`
            if (files.has(identity)) {
              snapshot.duplicateFiles++
              continue
            }
            files.add(identity)
            const category = snapshot.categories.find(item => item.category === inheritedCategory)!
            category.bytes += childMetadata.size
            category.fileCount++
            entry.bytes += childMetadata.size
            entry.fileCount++
            snapshot.totalBytes += childMetadata.size
            snapshot.fileCount++
          }
        }
        catch (error) {
          options.signal?.throwIfAborted()
          issue(portablePath, (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'changed' : 'unreadable')
        }
      }
    }
    catch (error) {
      options.signal?.throwIfAborted()
      issue(directoryPath, (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'changed' : 'unreadable')
    }
  }

  await walk(root, 0, 'other')
  options.signal?.throwIfAborted()
  snapshot.entries = [...entries.values()].sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)).slice(0, 12)
  snapshot.omittedEntries = Math.max(0, entries.size - snapshot.entries.length)
  snapshot.durationMs = Math.round(performance.now() - started)
  return snapshot
}

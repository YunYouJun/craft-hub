import type { FSWatcher } from 'chokidar'
import type { ProjectRecord } from './types'
import { realpath } from 'node:fs/promises'
import { extname, matchesGlob, relative, sep } from 'node:path'
import chokidar from 'chokidar'

/** Semantic area affected by a project file change. */
export type ProjectChangeScope = 'capabilities' | 'overview' | 'project'

/** Coalesced project change notification. */
export interface ProjectChangeEvent {
  projectId: string
  scopes: ProjectChangeScope[]
}

/** Listener notified after project changes are coalesced. */
export type ProjectChangeListener = (event: ProjectChangeEvent) => void

const rootCapabilityFiles = new Set(['Makefile', 'Taskfile.yaml', 'Taskfile.yml', 'package.json', 'pnpm-workspace.yaml'])
const skillRoots = ['.agents/skills', '.claude/skills', '.codex/skills']
const ignoredDirectoryNames = new Set([
  '.cache',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.venv',
  'DerivedData',
  'Pods',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor',
  'venv',
])
const projectWatchDepth = 4
const projectConfigPaths = new Set(['.craft-hub/project.jsonc'])

function normalizedRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

/** Return whether a project-relative change can affect discovery or an auto-activation matcher. */
export function isRelevantProjectPath(path: string, activationPatterns: readonly string[] = []): boolean {
  if (!path)
    return false
  if (rootCapabilityFiles.has(path) || path.endsWith('/package.json') || path === '.craft-hub' || projectConfigPaths.has(path))
    return true
  if (/(?:^|\/)readme(?:\.(?:md|markdown|mdown))?$/i.test(path))
    return true
  return skillRoots.some(root => path === root || path.startsWith(`${root}/`) || root.startsWith(`${path}/`))
    || activationPatterns.some(pattern => matchesGlob(path, pattern))
}

function scopesForPath(path: string): ProjectChangeScope[] {
  if (projectConfigPaths.has(path))
    return ['capabilities', 'project', 'overview']
  if (/(?:^|\/)readme(?:\.(?:md|markdown|mdown))?$/i.test(path))
    return ['overview']
  return ['capabilities']
}

/** Watch registered projects and emit coalesced semantic change events. */
export class ProjectWatcher {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly pending = new Map<string, Set<ProjectChangeScope>>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly activationPatterns = new Map<string, string[]>()

  constructor(
    private readonly listener: ProjectChangeListener,
    private readonly debounceMs = 200,
  ) {}

  /** Begin watching a project. Repeated calls for the same project are ignored. */
  async watch(project: ProjectRecord): Promise<void> {
    if (this.watchers.has(project.id))
      return

    const watchRoot = await realpath(project.path)
    const watcher = chokidar.watch(watchRoot, {
      atomic: true,
      depth: projectWatchDepth,
      followSymlinks: false,
      ignoreInitial: true,
      ignored: (path, stats) => {
        const relativePath = normalizedRelativePath(watchRoot, path)
        if (relativePath.split('/').some(part => ignoredDirectoryNames.has(part)))
          return true
        if (stats?.isDirectory() || (!stats && !extname(relativePath)))
          return false
        return !isRelevantProjectPath(relativePath, this.activationPatterns.get(project.id))
      },
    })
    this.watchers.set(project.id, watcher)
    watcher.on('all', (event, path) => {
      if (event === 'addDir' || event === 'unlinkDir')
        return
      this.queue(project.id, normalizedRelativePath(watchRoot, path))
    })
    watcher.on('error', () => {})
    await new Promise<void>((resolvePromise) => {
      watcher.once('ready', resolvePromise)
    })
  }

  /** Stop every watcher and discard pending events. */
  async close(): Promise<void> {
    for (const timer of this.timers.values())
      clearTimeout(timer)
    this.timers.clear()
    this.pending.clear()
    this.activationPatterns.clear()
    await Promise.all([...this.watchers.values()].map(watcher => watcher.close()))
    this.watchers.clear()
  }

  /** Stop watching one registered project. */
  async unwatch(projectId: string): Promise<void> {
    const watcher = this.watchers.get(projectId)
    if (!watcher)
      return
    const timer = this.timers.get(projectId)
    if (timer)
      clearTimeout(timer)
    this.timers.delete(projectId)
    this.pending.delete(projectId)
    this.activationPatterns.delete(projectId)
    this.watchers.delete(projectId)
    await watcher.close()
  }

  private queue(projectId: string, path: string): void {
    if (!isRelevantProjectPath(path, this.activationPatterns.get(projectId)))
      return
    const scopes = this.pending.get(projectId) ?? new Set<ProjectChangeScope>()
    for (const scope of scopesForPath(path))
      scopes.add(scope)
    this.pending.set(projectId, scopes)

    const currentTimer = this.timers.get(projectId)
    if (currentTimer)
      clearTimeout(currentTimer)
    this.timers.set(projectId, setTimeout(() => this.flush(projectId), this.debounceMs))
  }

  /** Replace bounded Marketplace Skill marker patterns for one watched project. */
  setCapabilityPatterns(projectId: string, patterns: string[]): void {
    this.activationPatterns.set(projectId, [...new Set(patterns)])
  }

  private flush(projectId: string): void {
    const scopes = this.pending.get(projectId)
    this.pending.delete(projectId)
    this.timers.delete(projectId)
    if (scopes?.size)
      this.listener({ projectId, scopes: [...scopes].sort() })
  }
}

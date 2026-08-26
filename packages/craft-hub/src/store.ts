import type { AgentTaskRecord, CapabilityReference, ProjectRecord, RunCleanupOptions, RunCleanupResult, RunRecord } from './types'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return fallback
    throw error
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

/** Minimal persistence seam so JSON can later be replaced by SQLite. */
export class CraftHubStore {
  private workspaceStateTail: Promise<void> = Promise.resolve()

  constructor(readonly dataDir: string) {}

  async listProjects(): Promise<ProjectRecord[]> {
    return readJson(join(this.dataDir, 'projects.json'), [])
  }

  async saveProjects(projects: ProjectRecord[]): Promise<void> {
    await writeJsonAtomic(join(this.dataDir, 'projects.json'), projects)
  }

  async saveRun(run: RunRecord): Promise<void> {
    await writeJsonAtomic(join(this.dataDir, 'runs', `${run.id}.json`), run)
  }

  async saveAgentTask(task: AgentTaskRecord): Promise<void> {
    await writeJsonAtomic(join(this.dataDir, 'agent-tasks', `${task.id}.json`), task)
  }

  async getAgentTask(id: string): Promise<AgentTaskRecord | undefined> {
    return readJson<AgentTaskRecord | undefined>(join(this.dataDir, 'agent-tasks', `${id}.json`), undefined)
  }

  async listAgentTasks(): Promise<AgentTaskRecord[]> {
    const directory = join(this.dataDir, 'agent-tasks')
    try {
      const names = (await readdir(directory)).filter(name => name.endsWith('.json'))
      const tasks = await Promise.all(names.map(name => readJson<AgentTaskRecord | undefined>(join(directory, name), undefined)))
      return tasks.filter((task): task is AgentTaskRecord => Boolean(task)).sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return []
      throw error
    }
  }

  async getRun(id: string): Promise<RunRecord | undefined> {
    return readJson<RunRecord | undefined>(join(this.dataDir, 'runs', `${id}.json`), undefined)
  }

  async listRuns(): Promise<RunRecord[]> {
    const directory = join(this.dataDir, 'runs')
    try {
      const names = (await readdir(directory)).filter(name => name.endsWith('.json'))
      const runs = await Promise.all(names.map(name => readJson<RunRecord | undefined>(join(directory, name), undefined)))
      return runs.filter((run): run is RunRecord => Boolean(run)).sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return []
      throw error
    }
  }

  async setRunPinned(id: string, pinned: boolean): Promise<RunRecord> {
    const run = await this.getRun(id)
    if (!run)
      throw new Error(`Unknown run: ${id}`)
    run.pinned = pinned || undefined
    await this.saveRun(run)
    return run
  }

  /** Preview or delete completed, unpinned run records matching retention filters. */
  async cleanupRuns(options: RunCleanupOptions): Promise<RunCleanupResult> {
    const directory = join(this.dataDir, 'runs')
    const projectIds = options.projectIds ? new Set(options.projectIds) : undefined
    const runs = (await this.listRuns()).filter(run => run.status !== 'running' && !run.pinned && (!projectIds || projectIds.has(run.projectId)))
    const selected = new Map<string, { run: RunRecord, bytes: number }>()
    for (const run of runs) {
      if (options.includeAllUnpinned || (options.olderThan && run.startedAt < options.olderThan)) {
        const path = join(directory, `${run.id}.json`)
        selected.set(run.id, { run, bytes: await fileSize(path) })
      }
    }

    if (options.maxBytes !== undefined) {
      const candidates = await Promise.all(runs.map(async run => ({ run, bytes: await fileSize(join(directory, `${run.id}.json`)) })))
      let total = candidates.reduce((sum, item) => sum + item.bytes, 0)
      for (const candidate of candidates.sort((left, right) => left.run.startedAt.localeCompare(right.run.startedAt))) {
        if (total <= options.maxBytes)
          break
        selected.set(candidate.run.id, candidate)
        total -= candidate.bytes
      }
    }

    const deletedIds = [...selected.keys()]
    const bytes = [...selected.values()].reduce((sum, item) => sum + item.bytes, 0)
    if (!options.preview)
      await Promise.all(deletedIds.map(id => rm(join(directory, `${id}.json`), { force: true })))
    return { count: deletedIds.length, bytes, deletedIds }
  }

  async applyDefaultRunRetention(now = new Date()): Promise<RunCleanupResult> {
    const olderThan = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    return this.cleanupRuns({ olderThan, maxBytes: 500 * 1024 * 1024 })
  }

  /** Read one project's machine-local semantic pin order. */
  async getCapabilityPins(projectId: string): Promise<CapabilityReference[]> {
    const state = await readJson<WorkspaceState>(join(this.dataDir, 'workspace-state.json'), emptyWorkspaceState())
    return Array.isArray(state.capabilityPins?.[projectId]) ? state.capabilityPins[projectId] : []
  }

  /** Atomically replace one project's machine-local semantic pin order. */
  async saveCapabilityPins(projectId: string, pins: CapabilityReference[]): Promise<void> {
    const operation = this.workspaceStateTail.then(async () => {
      const path = join(this.dataDir, 'workspace-state.json')
      const state = await readJson<WorkspaceState>(path, emptyWorkspaceState())
      await writeJsonAtomic(path, {
        version: 1,
        capabilityPins: { ...state.capabilityPins, [projectId]: pins },
      } satisfies WorkspaceState)
    })
    this.workspaceStateTail = operation.catch(() => {})
    return operation
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return 0
    throw error
  }
}

interface WorkspaceState {
  version: 1
  capabilityPins: Record<string, CapabilityReference[]>
}

function emptyWorkspaceState(): WorkspaceState {
  return { version: 1, capabilityPins: {} }
}

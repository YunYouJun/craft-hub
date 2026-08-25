import type { ProjectRecord, RunRecord } from './types'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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

  async getRun(id: string): Promise<RunRecord | undefined> {
    return readJson<RunRecord | undefined>(join(this.dataDir, 'runs', `${id}.json`), undefined)
  }
}

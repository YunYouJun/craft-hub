import type { TodayFocusSnapshot } from 'craft-hub'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

/** Display-only v1 export consumed by optional resident companions. */
export interface CompanionSummary {
  version: 1
  checkedAt: string
  total: number
  sourceCount: number
  loadedSourceCount: number
  completeSourceCount: number
  items: { id: string, title: string, sourceTitle: string }[]
}

/** A deliberately bounded, credential-free cache for an optional native companion. */
export function companionSummary(snapshot: TodayFocusSnapshot): CompanionSummary {
  return {
    version: 1 as const,
    checkedAt: snapshot.checkedAt,
    total: snapshot.total,
    sourceCount: snapshot.sourceCount,
    loadedSourceCount: snapshot.sources.filter(source => source.state === 'loaded').length,
    completeSourceCount: snapshot.sources.filter(source => source.state === 'loaded' && source.complete).length,
    items: snapshot.items.slice(0, 5).map(item => ({
      id: item.key,
      title: item.title.slice(0, 1000),
      sourceTitle: item.sourceTitle.slice(0, 300),
    })),
  }
}

async function atomicPrivateJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  }
  finally {
    await rm(temporary, { force: true })
  }
}

/** Owns only the explicitly selected export file, never a second runtime or another application's profile. */
export class CompanionSummaryPublisher {
  private target?: string
  private pending = Promise.resolve()
  private latest = ''
  private readonly configurationPath: string

  constructor(configurationPath: string) {
    this.configurationPath = configurationPath
  }

  get enabled(): boolean {
    return this.target !== undefined
  }

  async restore(): Promise<void> {
    try {
      const text = await readFile(this.configurationPath, 'utf8')
      if (text.length > 8192)
        return
      const config = JSON.parse(text) as { path?: unknown }
      if (typeof config.path === 'string' && isAbsolute(config.path) && config.path.endsWith('.json')
        && resolve(config.path) !== resolve(this.configurationPath)) {
        this.target = config.path
      }
    }
    catch { /* Missing or invalid preferences leave sharing disabled. */ }
  }

  async share(path: string, snapshot: TodayFocusSnapshot): Promise<void> {
    if (!isAbsolute(path) || !path.endsWith('.json') || resolve(path) === resolve(this.configurationPath))
      throw new Error('Choose a separate JSON file for the shared summary')
    await this.pending
    // A failed export does not enable sharing or discard the previous successful target.
    await atomicPrivateJson(path, companionSummary(snapshot))
    await atomicPrivateJson(this.configurationPath, { path })
    this.target = path
    this.latest = snapshot.checkedAt
  }

  publish(snapshot: TodayFocusSnapshot): Promise<void> {
    const target = this.target
    if (!target || snapshot.checkedAt < this.latest)
      return Promise.resolve()
    this.latest = snapshot.checkedAt
    const operation = this.pending.then(() => atomicPrivateJson(target, companionSummary(snapshot)))
    this.pending = operation.catch(() => {})
    return operation
  }

  async stop(): Promise<void> {
    this.target = undefined
    await this.pending
    await rm(this.configurationPath, { force: true })
    // The user-selected export remains a dated snapshot until the user removes it.
  }
}

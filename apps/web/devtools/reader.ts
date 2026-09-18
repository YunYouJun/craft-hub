import type { CapabilityDiscoveryResult, ProjectCatalogSnapshot, RunRecord, RuntimeHealth, WorkbenchDiagnosticSnapshot } from 'craft-hub'
import type { InspectorReader, InspectorSnapshot } from './types.ts'
import { z } from 'zod'

const runtimeOrigin = 'http://127.0.0.1:4318'
export const projectIdSchema = z.string().min(1).max(200).regex(/^[\w-]+$/)

/** Read the running development host through a fixed, GET-only API surface. */
export function createInspectorReader(fetcher: typeof fetch = fetch): InspectorReader {
  async function read<T>(path: string): Promise<T> {
    const response = await fetcher(`${runtimeOrigin}${path}`, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
      headers: { accept: 'application/json' },
    })
    if (!response.ok)
      throw new Error(`Runtime returned HTTP ${response.status} for ${path}`)
    return response.json() as Promise<T>
  }

  return {
    async snapshot() {
      const snapshot: InspectorSnapshot = {
        checkedAt: new Date().toISOString(),
        catalog: { projects: [], diagnostics: [] },
        runs: [],
        errors: [],
      }
      async function section(name: string, load: () => Promise<void>): Promise<void> {
        try {
          await load()
        }
        catch (error) {
          snapshot.errors.push({ section: name, message: error instanceof Error ? error.message : String(error) })
        }
      }
      await Promise.all([
        section('Runtime', async () => { snapshot.health = await read<RuntimeHealth>('/api/health') }),
        section('Projects', async () => { snapshot.catalog = await read<ProjectCatalogSnapshot>('/api/projects') }),
        section('Diagnostics', async () => { snapshot.diagnostics = await read<WorkbenchDiagnosticSnapshot>('/api/diagnostics') }),
        section('Runs', async () => {
          const runs = await read<RunRecord[]>('/api/runs')
          // Keep the wire payload bounded and omit potentially large command output.
          snapshot.runs = runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 30).map(({ id, projectId, capabilityId, command, args, cwd, startedAt, finishedAt, exitCode, status }) => ({
            id,
            projectId,
            capabilityId,
            command,
            args,
            cwd,
            startedAt,
            finishedAt,
            exitCode,
            status,
          }))
        }),
      ])
      snapshot.errors.sort((a, b) => a.section.localeCompare(b.section))
      return snapshot
    },
    discover(projectId) {
      return read<CapabilityDiscoveryResult>(`/api/projects/${encodeURIComponent(projectIdSchema.parse(projectId))}/capability-discovery`)
    },
  }
}

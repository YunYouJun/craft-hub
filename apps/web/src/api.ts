import type { Capability, ProjectRecord, RunRecord } from 'craft-hub'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = await response.json() as T & { error?: string }
  if (!response.ok)
    throw new Error(body.error ?? `Request failed: ${response.status}`)
  return body
}

export const api = {
  projects: () => request<ProjectRecord[]>('/api/projects'),
  addProject: (path: string) => request<ProjectRecord>('/api/projects', { method: 'POST', body: JSON.stringify({ path }) }),
  capabilities: (projectId: string) => request<Capability[]>(`/api/projects/${projectId}/capabilities`),
  trust: (projectId: string) => request<ProjectRecord>(`/api/projects/${projectId}/trust`, { method: 'POST' }),
  run: (projectId: string, capabilityId: string) => request<RunRecord>(`/api/projects/${projectId}/run`, {
    method: 'POST',
    body: JSON.stringify({ capabilityId }),
  }),
}

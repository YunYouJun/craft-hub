export interface CloudDevice {
  deviceId: string
  name: string
  platform: string
  lastSeenAt: number
  revokedAt?: number
}

export interface CloudRequest {
  requestId: string
  targetDeviceId: string
  projectKey: string
  capabilityId: string
  status: string
  createdAt: number
  expiresAt: string
  exitCode?: number | null
  finishedAt?: string
}

const endpoint = import.meta.env.VITE_CLOUD_API_URL

export class CloudApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'CloudApiError'
  }
}

export async function cloudRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(new URL(path, endpoint), {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init.headers },
  })
  const body = await response.json() as T & { error?: string, message?: string }
  if (!response.ok)
    throw new CloudApiError(body.message ?? body.error ?? `请求失败：${response.status}`, response.status)
  return body
}

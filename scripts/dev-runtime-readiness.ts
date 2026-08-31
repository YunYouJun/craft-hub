import { setTimeout as delay } from 'node:timers/promises'

export interface RuntimeReadinessOptions {
  fetch?: typeof globalThis.fetch
  intervalMs?: number
  requestTimeoutMs?: number
  timeoutMs?: number
}

/** Wait until the development Runtime health endpoint reports an OK status. */
export async function waitForRuntimeReady(url: string, options: RuntimeReadinessOptions = {}): Promise<void> {
  const fetchHealth = options.fetch ?? globalThis.fetch
  const intervalMs = options.intervalMs ?? 100
  const requestTimeoutMs = options.requestTimeoutMs ?? 1_000
  const timeoutMs = options.timeoutMs ?? 10_000
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  do {
    try {
      const remainingMs = Math.max(1, deadline - Date.now())
      const response = await fetchHealth(url, {
        signal: AbortSignal.timeout(Math.min(requestTimeoutMs, remainingMs)),
      })
      const health = response.ok ? await response.json() as { status?: unknown } : undefined
      if (health?.status === 'ok')
        return
      lastError = new Error(`Runtime health check returned HTTP ${response.status}`)
    }
    catch (error) {
      lastError = error
    }

    if (Date.now() >= deadline)
      break
    await delay(Math.min(intervalMs, Math.max(0, deadline - Date.now())))
  } while (Date.now() <= deadline)

  throw new Error(`Runtime did not become ready at ${url}`, { cause: lastError })
}

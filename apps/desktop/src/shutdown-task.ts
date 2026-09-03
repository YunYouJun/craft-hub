/**
 * Defer a task until its promise has been registered, then reuse that promise
 * for every later request. The deferral prevents synchronous lifecycle events
 * triggered by the task from starting it a second time.
 */
export function createDeferredOnceTask(task: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | undefined
  return () => {
    pending ??= Promise.resolve().then(task)
    return pending
  }
}

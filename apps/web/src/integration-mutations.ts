import { shallowRef } from 'vue'

const pending = shallowRef(0)
let publication = Promise.resolve()

/** Whether a confirmed integration request still needs its outcome. */
export function integrationMutationPending(): boolean {
  return pending.value > 0
}

function publish(): Promise<void> | undefined {
  const report = typeof window === 'undefined' ? undefined : window.craftHubDesktop?.setWorkbenchOperationPending
  if (!report)
    return
  const next = publication.catch(() => {}).then(() => report(pending.value > 0))
  publication = next
  return next
}

/** Keep browser and native navigation idle until all concurrent confirmed requests settle. */
export async function withIntegrationMutation<T>(operation: () => Promise<T>): Promise<T> {
  pending.value++
  try {
    const started = publish()
    if (started)
      await started
    return await operation()
  }
  finally {
    pending.value--
    const settled = publish()
    if (settled)
      await settled.catch(() => {})
  }
}

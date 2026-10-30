import type { ShallowRef } from 'vue'
import type { ActionToastMessage } from './types'
import { shallowRef } from 'vue'

export { default as ActionToast } from './ActionToast.vue'

/** Shared transient action feedback; callers supply display-safe copy, never copied values. */
export function useActionToast(): { message: ShallowRef<ActionToastMessage | undefined>, notify: (title: string, error?: boolean) => void } {
  const message = shallowRef<ActionToastMessage>()
  function notify(title: string, error = false): void {
    message.value = { id: (message.value?.id ?? 0) + 1, title, error }
  }
  return { message, notify }
}

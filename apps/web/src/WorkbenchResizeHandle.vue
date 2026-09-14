<script setup lang="ts">
import { SplitterResizeHandle } from 'reka-ui'
import { nextTick } from 'vue'

defineProps<{ label: string }>()
const emit = defineEmits<{ resizeEnd: [] }>()

async function finishResize(): Promise<void> {
  await nextTick()
  emit('resizeEnd')
}

function onKeyup(event: KeyboardEvent): void {
  // Reka handles keydown itself; save after that event has completed in the browser.
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'].includes(event.key))
    void finishResize()
}
</script>

<template>
  <SplitterResizeHandle class="workbench-resize-handle" :aria-label="label" :title="label" @dragging="dragging => !dragging && finishResize()" @keyup="onKeyup">
    <span class="splitter-grip" aria-hidden="true" />
  </SplitterResizeHandle>
</template>

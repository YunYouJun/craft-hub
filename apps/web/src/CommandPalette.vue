<script setup lang="ts">
import { computed, ref } from 'vue'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Icon } from './icons'
import { useWorkbenchStore } from './store'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const store = useWorkbenchStore()
const query = ref('')
const matches = computed(() => {
  const [projectQuery, capabilityQuery] = query.value.includes(':')
    ? query.value.toLowerCase().split(':', 2)
    : ['', query.value.toLowerCase()]
  return store.paletteItems
    .filter(item => (!projectQuery || item.project.name.toLowerCase().includes(projectQuery))
      && `${item.capability.name} ${item.capability.description ?? ''}`.toLowerCase().includes(capabilityQuery ?? ''))
    .sort((left, right) => Number(right.project.id === store.selectedProjectId) - Number(left.project.id === store.selectedProjectId))
    .slice(0, 9)
})

async function select(projectId: string, capabilityId: string): Promise<void> {
  if (projectId !== store.selectedProjectId)
    await store.selectProject(projectId)
  store.selectedCapabilityId = capabilityId
  emit('update:open', false)
}
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="palette-overlay" />
      <DialogContent class="command-palette">
        <DialogTitle class="sr-only">Project Palette</DialogTitle>
        <label class="palette-search"><Icon name="search" /><input v-model="query" autofocus placeholder="Type a command or skill…"><kbd>⌘K</kbd></label>
        <small>Current project first · type project:query to search across projects</small>
        <button v-for="item in matches" :key="`${item.project.id}:${item.capability.id}`" @click="select(item.project.id, item.capability.id)">
          <Icon :name="item.capability.kind === 'command' ? 'terminal' : 'skill'" />
          <strong>{{ item.capability.name }}</strong><span>{{ item.project.id === store.selectedProjectId ? item.capability.source : `${item.project.name} · ${item.capability.source}` }}</span>
        </button>
        <footer><kbd>↑</kbd><kbd>↓</kbd> Navigate <span>↵ Select</span><span><kbd>esc</kbd> Close</span></footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

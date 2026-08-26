<script setup lang="ts">
import { computed, ref } from 'vue'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const store = useWorkbenchStore()
const { t } = useI18n()
const query = ref('')
const matches = computed(() => {
  const [projectQuery, capabilityQuery] = query.value.includes(':')
    ? query.value.toLowerCase().split(':', 2)
    : ['', query.value.toLowerCase()]
  return store.paletteItems
    .filter(item => (!projectQuery || item.project.name.toLowerCase().includes(projectQuery))
      && `${item.capability.name} ${item.capability.description ?? ''}`.toLowerCase().includes(capabilityQuery ?? ''))
    .sort((left, right) => {
      const matchDifference = matchScore(right.capability.name, right.capability.description, capabilityQuery ?? '')
        - matchScore(left.capability.name, left.capability.description, capabilityQuery ?? '')
      if (matchDifference)
        return matchDifference
      const projectDifference = Number(right.project.id === store.selectedProjectId) - Number(left.project.id === store.selectedProjectId)
      if (projectDifference)
        return projectDifference
      const pinDifference = Number(store.isCapabilityPinned(right.project.id, right.capability.id))
        - Number(store.isCapabilityPinned(left.project.id, left.capability.id))
      return pinDifference || left.capability.name.localeCompare(right.capability.name)
    })
    .slice(0, 9)
})

function matchScore(name: string, description: string | undefined, query: string): number {
  if (!query)
    return 0
  const normalizedName = name.toLowerCase()
  if (normalizedName === query)
    return 3
  if (normalizedName.startsWith(query))
    return 2
  if (normalizedName.includes(query))
    return 1
  return description?.toLowerCase().includes(query) ? 0 : -1
}

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
        <DialogTitle class="sr-only">{{ t('projectPalette') }}</DialogTitle>
        <label class="palette-search"><Icon name="search" /><input v-model="query" autofocus :placeholder="t('typeCapability')"><kbd>⌘K</kbd></label>
        <small>{{ t('currentProjectFirst') }}</small>
        <button v-for="item in matches" :key="`${item.project.id}:${item.capability.id}`" @click="select(item.project.id, item.capability.id)">
          <Icon :name="item.capability.kind === 'command' ? 'terminal' : 'skill'" />
          <strong>{{ item.capability.name }}</strong><span>{{ item.project.id === store.selectedProjectId ? item.capability.source : `${item.project.name} · ${item.capability.source}` }}</span>
        </button>
        <footer><kbd>↑</kbd><kbd>↓</kbd> {{ t('navigate') }} <span>↵ {{ t('select') }}</span><span><kbd>esc</kbd> {{ t('close') }}</span></footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { onBeforeMount, onBeforeUnmount, ref } from 'vue'
import CapabilityList from './CapabilityList.vue'
import CommandPalette from './CommandPalette.vue'
import DetailPanel from './DetailPanel.vue'
import ProjectRail from './ProjectRail.vue'
import { useWorkbenchStore } from './store'

const store = useWorkbenchStore()
const paletteOpen = ref(false)

function onKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    paletteOpen.value = !paletteOpen.value
  }
}

onBeforeMount(async () => {
  window.addEventListener('keydown', onKeydown)
  await store.loadProjects()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="app-shell">
    <ProjectRail />
    <CapabilityList />
    <DetailPanel />
    <footer class="status-bar"><span><i /> Ready</span><span v-if="store.selectedProject">Project: {{ store.selectedProject.name }}</span></footer>
    <CommandPalette v-model:open="paletteOpen" />
  </div>
</template>

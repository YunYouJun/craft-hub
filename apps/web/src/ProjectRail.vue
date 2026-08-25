<script setup lang="ts">
import { Icon } from './icons'
import { useWorkbenchStore } from './store'

const store = useWorkbenchStore()

async function addProject() {
  const path = window.prompt('Absolute path to a local project')
  if (path)
    await store.addProject(path)
}
</script>

<template>
  <aside class="project-rail">
    <div class="brand-mark" aria-label="Craft Hub"><Icon name="hub" /></div>
    <div class="rail-content">
      <h1>Projects</h1>
      <button
        v-for="project in store.projects"
        :key="project.id"
        class="project-row"
        :class="{ selected: project.id === store.selectedProjectId }"
        @click="store.selectProject(project.id)"
      >
        <Icon name="folder" />
        <span>{{ project.name }}</span>
        <i :class="project.trust" :title="project.trust" />
      </button>
      <button class="add-project" @click="addProject">
        <Icon name="plus" /> Add project
      </button>
    </div>
  </aside>
</template>

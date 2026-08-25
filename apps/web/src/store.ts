import type { Capability, ProjectRecord, RunRecord } from 'craft-hub'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from './api'

export const useWorkbenchStore = defineStore('workbench', () => {
  const projects = ref<ProjectRecord[]>([])
  const selectedProjectId = ref('')
  const capabilities = ref<Capability[]>([])
  const paletteItems = ref<Array<{ project: ProjectRecord, capability: Capability }>>([])
  const selectedCapabilityId = ref('')
  const run = ref<RunRecord>()
  const busy = ref(false)
  const error = ref('')

  const selectedProject = computed(() => projects.value.find(item => item.id === selectedProjectId.value))
  const selectedCapability = computed(() => capabilities.value.find(item => item.id === selectedCapabilityId.value))

  async function loadProjects(): Promise<void> {
    projects.value = await api.projects()
    const groups = await Promise.all(projects.value.map(async project => ({
      project,
      capabilities: await api.capabilities(project.id),
    })))
    paletteItems.value = groups.flatMap(group => group.capabilities.map(capability => ({ project: group.project, capability })))
    if (!selectedProjectId.value && projects.value[0])
      await selectProject(projects.value[0].id)
  }

  async function selectProject(id: string): Promise<void> {
    selectedProjectId.value = id
    capabilities.value = await api.capabilities(id)
    selectedCapabilityId.value = capabilities.value[0]?.id ?? ''
    run.value = undefined
  }

  async function addProject(path: string): Promise<void> {
    const project = await api.addProject(path)
    await loadProjects()
    await selectProject(project.id)
  }

  async function trustProject(): Promise<void> {
    if (!selectedProject.value)
      return
    const updated = await api.trust(selectedProject.value.id)
    projects.value = projects.value.map(project => project.id === updated.id ? updated : project)
  }

  async function runSelected(): Promise<void> {
    if (!selectedProject.value || selectedCapability.value?.kind !== 'command')
      return
    busy.value = true
    error.value = ''
    try {
      run.value = await api.run(selectedProject.value.id, selectedCapability.value.id)
    }
    catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
    }
    finally {
      busy.value = false
    }
  }

  return {
    projects,
    selectedProjectId,
    capabilities,
    paletteItems,
    selectedCapabilityId,
    selectedProject,
    selectedCapability,
    run,
    busy,
    error,
    loadProjects,
    selectProject,
    addProject,
    trustProject,
    runSelected,
  }
})

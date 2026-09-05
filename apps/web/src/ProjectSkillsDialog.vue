<script setup lang="ts">
import type { LocalSkillActivationSettings, ProjectSkillStatus, ProjectSkillsState } from 'craft-hub'
import { computed, ref, watch } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const store = useWorkbenchStore()
const { t } = useI18n()
const state = ref<ProjectSkillsState>()
const loading = ref(false)
const error = ref('')
const groups = computed(() => {
  const grouped = new Map<string, ProjectSkillStatus[]>()
  for (const skill of state.value?.skills ?? [])
    grouped.set(skill.pluginId, [...grouped.get(skill.pluginId) ?? [], skill])
  return [...grouped.entries()].map(([pluginId, skills]) => ({ pluginId, skills }))
})

watch(() => [props.open, store.selectedProjectId] as const, async ([open, projectId]) => {
  if (!open || !projectId)
    return
  await load(projectId)
}, { immediate: true })

async function load(projectId: string): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    state.value = await api.projectSkills(projectId)
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    loading.value = false
  }
}

async function save(settings: LocalSkillActivationSettings): Promise<void> {
  const projectId = store.selectedProjectId
  if (!projectId)
    return
  loading.value = true
  error.value = ''
  try {
    state.value = await api.updateProjectSkills(projectId, settings)
    await store.refreshProjects()
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    loading.value = false
  }
}

function without<T>(items: T[] | undefined, value: T): T[] {
  return (items ?? []).filter(item => item !== value)
}

function pluginEnabled(pluginId: string): boolean {
  if (!state.value)
    return false
  if (state.value.local.disabledPlugins?.includes(pluginId))
    return false
  return state.value.local.enabledPlugins?.includes(pluginId)
    || (!state.value.project.disabledPlugins?.includes(pluginId) && state.value.project.enabledPlugins?.includes(pluginId))
    || state.value.skills.some(skill => skill.pluginId === pluginId && skill.status === 'enabled')
}

function togglePlugin(pluginId: string): void {
  if (!state.value)
    return
  const local = state.value.local
  const enabled = pluginEnabled(pluginId)
  void save({
    ...local,
    enabledPlugins: enabled ? without(local.enabledPlugins, pluginId) : [...new Set([...(local.enabledPlugins ?? []), pluginId])],
    disabledPlugins: enabled ? [...new Set([...(local.disabledPlugins ?? []), pluginId])] : without(local.disabledPlugins, pluginId),
  })
}

function scopeEnabled(skill: ProjectSkillStatus, relativePath: string): boolean {
  return skill.scopes.some(scope => scope.relativePath === relativePath)
}

function updateRules(rules: LocalSkillActivationSettings['enabled'], skillId: string, relativePath: string, add: boolean) {
  const current = rules ?? []
  const existing = current.find(rule => rule.id === skillId)
  const scopes = new Set(existing?.scopes ?? [])
  if (add)
    scopes.add(relativePath)
  else
    scopes.delete(relativePath)
  const remaining = current.filter(rule => rule.id !== skillId)
  return scopes.size ? [...remaining, { id: skillId, scopes: [...scopes] }] : remaining
}

function toggleScope(skill: ProjectSkillStatus, relativePath: string): void {
  if (!state.value)
    return
  const local = state.value.local
  const enabled = scopeEnabled(skill, relativePath)
  void save({
    ...local,
    enabled: updateRules(local.enabled, skill.id, relativePath, !enabled),
    disabled: updateRules(local.disabled, skill.id, relativePath, enabled),
  })
}

function setMode(event: Event): void {
  if (!state.value)
    return
  void save({ ...state.value.local, mode: (event.target as HTMLSelectElement).value as 'auto' | 'manual' })
}

function statusLabel(status: ProjectSkillStatus['status']): string {
  return t(status === 'manual-only' ? 'skillStatus_manual_only' : `skillStatus_${status}`)
}
</script>

<template>
  <DialogShell :open="open" content-class="project-skills-dialog dialog-content" header-class="project-skills-header" @update:open="emit('update:open', $event)">
    <template #title>{{ t('manageProjectSkills') }}</template>
    <template #description>{{ t('manageProjectSkillsDescription') }}</template>
    <template #header-actions><UiButton size="icon" variant="ghost" :aria-label="t('close')" @click="emit('update:open', false)"><Icon name="close" /></UiButton></template>
    <p v-if="loading && !state" class="dialog-empty-state">{{ t('loading') }}</p>
    <template v-else-if="state">
      <label class="project-skills-mode">
        <span>{{ t('skillActivationMode') }}</span>
        <select data-testid="skill-mode" :value="state.local.mode ?? state.mode" :disabled="loading" @change="setMode">
          <option value="manual">{{ t('skillModeManual') }}</option>
          <option value="auto">{{ t('skillModeAuto') }}</option>
        </select>
        <small>{{ t(state.mode === 'auto' ? 'skillModeAutoDescription' : 'skillModeManualDescription') }}</small>
      </label>
      <p v-if="state.missingPluginIds.length" class="error-message">{{ t('missingSkillPlugins', { plugins: state.missingPluginIds.join(', ') }) }}</p>
      <div class="project-skills-groups">
        <section v-for="group in groups" :key="group.pluginId" class="project-skills-group">
          <header>
            <div><strong>{{ group.pluginId }}</strong><small>{{ t('skillCount', { count: String(group.skills.length) }) }}</small></div>
            <label><input type="checkbox" :data-testid="`skill-plugin-${group.pluginId}`" :checked="pluginEnabled(group.pluginId)" :disabled="loading" @change="togglePlugin(group.pluginId)"> {{ t('enablePluginSkills') }}</label>
          </header>
          <article v-for="skill in group.skills" :key="skill.id" class="project-skill-row">
            <div><strong>{{ skill.name }}</strong><small>{{ skill.description || skill.id }}</small></div>
            <em :class="skill.status">{{ statusLabel(skill.status) }}</em>
            <div class="project-skill-scopes">
              <label v-for="scope in store.commandPackages" :key="scope.relativePath">
                <input type="checkbox" :data-testid="`skill-scope-${skill.id}-${scope.relativePath}`" :checked="scopeEnabled(skill, scope.relativePath)" :disabled="loading" @change="toggleScope(skill, scope.relativePath)">
                {{ scope.relativePath === '.' ? t('projectRoot') : scope.relativePath }}
              </label>
            </div>
          </article>
        </section>
        <p v-if="!groups.length" class="dialog-empty-state">{{ t('noInstalledProjectSkills') }}</p>
      </div>
    </template>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
  </DialogShell>
</template>

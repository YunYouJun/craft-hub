<script setup lang="ts">
import type { WorkbenchEditorId } from 'craft-hub'
import type { IconName } from './icons'
import { computed, ref } from 'vue'
import { SelectOptionContent } from './components/ui/select'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const props = defineProps<{ disabled?: boolean, scope: 'project' | 'workspace' }>()
const emit = defineEmits<{ open: [] }>()
const store = useWorkbenchStore()
const { t } = useI18n()
const menuOpen = ref(false)
const setting = computed(() => store.settings?.settings['workbench.editor'] ?? { default: 'vscode' as const })
const builtInEditors: Array<{ id: Exclude<WorkbenchEditorId, 'custom'>, icon: IconName, name: string }> = [
  { id: 'vscode', name: 'VS Code', icon: 'vscode' },
  { id: 'cursor', name: 'Cursor', icon: 'cursor' },
]
const choices = computed<Array<{ id: WorkbenchEditorId, icon: IconName, name: string }>>(() => [
  ...builtInEditors,
  ...(setting.value.custom ? [{ id: 'custom' as const, name: setting.value.custom.name, icon: 'code' as const }] : []),
])
const activeEditor = computed(() => choices.value.find(choice => choice.id === setting.value.default) ?? builtInEditors[0]!)
const editorName = computed(() => activeEditor.value.name)
const icon = computed(() => activeEditor.value.icon)
const openLabel = computed(() => t(props.scope === 'project' ? 'openProjectInEditor' : 'openWorkspaceInEditor', { editor: editorName.value }))

async function selectEditor(id: WorkbenchEditorId): Promise<void> {
  menuOpen.value = false
  await store.updateEditorSetting({ ...setting.value, default: id })
}
</script>

<template>
  <div class="editor-split-action">
    <button
      type="button"
      class="editor-launch-action icon-action tooltip-action"
      :data-testid="`open-${scope}-editor`"
      :disabled="disabled"
      :aria-label="openLabel"
      :data-tooltip="openLabel"
      :title="openLabel"
      @click="emit('open')"
    >
      <Icon :name="icon" />
    </button>
    <details :open="menuOpen" class="editor-action-menu" @toggle="menuOpen = ($event.target as HTMLDetailsElement).open">
      <summary :aria-label="t('chooseDefaultEditor')" :title="t('chooseDefaultEditor')"><Icon name="arrowDown" /></summary>
      <div>
        <button
          v-for="choice in choices"
          :key="choice.id"
          type="button"
          :data-testid="`select-editor-${choice.id}`"
          :class="{ active: setting.default === choice.id }"
          @click="selectEditor(choice.id)"
        >
          <SelectOptionContent
            :icon="choice.icon"
            :label="choice.name"
            :selected="setting.default === choice.id"
          />
        </button>
      </div>
    </details>
  </div>
</template>

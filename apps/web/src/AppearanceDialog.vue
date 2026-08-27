<script setup lang="ts">
import type { ProjectAccentColor } from 'craft-hub'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, Label as RekaLabel } from 'reka-ui'
import { ref, watch } from 'vue'
import CompactEditableField from './CompactEditableField.vue'
import { useI18n } from './i18n'
import { type IconName, visualIconNames } from './icons'
import { projectAccentStyle } from './project-visuals'
import VisualIcon from './VisualIcon.vue'

const props = withDefaults(defineProps<{ open: boolean, title: string, name?: string, editableName?: boolean, note?: string, editableNote?: boolean, icon?: string, color?: ProjectAccentColor, showColor?: boolean, fallbackIcon?: IconName }>(), { fallbackIcon: 'workspace', showColor: true })
const emit = defineEmits<{
  'update:open': [open: boolean]
  'save': [appearance: { name?: string, note?: string, icon?: string, color?: ProjectAccentColor }]
}>()
const { t } = useI18n()
const editedName = ref('')
const editedNote = ref('')
const selectedIcon = ref('')
const customEmoji = ref('')
const selectedColor = ref<ProjectAccentColor | ''>('')
const iconLabelKeys = {
  workspace: 'iconOption_workspace',
  folder: 'iconOption_folder',
  hub: 'iconOption_hub',
  code: 'iconOption_code',
  docs: 'iconOption_docs',
  design: 'iconOption_design',
  database: 'iconOption_database',
  package: 'iconOption_package',
  rocket: 'iconOption_rocket',
  team: 'iconOption_team',
  experiment: 'iconOption_experiment',
  security: 'iconOption_security',
  cloud: 'iconOption_cloud',
  mobile: 'iconOption_mobile',
  web: 'iconOption_web',
  terminal: 'iconOption_terminal',
  skill: 'iconOption_skill',
  settings: 'iconOption_settings',
  calendar: 'iconOption_calendar',
  chart: 'iconOption_chart',
} as const satisfies Record<typeof visualIconNames[number], string>
const iconOptions = visualIconNames.map(name => ({ labelKey: iconLabelKeys[name], name, value: `builtin:${name}` }))
const emojiOptions = ['🚀', '📚', '🛠️', '🎨', '📦', '💡', '🧧', '🧪', '📱', '🎮', '🔒', '☁️']
const colorOptions: Array<ProjectAccentColor | ''> = ['', 'blue', 'cyan', 'green', 'orange', 'pink', 'purple', 'red', 'yellow']

watch(() => props.open, (open) => {
  if (!open)
    return
  editedName.value = props.name ?? ''
  editedNote.value = props.note ?? ''
  selectedIcon.value = props.icon ?? ''
  customEmoji.value = props.icon?.startsWith('emoji:') ? props.icon.slice('emoji:'.length) : ''
  selectedColor.value = props.color ?? ''
}, { immediate: true })

function selectIcon(icon: string): void {
  selectedIcon.value = icon
  customEmoji.value = icon.startsWith('emoji:') ? icon.slice('emoji:'.length) : ''
}

function selectCustomEmoji(): void {
  selectedIcon.value = customEmoji.value.trim() ? `emoji:${customEmoji.value.trim()}` : ''
}

watch(customEmoji, selectCustomEmoji)

function save(): void {
  emit('save', {
    name: props.editableName ? editedName.value.trim() : undefined,
    note: props.editableNote ? editedNote.value.trim() || undefined : undefined,
    icon: selectedIcon.value || undefined,
    color: selectedColor.value || undefined,
  })
}
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog-content appearance-dialog">
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ t(showColor ? 'appearanceDescription' : 'iconAppearanceDescription') }}</DialogDescription>
        <RekaLabel v-if="editableName" class="compact-field-label appearance-name-field">
          <span>{{ t('workspaceName') }}</span>
          <CompactEditableField v-model="editedName" name="appearance-name" :aria-label="t('workspaceName')" start-editing />
        </RekaLabel>
        <RekaLabel v-if="editableNote" class="compact-field-label appearance-note-field">
          <span>{{ t('workspaceProjectRemark') }}</span>
          <CompactEditableField v-model="editedNote" name="appearance-note" :aria-label="t('workspaceProjectRemark')" :placeholder="t('workspaceProjectRemarkPlaceholder')" start-editing />
        </RekaLabel>
        <fieldset class="appearance-fieldset">
          <legend>{{ t('icon') }}</legend>
          <div class="icon-choice-grid">
            <button
              type="button"
              class="appearance-icon-choice"
              :class="{ selected: !selectedIcon }"
              :aria-label="t('defaultAppearance')"
              @click="selectIcon('')"
            >
              <VisualIcon :fallback="fallbackIcon" />
            </button>
            <button
              v-for="option in iconOptions"
              :key="option.value"
              type="button"
              class="appearance-icon-choice"
              :class="{ selected: selectedIcon === option.value }"
              :aria-label="t(option.labelKey)"
              @click="selectIcon(option.value)"
            >
              <VisualIcon :icon="option.value" :fallback="fallbackIcon" />
            </button>
          </div>
        </fieldset>
        <fieldset class="appearance-fieldset">
          <legend>{{ t('emoji') }}</legend>
          <div class="icon-choice-grid">
            <button
              v-for="emoji in emojiOptions"
              :key="emoji"
              type="button"
              class="appearance-icon-choice appearance-emoji-choice"
              :class="{ selected: selectedIcon === `emoji:${emoji}` }"
              :aria-label="t('emojiOption', { emoji })"
              @click="selectIcon(`emoji:${emoji}`)"
            >
              <VisualIcon :icon="`emoji:${emoji}`" />
            </button>
          </div>
          <RekaLabel class="compact-field-label custom-emoji-field">
            <span>{{ t('customEmoji') }}</span>
            <CompactEditableField v-model="customEmoji" name="custom-emoji" :aria-label="t('customEmoji')" :placeholder="t('customEmojiPlaceholder')" />
          </RekaLabel>
        </fieldset>
        <fieldset v-if="showColor" class="appearance-fieldset">
          <legend>{{ t('themeColor') }}</legend>
          <div class="color-choice-grid">
            <button
              v-for="option in colorOptions"
              :key="option || 'default'"
              type="button"
              class="appearance-color-choice"
              :class="[{ selected: selectedColor === option }, option || 'default']"
              :style="projectAccentStyle(option || undefined)"
              :aria-label="option || t('defaultAppearance')"
              @click="selectedColor = option"
            ><span /></button>
          </div>
        </fieldset>
        <div class="dialog-actions">
          <button class="secondary-button" type="button" @click="emit('update:open', false)">{{ t('cancel') }}</button>
          <button class="primary-button" type="button" data-testid="save-appearance" :disabled="editableName && !editedName.trim()" @click="save">{{ t('save') }}</button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

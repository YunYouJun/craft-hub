<script setup lang="ts">
import { EditableArea, EditableInput, EditablePreview, EditableRoot } from 'reka-ui'

withDefaults(defineProps<{
  modelValue: string
  name?: string
  placeholder?: string
  ariaLabel?: string
  startEditing?: boolean
}>(), {
  name: undefined,
  placeholder: '',
  ariaLabel: undefined,
  startEditing: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <EditableRoot
    class="compact-editable-root"
    :model-value="modelValue"
    :name="name"
    :placeholder="placeholder"
    activation-mode="focus"
    submit-mode="both"
    :start-with-edit-mode="startEditing"
    select-on-focus
    @update:model-value="emit('update:modelValue', $event)"
  >
    <EditableArea class="compact-editable-area">
      <EditableInput class="compact-editable-input" :aria-label="ariaLabel" @keydown.enter.stop.prevent />
      <EditablePreview class="compact-editable-preview" :aria-label="ariaLabel" />
    </EditableArea>
  </EditableRoot>
</template>

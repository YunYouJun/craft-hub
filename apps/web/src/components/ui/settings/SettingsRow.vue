<script setup lang="ts">
import { useId, useSlots } from 'vue'
import '../../../styles/settings.css'

withDefaults(defineProps<{
  controlId?: string
  description?: string
  label: string
  orientation?: 'horizontal' | 'vertical'
}>(), {
  orientation: 'horizontal',
})

const id = useId()
const labelId = `settings-row-${id}`
const descriptionId = `${labelId}-description`
const slots = useSlots()
</script>

<template>
  <div
    class="ui-settings-row"
    data-slot="settings-row"
    :data-has-control="Boolean(slots.control)"
    :data-orientation="orientation"
    role="group"
    :aria-labelledby="labelId"
    :aria-describedby="description ? descriptionId : undefined"
  >
    <div class="ui-settings-row-copy">
      <label v-if="controlId" :id="labelId" :for="controlId" class="ui-settings-row-label">{{ label }}</label>
      <span v-else :id="labelId" class="ui-settings-row-label">{{ label }}</span>
      <p v-if="description" :id="descriptionId" class="ui-settings-row-description">{{ description }}</p>
    </div>
    <div v-if="slots.control" class="ui-settings-row-control">
      <slot name="control" :label-id="labelId" :description-id="description ? descriptionId : undefined" />
    </div>
    <div v-if="slots.default" class="ui-settings-row-detail"><slot /></div>
  </div>
</template>

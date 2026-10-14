<script setup lang="ts">
import { useId, useSlots } from 'vue'
import '../../../styles/settings.css'

withDefaults(defineProps<{
  description?: string
  title: string
  tone?: 'accent' | 'danger' | 'neutral' | 'success' | 'warning'
}>(), {
  tone: 'neutral',
})

const id = useId()
const titleId = `settings-status-${id}`
const slots = useSlots()
</script>

<template>
  <div class="ui-settings-status" data-slot="settings-status" :data-tone="tone" :data-has-actions="Boolean(slots.actions)" role="group" :aria-labelledby="titleId">
    <div class="ui-settings-status-copy">
      <strong :id="titleId" class="ui-settings-status-title">{{ title }}</strong>
      <p v-if="description" class="ui-settings-status-description">{{ description }}</p>
      <div v-if="slots.metadata" class="ui-settings-status-metadata"><slot name="metadata" /></div>
    </div>
    <div v-if="slots.actions" class="ui-settings-status-actions"><slot name="actions" /></div>
    <div v-if="slots.default" class="ui-settings-status-detail"><slot /></div>
  </div>
</template>

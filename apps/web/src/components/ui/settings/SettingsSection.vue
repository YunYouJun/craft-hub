<script setup lang="ts">
import { useId, useSlots } from 'vue'
import '../../../styles/settings.css'

defineProps<{
  description?: string
  title: string
}>()

const id = useId()
const titleId = `settings-section-${id}`
const descriptionId = `${titleId}-description`
const slots = useSlots()
</script>

<template>
  <section
    class="ui-settings-section"
    data-slot="settings-section"
    :aria-labelledby="titleId"
    :aria-describedby="description ? descriptionId : undefined"
  >
    <header class="ui-settings-section-header">
      <div class="ui-settings-section-copy">
        <h3 :id="titleId" class="ui-settings-section-title">{{ title }}</h3>
        <p v-if="description" :id="descriptionId" class="ui-settings-section-description">{{ description }}</p>
      </div>
      <div v-if="slots.controls" class="ui-settings-section-controls"><slot name="controls" /></div>
    </header>
    <div v-if="slots.default" class="ui-settings-group"><slot /></div>
    <footer v-if="slots.footer" class="ui-settings-section-footer"><slot name="footer" /></footer>
  </section>
</template>

<script setup lang="ts">
import { Icon, isIconName } from '../../../icons'

defineProps<{
  label: string
  icon?: string
  selected?: boolean
}>()
</script>

<template>
  <span class="select-option-content">
    <Icon v-if="isIconName(icon)" :name="icon" />
    <span class="select-option-label">{{ label }}</span>
    <Icon v-if="selected" class="select-option-check" name="check" />
  </span>
</template>

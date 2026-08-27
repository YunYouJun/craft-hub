<script setup lang="ts">
import type { SelectTriggerProps } from 'reka-ui'
import { SelectIcon, SelectTrigger, useForwardProps } from 'reka-ui'
import { Icon } from '../../../icons'

const props = defineProps<SelectTriggerProps>()
const forwarded = useForwardProps(props)
</script>

<template>
  <SelectTrigger data-slot="select-trigger" v-bind="forwarded">
    <slot />
    <SelectIcon as-child>
      <Icon name="arrowDown" />
    </SelectIcon>
  </SelectTrigger>
</template>

<script setup lang="ts">
import type { SelectItemProps } from 'reka-ui'
import { SelectItem, SelectItemIndicator, SelectItemText, useForwardProps } from 'reka-ui'
import { Icon } from '../../../icons'

const props = defineProps<SelectItemProps>()
const forwarded = useForwardProps(props)
</script>

<template>
  <SelectItem data-slot="select-item" v-bind="forwarded">
    <SelectItemText>
      <slot />
    </SelectItemText>
    <SelectItemIndicator data-slot="select-item-indicator">
      <Icon name="check" />
    </SelectItemIndicator>
  </SelectItem>
</template>

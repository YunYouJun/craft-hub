<script setup lang="ts">
import type { DropdownMenuItemEmits, DropdownMenuItemProps } from 'reka-ui'
import { DropdownMenuItem, useForwardPropsEmits } from 'reka-ui'

const props = defineProps<DropdownMenuItemProps>()
const emits = defineEmits<DropdownMenuItemEmits>()
const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <DropdownMenuItem data-slot="dropdown-menu-item" v-bind="forwarded">
    <slot />
  </DropdownMenuItem>
</template>

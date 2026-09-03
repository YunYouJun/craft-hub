<script setup lang="ts">
import type { DropdownMenuContentEmits, DropdownMenuContentProps } from 'reka-ui'
import { DropdownMenuContent, DropdownMenuPortal, useForwardPropsEmits } from 'reka-ui'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<DropdownMenuContentProps>(), { align: 'end', sideOffset: 5 })
const emits = defineEmits<DropdownMenuContentEmits>()
const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <DropdownMenuPortal>
    <DropdownMenuContent data-slot="dropdown-menu-content" v-bind="{ ...forwarded, ...$attrs }">
      <slot />
    </DropdownMenuContent>
  </DropdownMenuPortal>
</template>

<script setup lang="ts">
import type { SelectContentEmits, SelectContentProps } from 'reka-ui'
import { SelectContent, SelectPortal, SelectViewport, useForwardPropsEmits } from 'reka-ui'

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<SelectContentProps>(), { position: 'popper', sideOffset: 4 })
const emits = defineEmits<SelectContentEmits>()
const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <SelectPortal>
    <SelectContent
      data-slot="select-content"
      v-bind="{ ...forwarded, ...$attrs }"
    >
      <SelectViewport data-slot="select-viewport">
        <slot />
      </SelectViewport>
    </SelectContent>
  </SelectPortal>
</template>

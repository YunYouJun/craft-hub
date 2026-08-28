<script setup lang="ts">
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { useSlots } from 'vue'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  contentClass?: string
  descriptionClass?: string
  headerClass?: string
  open: boolean
  overlayClass?: string
  titleClass?: string
}>(), {
  contentClass: 'dialog-content',
  descriptionClass: undefined,
  headerClass: undefined,
  overlayClass: 'dialog-overlay',
  titleClass: undefined,
})

const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const slots = useSlots()
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay :class="overlayClass" />
      <DialogContent v-bind="$attrs" :class="contentClass">
        <header v-if="headerClass" :class="headerClass">
          <div>
            <DialogTitle :class="titleClass"><slot name="title" /></DialogTitle>
            <DialogDescription v-if="slots.description" :class="descriptionClass"><slot name="description" /></DialogDescription>
          </div>
          <slot name="header-actions" />
        </header>
        <template v-else>
          <DialogTitle :class="titleClass"><slot name="title" /></DialogTitle>
          <DialogDescription v-if="slots.description" :class="descriptionClass"><slot name="description" /></DialogDescription>
        </template>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

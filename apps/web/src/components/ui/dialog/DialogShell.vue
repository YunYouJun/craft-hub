<script setup lang="ts">
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { useSlots } from 'vue'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  contentClass?: string
  descriptionClass?: string
  headerClass?: string
  layout?: 'default' | 'panel'
  open: boolean
  overlayClass?: string
  titleClass?: string
}>(), {
  contentClass: 'dialog-content',
  descriptionClass: undefined,
  headerClass: undefined,
  layout: 'default',
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
      <DialogContent v-bind="$attrs" :class="[contentClass, { 'dialog-panel': layout === 'panel' }]">
        <header v-if="headerClass || layout === 'panel'" :class="[headerClass, { 'dialog-panel-header': layout === 'panel' }]">
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
        <template v-if="layout === 'panel'">
          <div class="dialog-panel-body"><slot /></div>
          <footer v-if="slots.footer" class="dialog-panel-footer"><slot name="footer" /></footer>
        </template>
        <slot v-else />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
.dialog-content.dialog-panel {
  display: flex;
  flex-direction: column;
  width: min(var(--dialog-panel-width), calc(100vw - 24px));
  max-height: calc(100dvh - 32px - var(--desktop-titlebar-height, 0px) - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  overflow: hidden;
  padding: 0;
  box-shadow: 0 16px 48px var(--shadow);
  font-size: var(--font-size-body);
  line-height: var(--line-height-emphasis);
}
.dialog-panel-header { display: flex; flex: none; align-items: flex-start; justify-content: space-between; gap: var(--space-3); border-bottom: 1px solid var(--border); padding: var(--dialog-panel-padding); }
.dialog-panel-header > div { min-width: 0; }
.dialog-panel-header > button { flex: none; }
.dialog-panel .dialog-panel-header h2 { font-size: var(--dialog-title-size); font-weight: 600; line-height: var(--line-height-heading-md); }
.dialog-panel-header p { margin: var(--space-1) 0 0; color: var(--muted); font-size: var(--font-size-body); }
.dialog-panel-body { min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; padding: var(--dialog-panel-padding); overflow-wrap: anywhere; }
.dialog-panel-footer { display: flex; flex: none; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); border-top: 1px solid var(--border); background: var(--surface-subtle); padding: var(--space-3) var(--dialog-panel-padding); }
@media (max-width: 760px) {
  .dialog-panel-header > button, .dialog-panel-footer > button { min-height: 40px; }
}
</style>

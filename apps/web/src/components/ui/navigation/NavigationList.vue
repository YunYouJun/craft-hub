<script setup lang="ts">
import type { PrimitiveProps } from 'reka-ui'
import type { NavigationVariant } from './context'
import { Primitive, useForwardExpose } from 'reka-ui'
import { computed, provide } from 'vue'
import { navigationVariantKey } from './context'

const props = withDefaults(defineProps<PrimitiveProps & {
  variant?: NavigationVariant
}>(), {
  as: 'div',
  variant: 'segmented',
})

provide(navigationVariantKey, computed(() => props.variant))
const { forwardRef } = useForwardExpose()
</script>

<template>
  <Primitive
    :ref="forwardRef"
    :as="as"
    :as-child="asChild"
    class="ui-navigation-list"
    data-slot="navigation-list"
    :data-variant="variant"
  >
    <slot />
  </Primitive>
</template>

<style>
.ui-navigation-list {
  box-sizing: border-box;
  min-width: 0;
}

.ui-navigation-list[data-variant='segmented'] {
  display: flex;
  width: max-content;
  max-width: 100%;
  align-items: center;
  gap: var(--navigation-segmented-gap);
  overflow-x: auto;
  border: var(--navigation-list-border-width) solid var(--border);
  border-radius: var(--navigation-list-radius);
  padding: var(--navigation-segmented-list-inset);
  background: var(--surface-muted);
  scrollbar-width: none;
}

.ui-navigation-list[data-variant='segmented']::-webkit-scrollbar {
  display: none;
}

.ui-navigation-list[data-variant='sidebar'] {
  display: grid;
  align-content: start;
  gap: var(--navigation-sidebar-gap);
  padding: var(--navigation-sidebar-list-inset);
}

.ui-navigation-list[data-variant='sidebar']:is([aria-orientation='horizontal'], [data-orientation='horizontal']) {
  display: flex;
  align-items: center;
  overflow-x: auto;
  padding: var(--navigation-sidebar-horizontal-inset-block) var(--navigation-sidebar-list-inset);
  scrollbar-width: none;
}

.ui-navigation-list[data-variant='sidebar']:is([aria-orientation='horizontal'], [data-orientation='horizontal']) .ui-navigation-item {
  width: auto;
  flex: 0 0 auto;
}
</style>

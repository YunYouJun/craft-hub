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

/*
 * Tabs render one selection surface that slides between segments on the upstream soft spring. The list is always
 * the offset parent, because the indicator measures the active tab before it first renders. Items paint above it
 * through the isolated stacking context; the first measurement places it without animating.
 */
.ui-navigation-list[data-variant='segmented'] {
  position: relative;
  isolation: isolate;
}

.ui-navigation-indicator {
  position: absolute;
  z-index: -1;
  top: 50%;
  left: 0;
  width: var(--reka-tabs-indicator-size);
  height: var(--reka-tabs-indicator-thickness);
  border-radius: var(--navigation-item-radius);
  background: var(--surface);
  box-shadow: 0 1px 2px var(--shadow);
  transform: translate(var(--reka-tabs-indicator-position), -50%);
  transition:
    transform var(--motion-duration-slow) var(--motion-ease-spring),
    width var(--motion-duration-slow) var(--motion-ease-spring);
  pointer-events: none;
}

.ui-navigation-list:has(> .ui-navigation-indicator) > .ui-navigation-item[data-variant='segmented']:is([data-state='active'], [aria-selected='true']) {
  background: transparent;
  box-shadow: none;
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

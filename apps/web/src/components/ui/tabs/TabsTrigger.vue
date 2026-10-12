<script setup lang="ts">
import type { TabsTriggerProps } from 'reka-ui'
import { TabsTrigger, useForwardExpose, useForwardProps } from 'reka-ui'
import { NavigationItem } from '../navigation'

const props = defineProps<TabsTriggerProps>()
const forwarded = useForwardProps(props)
const { forwardRef } = useForwardExpose()
</script>

<template>
  <NavigationItem as-child :disabled="disabled">
    <TabsTrigger :ref="forwardRef" data-slot="tabs-trigger" v-bind="forwarded">
      <span v-if="!asChild && $slots.icon" data-slot="navigation-icon" aria-hidden="true">
        <slot name="icon" />
      </span>
      <slot />
    </TabsTrigger>
  </NavigationItem>
</template>

<script setup lang="ts">
import type { TabsListProps } from 'reka-ui'
import type { NavigationVariant } from '../navigation'
import { TabsList, useForwardExpose, useForwardProps } from 'reka-ui'
import { computed } from 'vue'
import { NavigationList } from '../navigation'

const props = withDefaults(defineProps<TabsListProps & {
  variant?: NavigationVariant
}>(), {
  variant: 'segmented',
})

const forwarded = useForwardProps(props)
const listProps = computed(() => {
  const { variant: _variant, ...rest } = forwarded.value
  return rest
})
const { forwardRef } = useForwardExpose()
</script>

<template>
  <NavigationList as-child :variant="variant">
    <TabsList :ref="forwardRef" data-slot="tabs-list" v-bind="listProps">
      <slot />
    </TabsList>
  </NavigationList>
</template>

<script setup lang="ts">
import type { CheckboxRootEmits, CheckboxRootProps } from 'reka-ui'
import { CheckboxIndicator, CheckboxRoot, useForwardPropsEmits } from 'reka-ui'
import { Icon } from '../../../icons'

const props = defineProps<CheckboxRootProps>()
const emit = defineEmits<CheckboxRootEmits>()
const forwarded = useForwardPropsEmits(props, emit)
</script>

<template>
  <CheckboxRoot v-bind="forwarded" data-slot="checkbox" class="ui-form-checkbox">
    <CheckboxIndicator data-slot="checkbox-indicator"><Icon name="check" /></CheckboxIndicator>
  </CheckboxRoot>
</template>

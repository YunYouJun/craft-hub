<script setup lang="ts">
import type { CheckboxRootEmits, CheckboxRootProps } from 'reka-ui'
import { CheckboxIndicator, CheckboxRoot, useForwardPropsEmits } from 'reka-ui'
import { ref } from 'vue'
import { Icon } from '../../../icons'

const props = defineProps<CheckboxRootProps>()
const emit = defineEmits<CheckboxRootEmits>()
const forwarded = useForwardPropsEmits(props, emit)
/** The check mark animates only after the user changes it, never when a checked list first renders. */
const changed = ref(false)
</script>

<template>
  <CheckboxRoot v-bind="forwarded" data-slot="checkbox" class="ui-form-checkbox" :data-changed="changed ? '' : undefined" @update:model-value="changed = true">
    <CheckboxIndicator data-slot="checkbox-indicator"><Icon name="check" /></CheckboxIndicator>
  </CheckboxRoot>
</template>

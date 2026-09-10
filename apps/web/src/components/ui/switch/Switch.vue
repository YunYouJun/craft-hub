<script setup lang="ts">
import type { SwitchRootEmits, SwitchRootProps } from 'reka-ui'
import { SwitchRoot, SwitchThumb, useForwardPropsEmits } from 'reka-ui'
import { computed } from 'vue'

const props = defineProps<SwitchRootProps & { loading?: boolean }>()
const emit = defineEmits<SwitchRootEmits>()
const forwarded = useForwardPropsEmits(computed(() => {
  const { loading: _loading, ...rootProps } = props
  return rootProps
}), emit)
</script>

<template>
  <SwitchRoot v-bind="forwarded" data-slot="switch" class="ui-switch" :disabled="disabled || loading" :aria-busy="loading || undefined">
    <SwitchThumb data-slot="switch-thumb" class="ui-switch-thumb">
      <span v-if="loading" class="ui-switch-spinner" aria-hidden="true" />
    </SwitchThumb>
  </SwitchRoot>
</template>

<style scoped>
.ui-switch { display: inline-flex; position: relative; align-items: center; flex: none; width: var(--switch-width); height: var(--switch-height); box-sizing: border-box; padding: var(--switch-inset); border: 0; border-radius: var(--radius-pill); background: var(--switch-track); cursor: pointer; transition: background-color var(--motion-duration-fast) ease; }
.ui-switch[data-state='checked'] { background: var(--accent); }
.ui-switch:focus-visible { outline: var(--control-focus-width) solid var(--focus-ring); outline-offset: var(--control-focus-offset); }
.ui-switch[data-disabled] { cursor: not-allowed; opacity: var(--control-disabled-opacity); }
.ui-switch[aria-busy='true'] { cursor: wait; }
.ui-switch-thumb { display: grid; position: relative; place-items: center; flex: none; width: var(--switch-thumb-size); height: var(--switch-thumb-size); border-radius: var(--radius-pill); background: var(--switch-thumb); color: var(--text-secondary); pointer-events: none; box-shadow: var(--switch-thumb-shadow); transform: translateX(0); transition: transform var(--motion-duration-fast) ease; }
.ui-switch[data-state='checked'] .ui-switch-thumb { transform: translateX(var(--switch-travel)); }
.ui-switch:dir(rtl)[data-state='checked'] .ui-switch-thumb { transform: translateX(calc(-1 * var(--switch-travel))); }
.ui-switch-spinner { position: absolute; inset: 0; margin: auto; width: var(--switch-spinner-size); height: var(--switch-spinner-size); box-sizing: border-box; border: var(--control-focus-width) solid currentcolor; border-right-color: transparent; border-radius: var(--radius-pill); animation: switch-spin var(--motion-duration-spin) linear infinite; }
@keyframes switch-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ui-switch, .ui-switch-thumb { transition: none; } .ui-switch-spinner { animation: none; } }
</style>

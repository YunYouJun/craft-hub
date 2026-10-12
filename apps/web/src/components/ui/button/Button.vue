<script setup lang="ts">
import type { ButtonHTMLAttributes } from 'vue'

withDefaults(defineProps<{
  disabled?: boolean
  size?: 'compact' | 'default' | 'icon'
  type?: ButtonHTMLAttributes['type']
  variant?: 'danger' | 'danger-secondary' | 'ghost' | 'primary' | 'secondary' | 'warning'
}>(), {
  disabled: false,
  size: 'default',
  type: 'button',
  variant: 'secondary',
})
</script>

<template>
  <button
    :class="[`ui-button--${variant}`, `ui-button--${size}`]"
    class="ui-button"
    :disabled="disabled"
    :type="type"
  >
    <slot />
  </button>
</template>

<style scoped>
.ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--control-icon-gap);
  border: 1px solid transparent;
  border-radius: var(--control-radius);
  font-size: var(--font-size-body);
  font-weight: 500;
  line-height: var(--line-height-body);
  box-shadow: none;
}

.ui-button:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
  box-shadow: 0 0 0 1px var(--surface);
}

.ui-button:disabled {
  cursor: default;
  opacity: .5;
}

.ui-button--default { min-height: var(--control-height-default); padding: 4px 12px; }
.ui-button--compact { min-height: var(--control-height-compact); padding: 3px 10px; font-size: var(--font-size-control); line-height: var(--line-height-control); }
.ui-button--icon { width: var(--control-height-default); height: var(--control-height-default); padding: 0; }

.ui-button--primary {
  background: var(--accent);
  color: var(--on-accent);
}

.ui-button--primary:hover:not(:disabled) { background: var(--accent-hover); }

.ui-button--warning {
  background: var(--warning-fill);
  color: var(--on-warning);
}

.ui-button--warning:hover:not(:disabled) { background: var(--warning-fill-hover); }

.ui-button--danger {
  background: var(--danger-fill);
  color: var(--on-danger);
}

.ui-button--danger:hover:not(:disabled) { background: var(--danger-fill-hover); }

.ui-button--danger-secondary {
  border-color: color-mix(in srgb, var(--danger) 38%, var(--border));
  background: var(--surface);
  color: var(--danger);
}

.ui-button--danger-secondary:hover:not(:disabled) {
  background: var(--danger-soft);
}

.ui-button--secondary {
  border-color: var(--border);
  background: var(--surface);
  color: var(--text);
}

.ui-button--secondary:hover:not(:disabled),
.ui-button--ghost:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--accent);
}

.ui-button--ghost {
  background: transparent;
  color: var(--text-secondary);
}

.ui-button :deep(.app-icon) { width: var(--control-icon-size); height: var(--control-icon-size); }
.ui-button--compact :deep(.app-icon) { width: var(--control-icon-size-compact); height: var(--control-icon-size-compact); }
</style>

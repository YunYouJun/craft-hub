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
  gap: 7px;
  border: 1px solid transparent;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
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

.ui-button--default { padding: 8px 12px; }
.ui-button--compact { padding: 7px 10px; }
.ui-button--icon { width: 32px; height: 32px; padding: 0; }

.ui-button--primary {
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: 0 2px 5px color-mix(in srgb, var(--accent) 25%, transparent);
}

.ui-button--primary:hover:not(:disabled) { background: var(--accent-hover); }

.ui-button--warning {
  background: var(--warning);
  color: var(--on-warning);
  box-shadow: 0 2px 5px color-mix(in srgb, var(--warning) 25%, transparent);
}

.ui-button--warning:hover:not(:disabled) { background: var(--warning-hover); }

.ui-button--danger {
  background: var(--danger);
  color: var(--on-danger);
  box-shadow: 0 2px 5px color-mix(in srgb, var(--danger) 25%, transparent);
}

.ui-button--danger:hover:not(:disabled) { background: var(--danger-hover); }

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

.ui-button :deep(.app-icon) { width: 17px; height: 17px; }
</style>

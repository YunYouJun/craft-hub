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
  transition:
    background-color var(--motion-duration-fast) var(--motion-ease-standard),
    border-color var(--motion-duration-fast) var(--motion-ease-standard),
    color var(--motion-duration-fast) var(--motion-ease-standard),
    transform var(--motion-duration-fast) var(--motion-ease-spring);
}

/* Press responds immediately; release springs back. Hover feedback stays on precise pointers only. */
.ui-button:active:not(:disabled) {
  transform: scale(var(--motion-press-scale));
  transition-duration: var(--motion-duration-press);
  transition-timing-function: var(--motion-ease-standard);
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


.ui-button--warning {
  background: var(--warning-fill);
  color: var(--on-warning);
}


.ui-button--danger {
  background: var(--danger-fill);
  color: var(--on-danger);
}


.ui-button--danger-secondary {
  border-color: color-mix(in srgb, var(--danger) 38%, var(--border));
  background: var(--surface);
  color: var(--danger);
}


.ui-button--secondary {
  border-color: var(--border);
  background: var(--surface);
  color: var(--text);
}


.ui-button--ghost {
  background: transparent;
  color: var(--text-secondary);
}

@media (hover: hover) and (pointer: fine) {
  .ui-button--primary:hover:not(:disabled) { background: var(--accent-hover); }
  .ui-button--warning:hover:not(:disabled) { background: var(--warning-fill-hover); }
  .ui-button--danger:hover:not(:disabled) { background: var(--danger-fill-hover); }
  .ui-button--danger-secondary:hover:not(:disabled) {
    background: var(--danger-soft);
  }
  .ui-button--secondary:hover:not(:disabled),
  .ui-button--ghost:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--accent);
  }
}

.ui-button :deep(.app-icon) { width: var(--control-icon-size); height: var(--control-icon-size); }
.ui-button--compact :deep(.app-icon) { width: var(--control-icon-size-compact); height: var(--control-icon-size-compact); }
</style>

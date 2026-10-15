<script setup lang="ts">
withDefaults(defineProps<{
  /** Placeholder geometry: a text line, a rectangular block or a round avatar/icon. */
  shape?: 'line' | 'block' | 'circle'
  /** CSS width; lines default to the full row. */
  width?: string
  /** CSS height; lines default to the surrounding text line. */
  height?: string
}>(), { shape: 'line' })
</script>

<template>
  <span class="ui-skeleton" :class="`ui-skeleton--${shape}`" data-slot="skeleton" aria-hidden="true" :style="{ width, height }" />
</template>

<style>
/*
 * Every shape samples one viewport-wide gradient, so a page full of placeholders shimmers as a single calm sweep.
 * Placeholders fade in after a short delay: fast responses never flash a skeleton.
 */
.ui-skeleton {
  display: block;
  flex: none;
  height: var(--skeleton-line-height, 10px);
  border-radius: var(--radius-pill);
  background-color: var(--skeleton-base);
  background-image: linear-gradient(100deg, transparent 30%, var(--skeleton-highlight) 50%, transparent 70%);
  background-attachment: fixed;
  background-repeat: no-repeat;
  background-size: 200vw 100%;
  animation:
    ui-skeleton-appear var(--motion-duration-enter) var(--motion-ease-standard) var(--skeleton-appear-delay) backwards,
    ui-skeleton-shimmer 1.6s linear infinite;
}


.ui-skeleton--block { height: var(--skeleton-block-height, 48px); border-radius: var(--control-radius); }
.ui-skeleton--circle { width: 16px; height: 16px; border-radius: 50%; }

@keyframes ui-skeleton-appear { from { opacity: 0; } }
@keyframes ui-skeleton-shimmer { from { background-position: -200vw 0; } to { background-position: 100vw 0; } }

@media (prefers-reduced-motion: reduce) {
  .ui-skeleton, .ui-skeleton-list .ui-skeleton { background-image: none; animation: none; }
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import Skeleton from './Skeleton.vue'

const props = withDefaults(defineProps<{
  /** Announced to assistive technology while the placeholder is shown. */
  label: string
  /** Number of placeholder rows; keep it close to the expected result count. */
  rows?: number
  /** Show a leading icon placeholder, matching rows that start with a source icon. */
  icon?: boolean
  /** Show a caption line under the title, matching rows with metadata. */
  meta?: boolean
}>(), { rows: 3, icon: false, meta: true })

/** Varied title widths read as real content instead of a uniform grid. */
const titleWidths = ['72%', '54%', '64%', '46%', '58%']
const items = computed(() => Array.from({ length: Math.max(1, props.rows) }, (_, index) => ({
  title: titleWidths[index % titleWidths.length]!,
  meta: index % 2 ? '28%' : '36%',
})))
</script>

<template>
  <div class="ui-skeleton-list" data-slot="skeleton-list" role="status" aria-busy="true">
    <span class="sr-only">{{ label }}</span>
    <div v-for="(item, index) in items" :key="index" class="ui-skeleton-row" aria-hidden="true">
      <Skeleton v-if="icon" shape="circle" />
      <span class="ui-skeleton-copy">
        <Skeleton :width="item.title" />
        <Skeleton v-if="meta" :width="item.meta" class="ui-skeleton-meta" />
      </span>
    </div>
  </div>
</template>

<style>
/* Lists fade in as a whole so row dividers never show before their placeholders. */
.ui-skeleton-list { display: grid; min-width: 0; animation: ui-skeleton-appear var(--motion-duration-enter) var(--motion-ease-standard) var(--skeleton-appear-delay) backwards; }
.ui-skeleton-list .ui-skeleton { animation: ui-skeleton-shimmer 1.6s linear infinite; }
.ui-skeleton-row { display: flex; min-height: var(--skeleton-row-height, 48px); align-items: center; gap: var(--space-3); padding: var(--skeleton-row-padding, var(--space-2) var(--space-4)); box-sizing: border-box; }
.ui-skeleton-row + .ui-skeleton-row { border-top: var(--skeleton-row-divider, 1px solid var(--border)); }
.ui-skeleton-copy { display: grid; min-width: 0; flex: 1; gap: 8px; }
.ui-skeleton-meta { --skeleton-line-height: 8px; }
</style>

<script setup lang="ts">
import FilePreview from './FilePreview.vue'

defineProps<{
  before: string
  after: string
  beforePath?: string
  afterPath?: string
  beforeLabel: string
  afterLabel: string
}>()
</script>

<template>
  <section class="file-diff-preview" :aria-label="`${beforeLabel} → ${afterLabel}`">
    <div class="file-diff-labels">
      <div><strong>− {{ beforeLabel }}</strong><code v-if="beforePath">{{ beforePath }}</code></div>
      <div><strong>+ {{ afterLabel }}</strong><code v-if="afterPath">{{ afterPath }}</code></div>
    </div>
    <FilePreview :content="after" :path="afterPath" :comparison="{ content: before, path: beforePath }" />
  </section>
</template>

<style scoped>
.file-diff-preview { min-width: 0; }
.file-diff-labels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); font-size: var(--font-size-control); }
.file-diff-labels strong { font-weight: 500; }
.file-diff-labels code { display: block; margin-top: var(--space-1); color: var(--muted); overflow-wrap: anywhere; font-size: inherit; }
@media (max-width: 760px) { .file-diff-labels { grid-template-columns: 1fr; gap: var(--space-2); } }
</style>

<script setup lang="ts">
import { NodeViewContent, nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import { computed } from 'vue'
import Icon from '../NavigationIcon.vue'

const props = defineProps(nodeViewProps)

const isOpen = computed(() => Boolean(props.node.attrs.open))
const summaryText = computed(() => typeof props.node.attrs.summary === 'string' ? props.node.attrs.summary : 'Toggle')

function toggleOpen(): void {
  props.updateAttributes({ open: !isOpen.value })
}

function updateSummary(event: Event): void {
  const target = event.target as HTMLInputElement | null
  if (target)
    props.updateAttributes({ summary: target.value })
}
</script>

<template>
  <NodeViewWrapper as="div" class="craft-toggle" :data-open="isOpen ? 'true' : 'false'" data-testid="craft-toggle">
    <div class="craft-toggle-header" contenteditable="false">
      <button
        type="button"
        class="craft-toggle-trigger"
        :aria-expanded="isOpen"
        aria-label="Toggle section"
        @click="toggleOpen"
      >
        <Icon :name="isOpen ? 'arrowDown' : 'arrowRight'" />
      </button>
      <input
        :value="summaryText"
        class="craft-toggle-summary"
        placeholder="Toggle title…"
        aria-label="Toggle title"
        @input="updateSummary"
        @keydown.stop
      />
    </div>
    <div v-show="isOpen" class="craft-toggle-body">
      <NodeViewContent class="craft-toggle-content" />
    </div>
  </NodeViewWrapper>
</template>

<style scoped>
.craft-toggle {
  margin: var(--space-3) 0;
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  background: var(--surface-subtle);
  padding: var(--space-2) var(--space-3);
}
.craft-toggle-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.craft-toggle-trigger {
  display: grid;
  width: 24px;
  height: 24px;
  flex: none;
  place-items: center;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
}
.craft-toggle-trigger:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.craft-toggle-trigger :deep(.app-icon) {
  width: 15px;
  height: 15px;
}
.craft-toggle-summary {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: var(--font-size-body);
  font-weight: 600;
}
.craft-toggle-body {
  margin-top: var(--space-2);
  border-left: 2px solid var(--border-strong);
  padding-left: var(--space-3);
  margin-left: 11px;
}
.craft-toggle-content :deep(> :first-child) {
  margin-top: 0;
}
.craft-toggle-content :deep(> :last-child) {
  margin-bottom: 0;
}
</style>

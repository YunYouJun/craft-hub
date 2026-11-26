<script setup lang="ts">
import type { DocumentCard } from 'craft-hub'
import type { PageCardExtensionOptions } from './tiptap-extensions'
import { nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import { computed } from 'vue'
import Icon from '../NavigationIcon.vue'
import VisualIcon from '../VisualIcon.vue'

const props = defineProps(nodeViewProps)

const targetRef = computed(() => typeof props.node.attrs.target === 'string' ? props.node.attrs.target : '')
const explicitLabel = computed(() => typeof props.node.attrs.label === 'string' ? props.node.attrs.label.trim() : '')

const extensionOptions = computed(() => props.extension.options as Partial<PageCardExtensionOptions>)

function normalizeRelativeTarget(currentDocPath: string, ref: string): string {
  const cleaned = ref.replaceAll('\\', '/').trim()
  if (!cleaned)
    return ''
  const slashIndex = currentDocPath.lastIndexOf('/')
  const baseDir = slashIndex > 0 ? currentDocPath.slice(0, slashIndex) : ''
  const joined = baseDir ? `${baseDir}/${cleaned}` : cleaned
  const segments: string[] = []
  for (const part of joined.split('/')) {
    if (!part || part === '.')
      continue
    if (part === '..')
      segments.pop()
    else
      segments.push(part)
  }
  return segments.join('/')
}

const resolvedTargetPath = computed(() => {
  const current = extensionOptions.value.currentDocPath?.() ?? ''
  return normalizeRelativeTarget(current, targetRef.value)
})

const matchedCard = computed<DocumentCard | undefined>(() => {
  const cards = extensionOptions.value.getCards?.() ?? []
  const resolved = resolvedTargetPath.value
  if (!resolved)
    return undefined
  return cards.find(card => card.path === resolved || card.path.startsWith(`${resolved}/`))
})

const displayTitle = computed(() => {
  if (explicitLabel.value)
    return explicitLabel.value
  if (matchedCard.value?.title)
    return matchedCard.value.title
  const fallbackName = targetRef.value.split('/').at(-1)?.replace(/\.md$/i, '')
  return fallbackName || targetRef.value || 'Subpage'
})

function openTarget(): void {
  const nextPath = matchedCard.value?.path ?? resolvedTargetPath.value
  if (nextPath)
    extensionOptions.value.openCard?.(nextPath)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    openTarget()
  }
}
</script>

<template>
  <NodeViewWrapper
    as="div"
    class="craft-page-card"
    :class="{ selected }"
    data-testid="craft-page-card"
    contenteditable="false"
  >
    <button
      type="button"
      class="craft-page-card-button"
      @click="openTarget"
      @keydown="handleKeydown"
    >
      <span class="craft-page-card-icon">
        <VisualIcon v-if="matchedCard?.icon" :icon="matchedCard.icon" :fallback="matchedCard.kind === 'bundle' ? 'folderOpen' : 'docs'" />
        <Icon v-else :name="matchedCard?.kind === 'bundle' ? 'folderOpen' : 'docs'" />
      </span>
      <span class="craft-page-card-body">
        <span class="craft-page-card-title-row">
          <strong class="craft-page-card-title">{{ displayTitle }}</strong>
          <span v-if="matchedCard?.status" class="craft-page-card-badge">{{ matchedCard.status }}</span>
        </span>
        <span v-if="matchedCard?.summary" class="craft-page-card-summary">{{ matchedCard.summary }}</span>
        <code v-else class="craft-page-card-path">{{ targetRef }}</code>
      </span>
      <Icon class="craft-page-card-arrow" name="arrowRight" />
    </button>
  </NodeViewWrapper>
</template>

<style scoped>
.craft-page-card {
  margin: var(--space-3) 0;
}
.craft-page-card-button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--panel-radius);
  background: var(--surface);
  padding: var(--space-3) var(--space-4);
  color: var(--text);
  text-align: left;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--shadow) 35%, transparent);
  transition: background-color var(--motion-duration-fast) var(--motion-ease-standard), border-color var(--motion-duration-fast) var(--motion-ease-standard), transform var(--motion-duration-fast) var(--motion-ease-spring);
}
.craft-page-card-button:hover {
  border-color: var(--border-strong);
  background: var(--surface-subtle);
}
.craft-page-card-button:focus-visible,
.craft-page-card.selected .craft-page-card-button {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
  outline: none;
}
.craft-page-card-icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: none;
  place-items: center;
  border-radius: var(--control-radius);
  background: var(--accent-soft);
  color: var(--accent);
}
.craft-page-card-body {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 2px;
}
.craft-page-card-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.craft-page-card-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-emphasis);
  font-weight: 600;
}
.craft-page-card-badge {
  border-radius: var(--radius-pill);
  background: var(--surface-muted);
  padding: 1px 8px;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
}
.craft-page-card-summary,
.craft-page-card-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
}
.craft-page-card-path {
  font-family: var(--font-mono);
}
.craft-page-card-arrow {
  width: 16px;
  height: 16px;
  flex: none;
  color: var(--muted);
}
</style>

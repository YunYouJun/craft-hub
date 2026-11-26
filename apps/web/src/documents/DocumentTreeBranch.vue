<script setup lang="ts">
import type { DocumentNode } from 'craft-hub'
import { computed } from 'vue'
import Icon from '../NavigationIcon.vue'
import VisualIcon from '../VisualIcon.vue'

const props = defineProps<{
  nodes: DocumentNode[]
  nodesByParent: Record<string, DocumentNode[]>
  expandedFolders: Record<string, boolean>
  activeDocPath: string
  activeFolderPath: string
  searchQuery: string
}>()

const emit = defineEmits<{
  toggleFolder: [folderPath: string]
  selectNode: [node: DocumentNode]
}>()

function matchesQuery(node: DocumentNode): boolean {
  const q = props.searchQuery.trim().toLowerCase()
  if (!q)
    return true
  if (
    node.title.toLowerCase().includes(q)
    || node.name.toLowerCase().includes(q)
    || (node.summary?.toLowerCase().includes(q) ?? false)
    || (node.tags?.some(tag => tag.toLowerCase().includes(q)) ?? false)
  )
    return true
  const children = props.nodesByParent[node.path] ?? []
  return children.some(matchesQuery)
}

const filteredNodes = computed(() => props.nodes.filter(matchesQuery))

function fallbackIcon(node: DocumentNode): 'folderOpen' | 'folder' | 'docs' {
  if (node.kind === 'bundle')
    return 'folderOpen'
  if (node.kind === 'folder')
    return 'folder'
  return 'docs'
}

function isSelected(node: DocumentNode): boolean {
  return (node.primaryDocumentPath ?? node.path) === props.activeDocPath
    || (!props.activeDocPath && node.path === props.activeFolderPath)
}
</script>

<template>
  <ul class="space-tree-list">
    <li v-for="node in filteredNodes" :key="node.path" class="space-tree-item">
      <div class="space-tree-row" :class="{ selected: isSelected(node) }">
        <button
          v-if="node.kind === 'folder' || node.kind === 'bundle'"
          type="button"
          class="space-tree-disclosure"
          :aria-expanded="Boolean(expandedFolders[node.path])"
          :aria-label="`Toggle ${node.title}`"
          @click.stop="emit('toggleFolder', node.path)"
        >
          <Icon :name="expandedFolders[node.path] ? 'arrowDown' : 'arrowRight'" />
        </button>
        <span v-else class="space-tree-spacer" />

        <button
          type="button"
          class="space-tree-button"
          :data-testid="`doc-tree-item-${node.path}`"
          @click="emit('selectNode', node)"
        >
          <VisualIcon v-if="node.icon" :icon="node.icon" :fallback="fallbackIcon(node)" />
          <Icon v-else :name="fallbackIcon(node)" />
          <span class="space-tree-label">{{ node.title }}</span>
          <small v-if="node.childCount !== undefined && node.kind === 'bundle'" class="space-tree-count">
            {{ node.childCount }}
          </small>
        </button>
      </div>

      <DocumentTreeBranch
        v-if="(node.kind === 'folder' || node.kind === 'bundle') && expandedFolders[node.path] && nodesByParent[node.path]?.length"
        :nodes="nodesByParent[node.path]!"
        :nodes-by-parent="nodesByParent"
        :expanded-folders="expandedFolders"
        :active-doc-path="activeDocPath"
        :active-folder-path="activeFolderPath"
        :search-query="searchQuery"
        @toggle-folder="emit('toggleFolder', $event)"
        @select-node="emit('selectNode', $event)"
      />
    </li>
  </ul>
</template>

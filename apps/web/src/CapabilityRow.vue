<script setup lang="ts">
import type { Capability } from 'craft-hub'
import { Icon } from './icons'
import { useI18n } from './i18n'

defineProps<{ capability: Capability, pinned: boolean, selected: boolean, packageContext?: boolean }>()
defineEmits<{
  dragstart: [event: DragEvent]
  drop: [event: DragEvent]
  move: [direction: -1 | 1]
  select: []
  togglePin: []
}>()
const { t } = useI18n()
</script>

<template>
  <div
    class="capability-row"
    :class="{ pinned, selected }"
    :draggable="pinned"
    :tabindex="pinned ? 0 : undefined"
    @dragstart="$emit('dragstart', $event)"
    @dragover.prevent
    @drop.prevent="$emit('drop', $event)"
    @keydown.alt.up.prevent="$emit('move', -1)"
    @keydown.alt.down.prevent="$emit('move', 1)"
  >
    <span v-if="pinned" class="capability-drag" :title="t('reorderPinned')"><Icon name="drag" /></span>
    <button class="capability-select" @click="$emit('select')">
      <span class="capability-icon"><Icon :name="capability.kind === 'command' ? 'terminal' : 'skill'" /></span>
      <span class="capability-copy">
        <strong>{{ capability.name }}</strong>
        <small v-if="capability.description" class="capability-description">{{ capability.description }}</small>
        <small class="capability-source">{{ packageContext && capability.kind === 'command' && capability.package?.relativePath !== '.' ? `${capability.package?.relativePath} · ${capability.source}` : capability.source }}</small>
      </span>
    </button>
    <button
      class="capability-pin"
      :class="{ active: pinned }"
      :aria-label="t(pinned ? 'unpinCapability' : 'pinCapability', { name: capability.name })"
      :title="t(pinned ? 'unpinCapability' : 'pinCapability', { name: capability.name })"
      :aria-pressed="pinned"
      @click="$emit('togglePin')"
    >
      <Icon :name="pinned ? 'starFilled' : 'star'" />
    </button>
  </div>
</template>

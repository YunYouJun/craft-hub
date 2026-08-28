<script setup lang="ts">
import type { Capability } from 'craft-hub'
import type { IconName } from './icons'
import { computed } from 'vue'
import { Icon } from './icons'
import { useI18n } from './i18n'

const props = defineProps<{ capability: Capability, pinned: boolean, selected: boolean, packageContext?: boolean, showSkillSource?: boolean }>()
defineEmits<{
  dragstart: [event: DragEvent]
  drop: [event: DragEvent]
  move: [direction: -1 | 1]
  select: []
  togglePin: []
}>()
const { t } = useI18n()
const highImpact = computed(() => props.capability.kind === 'command'
  && (props.capability.category === 'deploy' || /^(deploy|release|publish)(:|$)/i.test(props.capability.name)))
const firstRunFriendly = computed(() => props.capability.kind === 'command'
  && !highImpact.value
  && new Set<string>(['develop', 'build', 'test', 'quality']).has(props.capability.category ?? 'other'))
const showSource = computed(() => props.capability.kind === 'command' || props.showSkillSource)
const sourceLabel = computed(() => {
  if (props.capability.kind === 'command')
    return props.packageContext && props.capability.package?.relativePath !== '.' ? `${props.capability.package?.relativePath} · ${props.capability.source}` : props.capability.source
  if (props.capability.source === 'agent-skill')
    return t('skillSource_agent')
  if (props.capability.source === 'claude-skill')
    return t('skillSource_claude')
  if (props.capability.source === 'codex-skill')
    return t('skillSource_codex')
  if (props.capability.source.startsWith('plugin:')) {
    const packageSpec = props.capability.source.slice('plugin:'.length)
    const versionSeparator = packageSpec.lastIndexOf('@')
    const packageName = versionSeparator > 0 ? packageSpec.slice(0, versionSeparator) : packageSpec
    return t('skillSource_plugin', { name: packageName })
  }
  return props.capability.source
})
const sourceIcon = computed<IconName | undefined>(() => {
  if (props.capability.kind === 'command')
    return undefined
  if (props.capability.source === 'codex-skill')
    return 'codex'
  if (props.capability.source.startsWith('plugin:'))
    return 'plugins'
  return 'source'
})
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
        <span class="capability-heading">
          <strong>{{ capability.name }}</strong>
          <span v-if="firstRunFriendly || highImpact" class="capability-guidance" :class="{ warning: highImpact }">{{ t(highImpact ? 'highImpactCommand' : 'firstRunFriendly') }}</span>
        </span>
        <small v-if="capability.description" class="capability-description">{{ capability.description }}</small>
        <small v-if="showSource" class="capability-source" :title="capability.kind === 'skill' ? capability.source : undefined">
          <Icon v-if="sourceIcon" :name="sourceIcon" />{{ sourceLabel }}
        </small>
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

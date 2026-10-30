<script setup lang="ts">
import type { MarketplacePackMember } from 'craft-hub/marketplace-model'
import { Icon } from './icons'
import { pluginIconUrl, usePluginIconFallback } from './plugin-icon'

const props = defineProps<{ members: MarketplacePackMember[] }>()
const { visibleIcon, markIconFailed } = usePluginIconFallback()
function icon(member: MarketplacePackMember): string | undefined {
  return visibleIcon(member.version ? pluginIconUrl({ ...member, version: member.version }, member.icon) : undefined)
}
</script>

<template>
  <span class="plugin-pack-icon" data-testid="plugin-pack-icon" aria-hidden="true">
    <span v-for="member in props.members.slice(0, 4)" :key="member.package" class="plugin-pack-icon-cell">
      <img v-if="icon(member)" :src="icon(member)" alt="" referrerpolicy="no-referrer" @error="markIconFailed(icon(member))">
      <Icon v-else name="plugins" />
    </span>
    <span v-if="members.length > 4" class="plugin-pack-icon-more">+{{ members.length - 4 }}</span>
  </span>
</template>

<style scoped>
.plugin-pack-icon { position: relative; display: grid; width: 44px; height: 44px; flex: none; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 3px; border: 1px solid var(--border); border-radius: 11px; background: var(--surface-subtle); padding: 4px; }
.plugin-pack-icon-cell { display: grid; min-width: 0; place-items: center; overflow: hidden; border-radius: 4px; background: var(--surface); color: var(--accent); }
.plugin-pack-icon-cell img { width: 100%; height: 100%; object-fit: contain; }
.plugin-pack-icon-cell .app-icon { width: 12px; height: 12px; }
.plugin-pack-icon-more { position: absolute; right: -5px; bottom: -5px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); padding: 0 3px; color: var(--text-secondary); font-size: 9px; line-height: 14px; }
</style>

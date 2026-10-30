<script setup lang="ts">
import type { MarketplacePackMember } from 'craft-hub/marketplace-model'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { pluginIconUrl, usePluginIconFallback } from './plugin-icon'
import { pluginDisplayName } from './plugin-text'

defineProps<{ members: MarketplacePackMember[] }>()
const emit = defineEmits<{ navigate: [member: MarketplacePackMember] }>()
const { locale, t } = useI18n()
const { visibleIcon, markIconFailed } = usePluginIconFallback()
function icon(member: MarketplacePackMember): string | undefined {
  return visibleIcon(member.version ? pluginIconUrl({ ...member, version: member.version }, member.icon) : undefined)
}
</script>

<template>
  <section class="plugin-pack-members" :aria-label="t('pluginPackContents')">
    <strong>{{ t('pluginPackContentsWithCount', { count: String(members.length) }) }}</strong>
    <div class="plugin-pack-member-list">
      <button v-for="member in members" :key="member.package" type="button" :disabled="!member.version" :title="`${member.package} · ${member.version ?? member.range}`" @click="emit('navigate', member)">
        <img v-if="icon(member)" :src="icon(member)" alt="" referrerpolicy="no-referrer" @error="markIconFailed(icon(member))">
        <Icon v-else name="plugins" />
        <span>{{ pluginDisplayName(member, locale) }}</span>
        <small v-if="member.status === 'blocked' || member.error" class="member-error">{{ t('pluginPackError') }}</small>
        <small v-else-if="!member.version">{{ t('pluginUnavailableFromSource') }}</small>
        <small v-else-if="member.installed">{{ t(member.enabled ? 'pluginPackEnabled' : 'pluginPackDisabled') }}</small>
      </button>
    </div>
  </section>
</template>

<style scoped>
.plugin-pack-members { display: grid; grid-column: 1 / -1; gap: 8px; min-width: 0; border-top: 1px solid var(--border); padding-top: 12px; }
.plugin-pack-members > strong { color: var(--muted); font-size: var(--font-size-caption); font-weight: 500; }
.plugin-pack-member-list { display: flex; flex-wrap: wrap; gap: 6px; }
.plugin-pack-member-list button { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-subtle); padding: 6px 9px; color: var(--text); font-size: var(--font-size-caption); }
.plugin-pack-member-list button:not(:disabled):hover { border-color: var(--accent); background: var(--accent-soft); }
.plugin-pack-member-list button:disabled { color: var(--muted); cursor: default; }
.plugin-pack-member-list img, .plugin-pack-member-list .app-icon { width: 18px; height: 18px; flex: none; object-fit: contain; border-radius: 4px; }
.plugin-pack-member-list span { overflow-wrap: anywhere; }
.plugin-pack-member-list small { color: var(--muted); }
.plugin-pack-member-list .member-error { color: var(--danger); }
</style>

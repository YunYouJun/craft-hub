<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { computed } from 'vue'
import AccountMenu from './AccountMenu.vue'
import { useI18n } from './i18n'
import Icon from './NavigationIcon.vue'
import { desktopSidebarShortcut, formatShortcut } from './shortcuts'

const props = withDefaults(defineProps<{
  title: string
  projectName: string
  sidebarCollapsed: boolean
  canGoBack: boolean
  canGoForward: boolean
  refreshing: boolean
  paletteShortcutLabel: string
  paletteOpen: boolean
  paletteMode: 'all' | 'projects' | 'commands'
  desktopMac?: boolean
  mobileNavigationOpen?: boolean
}>(), { desktopMac: false, mobileNavigationOpen: false })
const emit = defineEmits<{
  toggleSidebar: []
  toggleMobileNavigation: []
  back: []
  forward: []
  refresh: []
  openPalette: [mode: 'all' | 'projects' | 'commands']
}>()
const { t, locale } = useI18n()
const desktopViewport = useMediaQuery('(min-width: 761px)')
const copy = (zh: string, en: string): string => locale.value === 'zh-CN' ? zh : en
const shortcutPlatform = computed(() => props.desktopMac ? 'MacIntel' : navigator.platform)
const shortcut = (value: string): string => formatShortcut(value, shortcutPlatform.value)
const sidebarShortcutLabel = computed(() => shortcut(desktopSidebarShortcut(shortcutPlatform.value)))
const sidebarLabel = computed(() => props.sidebarCollapsed ? copy('展开侧栏', 'Expand sidebar') : copy('收起侧栏', 'Collapse sidebar'))
</script>

<template>
  <header class="workbench-titlebar workbench-toolbar" :class="{ 'desktop-mac': desktopMac }" :aria-label="t('paletteTitlebar')">
    <div class="toolbar-leading">
      <button class="toolbar-icon-button mobile-navigation-toggle" type="button" aria-controls="workbench-primary-navigation" :aria-label="copy('切换导航', 'Toggle navigation')" :aria-expanded="mobileNavigationOpen" @click="emit('toggleMobileNavigation')"><Icon name="list" /></button>
      <div class="toolbar-history desktop-toolbar-control" :aria-label="copy('浏览历史', 'Navigation history')">
        <button class="toolbar-icon-button toolbar-back" type="button" :disabled="!canGoBack" :aria-label="copy('返回', 'Back')" :title="`${copy('返回', 'Back')} (${shortcut('Mod+[')})`" @click="emit('back')"><svg aria-hidden="true" class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6" /></svg></button>
        <button class="toolbar-icon-button toolbar-forward" type="button" :disabled="!canGoForward" :aria-label="copy('前进', 'Forward')" :title="`${copy('前进', 'Forward')} (${shortcut('Mod+]')})`" @click="emit('forward')"><svg aria-hidden="true" class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m10 6 6 6-6 6" /></svg></button>
      </div>
      <button class="toolbar-icon-button sidebar-toggle desktop-toolbar-control" type="button" aria-controls="workbench-primary-navigation" :aria-label="sidebarLabel" :aria-expanded="!sidebarCollapsed" :title="`${sidebarLabel} (${sidebarShortcutLabel})`" @click="emit('toggleSidebar')">
        <svg aria-hidden="true" class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M5.5 8h1M5.5 12h1M5.5 16h1" /></svg>
      </button>
      <span class="toolbar-section-title desktop-toolbar-control" :title="title">{{ title }}</span>
    </div>
    <div class="toolbar-palette-controls">
      <button class="titlebar-project" type="button" aria-haspopup="dialog" :aria-expanded="paletteOpen && paletteMode === 'projects'" :title="`${t('paletteFindProject')} (${shortcut('Mod+P')})`" @click="emit('openPalette', 'projects')"><Icon name="folder" /><span>{{ projectName }}</span><Icon name="arrowDown" /><kbd>{{ shortcut('Mod+P') }}</kbd></button>
      <button class="titlebar-search" type="button" aria-haspopup="dialog" :aria-expanded="paletteOpen && paletteMode === 'all'" :aria-label="t('paletteFindAnything')" :title="`${t('paletteFindAnything')} (${paletteShortcutLabel})`" @click="emit('openPalette', 'all')"><Icon name="search" /><span class="titlebar-label">{{ t('paletteFindAnything') }}</span><kbd>{{ paletteShortcutLabel }}</kbd></button>
    </div>
    <div v-if="desktopViewport" class="toolbar-trailing desktop-toolbar-control">
      <button class="toolbar-icon-button toolbar-refresh" type="button" :disabled="refreshing" :aria-busy="refreshing" :aria-label="t('refresh')" :title="`${t('refresh')} (${shortcut('Mod+Shift+R')})`" @click="emit('refresh')"><Icon :name="refreshing ? 'loading' : 'refresh'" /></button>
      <AccountMenu placement="toolbar" />
    </div>
  </header>
</template>

<style scoped>
.workbench-toolbar.workbench-titlebar { display: flex; align-items: center; justify-content: flex-start; gap: 16px; min-width: 0; min-height: 44px; padding: 6px 12px; background: var(--workbench-chrome); border-bottom: 1px solid var(--border); }
.workbench-toolbar.workbench-titlebar.desktop-mac { padding-left: 86px; -webkit-app-region: drag; }
.toolbar-leading, .toolbar-palette-controls, .toolbar-trailing, .toolbar-history { display: flex; align-items: center; gap: 4px; min-width: 0; }
.toolbar-leading, .toolbar-trailing { flex: none; }
.toolbar-palette-controls { flex: 1; justify-content: center; gap: 12px; }
.toolbar-trailing { gap: 8px; margin-left: auto; -webkit-app-region: no-drag; }
.workbench-toolbar.workbench-titlebar button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; height: 32px; padding: 0 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 400; line-height: 1.4; cursor: pointer; -webkit-app-region: no-drag; }
.workbench-toolbar.workbench-titlebar button:hover:not(:disabled) { background: var(--surface-hover); color: var(--text); }
.workbench-toolbar.workbench-titlebar button:disabled { opacity: .4; cursor: default; }
.workbench-toolbar.workbench-titlebar button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.workbench-toolbar.workbench-titlebar .toolbar-icon-button { flex: none; width: 32px; padding: 0; }
.toolbar-icon, .workbench-toolbar :deep(.app-icon) { flex: none; width: 17px; height: 17px; }
.toolbar-section-title { display: block; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 6px; color: var(--text); font-size: 13px; font-weight: 600; }
.workbench-toolbar.workbench-titlebar .titlebar-project { flex: 0 1 240px; max-width: 240px; justify-content: flex-start; }
.workbench-toolbar.workbench-titlebar .titlebar-project > span:not(.app-icon) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workbench-toolbar.workbench-titlebar .titlebar-search { position: static; transform: none; flex: 1 1 360px; width: auto; max-width: 420px; border-color: var(--border); background: var(--surface); justify-content: flex-start; }
.titlebar-label { flex: 1; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workbench-toolbar kbd { flex: none; color: var(--muted); font-size: 10px; font-weight: 400; }
.workbench-toolbar.workbench-titlebar .mobile-navigation-toggle { display: none; }
@media (min-width: 761px) and (max-width: 1080px) { .toolbar-section-title { display: none; } .toolbar-palette-controls { gap: 6px; } .workbench-toolbar.workbench-titlebar { gap: 8px; } .workbench-toolbar.workbench-titlebar .titlebar-project { max-width: 200px; } }
@media (max-width: 760px) {
  .workbench-toolbar.workbench-titlebar, .workbench-toolbar.workbench-titlebar.desktop-mac { gap: 4px; min-height: 56px; padding: 6px; -webkit-app-region: no-drag; }
  .workbench-toolbar.workbench-titlebar.desktop-mac { padding-left: 86px; -webkit-app-region: drag; }
  .workbench-toolbar.workbench-titlebar .desktop-toolbar-control { display: none; }
  .workbench-toolbar.workbench-titlebar .mobile-navigation-toggle { display: inline-flex; width: 44px; height: 44px; }
  .toolbar-palette-controls { flex: 1; gap: 4px; }
  .workbench-toolbar.workbench-titlebar button { height: 44px; min-height: 44px; }
  .workbench-toolbar.workbench-titlebar .titlebar-project { flex: 1; max-width: none; padding-inline: 8px; }
  .workbench-toolbar.workbench-titlebar .titlebar-search { flex: none; width: 44px; padding: 0; justify-content: center; border-color: transparent; background: transparent; }
  .workbench-toolbar kbd, .workbench-toolbar .titlebar-label { display: none; }
}
@media (pointer: coarse) and (min-width: 761px) {
  .workbench-toolbar.workbench-titlebar { min-height: 56px; }
  .workbench-toolbar.workbench-titlebar button, .workbench-toolbar.workbench-titlebar .toolbar-icon-button { height: 44px; min-height: 44px; }
  .workbench-toolbar.workbench-titlebar .toolbar-icon-button { width: 44px; }
  .workbench-toolbar :deep(.account-menu--toolbar .account-trigger) { width: 44px; height: 44px; min-height: 44px; }
}
</style>

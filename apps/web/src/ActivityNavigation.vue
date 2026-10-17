<script setup lang="ts">
import type { WorkbenchSidebarSetting } from 'craft-hub'
import type { ActivityNavigationItem, SidebarEntryGroup } from './sidebar-navigation'
import { useMediaQuery } from '@vueuse/core'
import { ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuRoot, ContextMenuTrigger, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, ref } from 'vue'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { useI18n } from './i18n'
import Icon from './NavigationIcon.vue'
import { addSidebarSeparator, groupSidebarEntries, isSidebarUtility, moveSidebarEntry, removeSidebarEntry, resolveSidebarEntries, retainSidebarSeparatorGroups, setSidebarItemVisible, sidebarEntryGroup, visibleSidebarEntries } from './sidebar-navigation'
import VisualIcon from './VisualIcon.vue'

const props = withDefaults(defineProps<{
  items: ActivityNavigationItem[]
  setting: WorkbenchSidebarSetting
  collapsed: boolean
  saving?: boolean
  error?: string
}>(), { saving: false, error: '' })
const emit = defineEmits<{ activate: [id: string], update: [setting: WorkbenchSidebarSetting] }>()
const { locale } = useI18n()
const horizontal = useMediaQuery('(max-width: 760px)')
const moreOpen = ref(false)
const customizeOpen = ref(false)
const draggedId = ref('')
const dropTarget = ref<{ id: string, position: 'before' | 'after' }>()
const dragType = 'application/x-craft-hub-sidebar-entry'
const copy = (en: string, zh: string): string => locale.value === 'zh-CN' ? zh : en
const itemsById = computed(() => new Map(props.items.map(item => [item.id, item])))
const entries = computed(() => resolveSidebarEntries(props.items, props.setting))
const currentSetting = computed(() => retainSidebarSeparatorGroups({ entries: entries.value }))
const entryGroups = computed(() => groupSidebarEntries(entries.value))
const primaryGroups = computed(() => (['builtins', 'plugins'] as const).map(kind => ({
  kind,
  rows: visibleSidebarEntries(props.items.filter(item => groupOf(item.id) === kind), { entries: entryGroups.value[kind] }).map(entry => ({ entry, item: itemsById.value.get(entry.id) })),
})).filter(group => group.kind === 'builtins' || group.rows.length))
const railGroups = computed(() => [
  { kind: 'primary', sections: primaryGroups.value },
  { kind: 'utilities', sections: [{ kind: 'utilities', rows: entryGroups.value.utilities.filter(entry => entry.kind === 'item' && entry.visible && itemsById.value.has(entry.id)).map(entry => ({ entry, item: itemsById.value.get(entry.id) })) }] },
].filter(group => group.kind === 'primary' || group.sections[0]?.rows.length))
const customizationRows = computed(() => [...entryGroups.value.builtins, ...entryGroups.value.plugins, ...entryGroups.value.utilities]
  .filter(entry => entry.kind === 'separator' || itemsById.value.has(entry.id)).map(entry => ({ entry, item: itemsById.value.get(entry.id) })))
const menuItems = computed(() => customizationRows.value.flatMap(row => row.item ? [row.item] : []))
const hiddenActive = computed(() => props.items.some(item => item.active && !isVisible(item.id)))

function groupOf(id: string): SidebarEntryGroup {
  return sidebarEntryGroup(entries.value, id)
}

function isVisible(id: string): boolean {
  return entries.value.some(entry => entry.kind === 'item' && entry.id === id && entry.visible)
}

function activate(id: string): void {
  if (draggedId.value)
    return
  moreOpen.value = false
  emit('activate', id)
}

function update(setting: WorkbenchSidebarSetting): void {
  if (!props.saving)
    emit('update', setting)
}

function changeVisibility(id: string, visible: boolean): void {
  update(setSidebarItemVisible(currentSetting.value, id, visible))
}

function addSeparator(afterId: string): void {
  update(addSidebarSeparator(currentSetting.value, afterId))
}

function move(id: string, direction: -1 | 1): void {
  const rows = customizationRows.value
  const index = rows.findIndex(row => row.entry.id === id)
  const target = rows[index + direction]
  if (target && groupOf(id) === groupOf(target.entry.id))
    update(moveSidebarEntry(currentSetting.value, id, target.entry.id, direction === -1 ? 'before' : 'after'))
}

function canMove(id: string, direction: -1 | 1): boolean {
  const rows = customizationRows.value
  const target = rows[rows.findIndex(row => row.entry.id === id) + direction]
  return Boolean(target && groupOf(id) === groupOf(target.entry.id))
}

function openCustomization(): void {
  moreOpen.value = false
  customizeOpen.value = true
}

function startDrag(event: DragEvent, id: string): void {
  if (props.saving || !event.dataTransfer) {
    event.preventDefault()
    return
  }
  draggedId.value = id
  event.dataTransfer.setData(dragType, id)
  event.dataTransfer.effectAllowed = 'move'
}

function endDrag(): void {
  draggedId.value = ''
  dropTarget.value = undefined
}

function canDrop(event: DragEvent, id: string): boolean {
  return !props.saving && Boolean(draggedId.value) && draggedId.value !== id
    && groupOf(draggedId.value) === groupOf(id)
    && Boolean(event.dataTransfer?.types.includes(dragType))
}

function dropPosition(event: DragEvent, horizontalLayout: boolean): 'before' | 'after' {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return horizontalLayout
    ? event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
    : event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function dragOver(event: DragEvent, id: string, horizontalLayout = false): void {
  if (!canDrop(event, id))
    return
  event.preventDefault()
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = 'move'
  dropTarget.value = { id, position: dropPosition(event, horizontalLayout) }
}

function drop(event: DragEvent, id: string, horizontalLayout = false): void {
  if (!canDrop(event, id) || event.dataTransfer?.getData(dragType) !== draggedId.value) {
    endDrag()
    return
  }
  event.preventDefault()
  update(moveSidebarEntry(currentSetting.value, draggedId.value, id, dropPosition(event, horizontalLayout)))
  endDrag()
}

function dragClasses(id: string): Record<string, boolean> {
  return {
    'sidebar-dragging': draggedId.value === id,
    'sidebar-drop-before': dropTarget.value?.id === id && dropTarget.value.position === 'before',
    'sidebar-drop-after': dropTarget.value?.id === id && dropTarget.value.position === 'after',
  }
}
</script>

<template>
  <nav
    id="workbench-primary-navigation"
    class="activity-rail sidebar-navigation"
    :class="{ 'sidebar-navigation-collapsed': collapsed }"
    :aria-label="copy('Main navigation', '主导航')"
  >
    <div v-for="group in railGroups" :key="group.kind" :class="`sidebar-${group.kind}`">
      <div v-for="section in group.sections" :key="section.kind" :class="`sidebar-${section.kind}-entries`">
        <div v-if="section.kind === 'plugins'" role="separator" class="sidebar-divider sidebar-plugin-divider" data-testid="sidebar-plugin-divider" :aria-label="copy('Plugin navigation', '插件导航')" :aria-orientation="horizontal ? 'vertical' : 'horizontal'" />
        <template v-for="row in section.rows" :key="row.entry.id">
          <ContextMenuRoot v-if="row.item">
            <ContextMenuTrigger as-child>
              <button
                type="button"
                class="activity-button"
                :class="[row.item.className, { active: row.item.active, attention: row.item.attention }, dragClasses(row.entry.id)]"
                :data-sidebar-entry="row.entry.id"
                :data-testid="row.item.testId"
                :aria-label="row.item.title"
                :aria-current="row.item.active ? 'page' : undefined"
                :title="row.item.title"
                :draggable="!saving"
                @click="activate(row.entry.id)"
                @dragstart="startDrag($event, row.entry.id)"
                @dragend="endDrag"
                @dragover="dragOver($event, row.entry.id, horizontal)"
                @dragleave="dropTarget = undefined"
                @drop="drop($event, row.entry.id, horizontal)"
              >
                <Icon v-if="row.item.builtinIcon" :name="row.item.builtinIcon" />
                <VisualIcon v-else :icon="row.item.icon" fallback="plugins" />
                <span class="activity-label">{{ row.item.shortTitle || row.item.title }}</span>
                <span v-if="row.item.badge" class="activity-badge" aria-hidden="true">{{ row.item.badge }}</span>
              </button>
            </ContextMenuTrigger>
            <ContextMenuPortal>
              <ContextMenuContent class="sidebar-context-menu" :collision-padding="8">
                <ContextMenuItem :disabled="saving" @select="changeVisibility(row.entry.id, false)">{{ copy('Hide from sidebar', '从侧栏隐藏') }}</ContextMenuItem>
                <ContextMenuItem v-if="!isSidebarUtility(row.entry.id)" :disabled="saving" @select="addSeparator(row.entry.id)">{{ copy('Add divider after', '在下方添加分割线') }}</ContextMenuItem>
                <ContextMenuItem @select="openCustomization">{{ copy('Customize sidebar…', '自定义侧栏…') }}</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenuPortal>
          </ContextMenuRoot>
          <div
            v-else
            role="separator"
            class="sidebar-divider"
            :class="dragClasses(row.entry.id)"
            :data-sidebar-entry="row.entry.id"
            :aria-label="copy('Group divider', '分组分割线')"
            :aria-orientation="horizontal ? 'vertical' : 'horizontal'"
            :title="copy('Drag to move divider', '拖拽调整分割线位置')"
            :draggable="!saving"
            @dragstart="startDrag($event, row.entry.id)"
            @dragend="endDrag"
            @dragover="dragOver($event, row.entry.id, horizontal)"
            @dragleave="dropTarget = undefined"
            @drop="drop($event, row.entry.id, horizontal)"
          />
        </template>
        <PopoverRoot v-if="section.kind === 'builtins'" v-model:open="moreOpen">
          <PopoverTrigger as-child>
            <button type="button" class="activity-button sidebar-more" :class="{ active: hiddenActive }" data-testid="sidebar-more" :aria-label="copy('More navigation', '更多导航')" :title="copy('More navigation', '更多导航')">
              <Icon name="more" /><span class="activity-label">{{ copy('More', '更多') }}</span>
            </button>
          </PopoverTrigger>
          <PopoverPortal>
            <PopoverContent class="sidebar-more-menu" :side="horizontal ? 'bottom' : 'right'" align="start" :side-offset="10" :collision-padding="8" :aria-label="copy('All navigation', '全部导航')">
              <div v-for="item in menuItems" :key="item.id" class="sidebar-menu-row">
                <button type="button" class="sidebar-menu-navigation" :class="{ active: item.active }" :aria-current="item.active ? 'page' : undefined" :data-sidebar-menu-item="item.id" @click="activate(item.id)">
                  <Icon v-if="item.builtinIcon" :name="item.builtinIcon" />
                  <VisualIcon v-else :icon="item.icon" fallback="plugins" />
                  <span>{{ item.title }}</span>
                </button>
                <button
                  type="button"
                  class="sidebar-pin"
                  :class="{ pinned: isVisible(item.id) }"
                  :aria-label="isVisible(item.id) ? copy(`Hide ${item.title} from sidebar`, `从侧栏隐藏${item.title}`) : copy(`Show ${item.title} in sidebar`, `在侧栏显示${item.title}`)"
                  :title="isVisible(item.id) ? copy('Hide from sidebar', '从侧栏隐藏') : copy('Show in sidebar', '在侧栏显示')"
                  :aria-pressed="isVisible(item.id)"
                  :disabled="saving"
                  :data-sidebar-pin="item.id"
                  @click="changeVisibility(item.id, !isVisible(item.id))"
                >
                  <span aria-hidden="true" class="app-icon i-lucide-pin" />
                </button>
              </div>
              <div class="sidebar-menu-footer">
                <button type="button" data-testid="customize-sidebar" @click="openCustomization"><Icon name="settings" />{{ copy('Customize sidebar…', '自定义侧栏…') }}</button>
                <p v-if="error" class="sidebar-save-error" role="alert">{{ error }}</p>
              </div>
            </PopoverContent>
          </PopoverPortal>
        </PopoverRoot>
      </div>
    </div>
    <slot />
  </nav>

  <DialogShell v-model:open="customizeOpen" layout="panel" content-class="dialog-content sidebar-customization-dialog" data-testid="sidebar-customization-dialog">
    <template #title>{{ copy('Customize sidebar', '自定义侧栏') }}</template>
    <template #description>{{ copy('Drag entries within each group, add dividers, and choose which icons appear. Built-in tabs and plugins stay separate; application management stays at the bottom. Hidden entries stay available in More.', '拖拽调整组内顺序，添加分割线，并选择展示的图标。内置标签页与插件分组展示，管理入口保留在左下角。隐藏的入口仍可从「更多」中打开。') }}</template>
    <template #header-actions><UiButton size="icon" variant="ghost" :aria-label="copy('Close', '关闭')" @click="customizeOpen = false"><Icon name="close" /></UiButton></template>
    <ol class="sidebar-customization-list" :aria-label="copy('Sidebar order', '侧栏顺序')">
      <li
        v-for="row in customizationRows"
        :key="row.entry.id"
        class="sidebar-customization-row"
        :class="[{ 'is-divider': !row.item }, dragClasses(row.entry.id)]"
        :data-sidebar-entry="row.entry.id"
        :draggable="!saving"
        @dragstart="startDrag($event, row.entry.id)"
        @dragend="endDrag"
        @dragover="dragOver($event, row.entry.id)"
        @dragleave="dropTarget = undefined"
        @drop="drop($event, row.entry.id)"
      >
        <Icon name="drag" class="sidebar-drag-handle" />
        <label v-if="row.item" class="sidebar-customization-item">
          <input type="checkbox" :checked="isVisible(row.entry.id)" :disabled="saving" :aria-label="copy(`Show ${row.item.title} in sidebar`, `在侧栏显示${row.item.title}`)" @change="changeVisibility(row.entry.id, ($event.target as HTMLInputElement).checked)">
          <Icon v-if="row.item.builtinIcon" :name="row.item.builtinIcon" />
          <VisualIcon v-else :icon="row.item.icon" fallback="plugins" />
          <span>{{ row.item.title }}</span>
        </label>
        <span v-else class="sidebar-customization-divider">{{ copy('Divider', '分割线') }}</span>
        <div class="sidebar-order-actions">
          <UiButton size="icon" variant="ghost" :disabled="saving || !canMove(row.entry.id, -1)" :aria-label="copy(`Move ${row.item?.title || 'divider'} up`, `上移${row.item?.title || '分割线'}`)" @click="move(row.entry.id, -1)"><span aria-hidden="true" class="app-icon i-lucide-chevron-up" /></UiButton>
          <UiButton size="icon" variant="ghost" :disabled="saving || !canMove(row.entry.id, 1)" :aria-label="copy(`Move ${row.item?.title || 'divider'} down`, `下移${row.item?.title || '分割线'}`)" @click="move(row.entry.id, 1)"><span aria-hidden="true" class="app-icon i-lucide-chevron-down" /></UiButton>
          <UiButton v-if="row.item && !isSidebarUtility(row.entry.id)" size="icon" variant="ghost" :disabled="saving" :aria-label="copy(`Add divider after ${row.item.title}`, `在${row.item.title}后添加分割线`)" @click="addSeparator(row.entry.id)"><Icon name="plus" /></UiButton>
          <UiButton v-else-if="!row.item" size="icon" variant="ghost" :disabled="saving" :aria-label="copy('Remove divider', '移除分割线')" @click="update(removeSidebarEntry(currentSetting, row.entry.id))"><Icon name="close" /></UiButton>
        </div>
      </li>
    </ol>
    <p v-if="error" class="sidebar-save-error" role="alert">{{ error }}</p>
    <p v-else-if="saving" class="sidebar-save-status" role="status">{{ copy('Saving…', '保存中…') }}</p>
    <template #footer>
      <UiButton :disabled="saving" data-testid="reset-sidebar" @click="update({ entries: [] })">{{ copy('Reset to default', '恢复默认') }}</UiButton>
      <UiButton variant="primary" @click="customizeOpen = false">{{ copy('Done', '完成') }}</UiButton>
    </template>
  </DialogShell>
</template>

<style scoped>
.sidebar-navigation { align-items: stretch; gap: 2px; padding: 10px 8px 8px; }
.sidebar-primary, .sidebar-utilities, .sidebar-builtins-entries, .sidebar-plugins-entries, .sidebar-utilities-entries { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sidebar-primary { min-height: 0; overflow-y: auto; scrollbar-width: none; }
.sidebar-utilities { flex: none; margin-top: auto; padding-top: 8px; }
.sidebar-navigation .activity-button { display: flex; align-items: center; gap: 9px; width: 100%; height: 32px; min-width: 0; padding: 0 10px; border-radius: 6px; text-align: start; transition: background-color 160ms ease, color 160ms ease, padding 220ms var(--motion-ease-standard); }
.sidebar-navigation .activity-button > .app-icon, .sidebar-navigation .activity-button > .visual-icon { width: 18px; height: 18px; flex: none; }
.activity-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; line-height: 1.3; transition: opacity 120ms ease 100ms; }
.sidebar-navigation .activity-badge { position: static; flex: none; height: 18px; min-width: 18px; border: 0; border-radius: 9px; padding: 0 4px; font-size: 10px; }
/*
 * Collapsing keeps the expanded geometry: rows stay full width and icons hold their place while the rail narrows, and
 * labels fade out first (in last on expand) instead of reflowing.
 */
.sidebar-navigation-collapsed .activity-button { padding-inline: 9px; }
.sidebar-navigation-collapsed .activity-label { opacity: 0; transition-delay: 0ms; }
.sidebar-navigation-collapsed .activity-badge { position: absolute; top: -2px; right: -2px; height: 16px; min-width: 16px; border: 1px solid var(--activity-rail); font-size: 9px; }
.sidebar-divider { position: relative; flex: none; height: 15px; margin-inline: 10px; cursor: grab; transition: margin 220ms var(--motion-ease-standard); }
.sidebar-divider::after { content: ''; position: absolute; top: 7px; inset-inline: 0; height: 1px; background: var(--border); }
.sidebar-plugin-divider { cursor: default; }
.sidebar-navigation-collapsed .sidebar-divider { margin-inline: 5px; }
.sidebar-dragging { opacity: .4; }
.sidebar-drop-before { box-shadow: 0 -2px 0 var(--accent); }
.sidebar-drop-after { box-shadow: 0 2px 0 var(--accent); }
:global(.sidebar-more-menu), :global(.sidebar-context-menu) { z-index: 60; width: 280px; max-width: calc(100vw - 24px); border: 1px solid var(--menu-border); border-radius: 14px; background: var(--menu-background); color: var(--text); box-shadow: var(--menu-shadow); padding: 8px; }
:global(.sidebar-more-menu) { max-height: min(560px, var(--reka-popover-content-available-height)); overflow: auto; }
.sidebar-menu-row { display: flex; align-items: center; gap: 2px; }
.sidebar-menu-navigation { display: flex; align-items: center; gap: 11px; flex: 1; min-width: 0; min-height: 38px; border-radius: 7px; background: transparent; padding: 7px 9px; color: var(--text); text-align: start; font-size: 13px; }
.sidebar-menu-navigation > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sidebar-menu-navigation > .app-icon, .sidebar-menu-navigation > .visual-icon { flex: none; width: 20px; height: 20px; }
.sidebar-menu-navigation.active { color: var(--accent); background: var(--accent-soft); }
.sidebar-pin { display: grid; place-items: center; flex: none; width: 32px; height: 32px; border-radius: 6px; background: transparent; color: var(--muted); opacity: .45; }
.sidebar-pin.pinned { opacity: 1; }
.sidebar-pin .app-icon { width: 16px; height: 16px; }
.sidebar-menu-navigation:hover, .sidebar-pin:hover, .sidebar-menu-footer button:hover { background: var(--surface-hover); }
.sidebar-menu-navigation:focus-visible, .sidebar-pin:focus-visible, .sidebar-menu-footer button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
.sidebar-pin:disabled { opacity: .35; cursor: default; }
.sidebar-menu-footer { margin-top: 6px; border-top: 1px solid var(--border); padding-top: 6px; }
.sidebar-menu-footer button { display: flex; align-items: center; gap: 11px; width: 100%; min-height: 36px; border-radius: 7px; padding: 7px 9px; background: transparent; color: var(--muted); font-size: 13px; text-align: start; }
.sidebar-menu-footer .app-icon { width: 18px; height: 18px; }
:global(.sidebar-context-menu) { width: 228px; border-radius: 10px; padding: 5px; }
:global(.sidebar-context-menu [role='menuitem']) { border-radius: 6px; padding: 9px 10px; font-size: 13px; outline: none; cursor: pointer; }
:global(.sidebar-context-menu [data-highlighted]) { background: var(--surface-hover); }
:global(.sidebar-context-menu [data-disabled]) { opacity: .45; cursor: default; }
:global(.sidebar-customization-dialog) { --dialog-panel-width: 580px; }
.sidebar-customization-list { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
.sidebar-customization-row { position: relative; display: flex; align-items: center; gap: 10px; min-height: 46px; border: 1px solid var(--border); border-radius: 8px; padding: 5px 8px; background: var(--surface); }
.sidebar-customization-row > .sidebar-drag-handle { flex: none; width: 16px; height: 16px; color: var(--muted); cursor: grab; }
.sidebar-customization-item { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; font-size: 13px; cursor: pointer; }
.sidebar-customization-item input { width: 15px; height: 15px; flex: none; accent-color: var(--accent); }
.sidebar-customization-item > .app-icon, .sidebar-customization-item > .visual-icon { flex: none; width: 18px; height: 18px; }
.sidebar-customization-item > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sidebar-customization-divider { display: flex; align-items: center; gap: 10px; flex: 1; color: var(--muted); font-size: 12px; }
.sidebar-customization-divider::after { content: ''; height: 1px; flex: 1; background: var(--border); }
.sidebar-order-actions { display: flex; align-items: center; gap: 2px; flex: none; }
.sidebar-order-actions .ui-button { width: 28px; height: 28px; }
.sidebar-order-actions .app-icon { width: 15px; height: 15px; }
.sidebar-save-error { color: var(--danger); font-size: 12px; margin: 8px 4px; overflow-wrap: anywhere; }
.sidebar-save-status { color: var(--muted); font-size: 12px; }

@media (max-width: 760px) {
  .sidebar-navigation, .sidebar-navigation-collapsed { flex-direction: row; justify-content: flex-start; gap: 4px; padding: 4px 8px; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--border); }
  .sidebar-primary, .sidebar-utilities, .sidebar-builtins-entries, .sidebar-plugins-entries, .sidebar-utilities-entries { flex: none; flex-direction: row; gap: 4px; overflow: visible; }
  .sidebar-utilities { margin-top: 0; padding-top: 0; padding-inline-start: 8px; }
  .sidebar-navigation .activity-button, .sidebar-navigation-collapsed .activity-button { flex-direction: column; justify-content: center; gap: 4px; width: auto; min-width: 64px; height: 54px; padding: 5px 8px; }
  .sidebar-navigation .activity-label, .sidebar-navigation-collapsed .activity-label { display: block; flex: none; font-size: 11px; }
  .sidebar-navigation .activity-button:not(.activity-account)::after { content: none; }
  .sidebar-navigation .activity-badge, .sidebar-navigation-collapsed .activity-badge { position: absolute; top: 1px; right: 3px; height: 16px; min-width: 16px; border: 1px solid var(--activity-rail); font-size: 9px; }
  .sidebar-navigation .sidebar-divider { width: 15px; height: 40px; margin: 7px 0; }
  .sidebar-divider::after { top: 0; bottom: 0; inset-inline: 7px auto; width: 1px; height: auto; }
  .sidebar-navigation .sidebar-drop-before { box-shadow: -2px 0 0 var(--accent); }
  .sidebar-navigation .sidebar-drop-after { box-shadow: 2px 0 0 var(--accent); }
  .sidebar-customization-row { gap: 6px; padding-inline: 5px; }
  .sidebar-customization-item { gap: 7px; }
}
</style>

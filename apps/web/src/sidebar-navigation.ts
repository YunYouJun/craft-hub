import type { WorkbenchSidebarEntry, WorkbenchSidebarSetting } from 'craft-hub'
import type { IconName } from './icons'

/** One currently available destination in the shared built-in and plugin rail. */
export interface ActivityNavigationItem {
  id: string
  title: string
  shortTitle?: string
  icon?: string
  builtinIcon?: IconName | 'home'
  testId?: string
  className?: string
  active?: boolean
  badge?: number
  attention?: boolean
}

/** Namespace plugin destinations so different plugins can use the same local ID. */
export function pluginSidebarId(pluginId: string, workbenchId: string): string {
  return `plugin:${encodeURIComponent(pluginId)}:${encodeURIComponent(workbenchId)}`
}

/** Keep application management destinations in the bottom of the desktop rail. */
export function isSidebarUtility(id: string): boolean {
  return id === 'builtin:marketplace' || id === 'builtin:diagnostics' || id === 'builtin:settings'
}

export type SidebarEntryGroup = 'builtins' | 'plugins' | 'utilities'

function itemGroup(id: string): SidebarEntryGroup {
  return isSidebarUtility(id) ? 'utilities' : id.startsWith('plugin:') ? 'plugins' : 'builtins'
}

/** Keep custom dividers in their originating group when destinations are hidden. */
export function sidebarEntryGroup(entries: WorkbenchSidebarEntry[], id: string): SidebarEntryGroup {
  const index = entries.findIndex(entry => entry.id === id)
  const entry = entries[index]
  if (!entry || entry.kind === 'item')
    return itemGroup(id)
  if (entry.group)
    return entry.group
  const previous = entries.slice(0, index).findLast(entry => entry.kind === 'item')
  const next = entries.slice(index + 1).find(entry => entry.kind === 'item')
  return itemGroup(previous?.id ?? next?.id ?? '')
}

/** Retain custom divider ownership before edits change its neighboring destinations. */
export function retainSidebarSeparatorGroups(setting: WorkbenchSidebarSetting): WorkbenchSidebarSetting {
  return { entries: setting.entries.map(entry => entry.kind === 'separator' && entry.id !== 'separator:plugins' && entry.id !== 'separator:utilities'
    ? { ...entry, group: sidebarEntryGroup(setting.entries, entry.id) }
    : entry) }
}

/** Preserve each group's saved order while separating built-ins, plugins and management. */
export function groupSidebarEntries(entries: WorkbenchSidebarEntry[]): Record<SidebarEntryGroup, WorkbenchSidebarEntry[]> {
  const groups: Record<SidebarEntryGroup, WorkbenchSidebarEntry[]> = { builtins: [], plugins: [], utilities: [] }
  for (const entry of entries) {
    if (entry.id === 'separator:plugins' || entry.id === 'separator:utilities')
      continue
    const group = sidebarEntryGroup(entries, entry.id)
    if (group !== 'utilities' || entry.kind === 'item')
      groups[group].push(entry)
  }
  return groups
}

function defaultSidebarEntries(items: ActivityNavigationItem[]): WorkbenchSidebarEntry[] {
  const entries: WorkbenchSidebarEntry[] = []
  let pluginsSeparated = false
  for (const item of items) {
    if (item.id.startsWith('plugin:') && !pluginsSeparated) {
      entries.push({ kind: 'separator', id: 'separator:plugins' })
      pluginsSeparated = true
    }
    if (item.id === 'builtin:marketplace')
      entries.push({ kind: 'separator', id: 'separator:utilities' })
    entries.push({ kind: 'item', id: item.id, visible: true })
  }
  return entries
}

/** Keep unavailable plugin preferences while adding newly discovered destinations. */
export function resolveSidebarEntries(items: ActivityNavigationItem[], setting: WorkbenchSidebarSetting): WorkbenchSidebarEntry[] {
  if (!setting.entries.length)
    return defaultSidebarEntries(items)
  const entries = setting.entries.map(entry => ({ ...entry }))
  const known = new Set(entries.map(entry => entry.id))
  for (const item of items) {
    if (known.has(item.id))
      continue
    const utilityIndex = entries.findIndex(entry => entry.id === 'separator:utilities')
    const index = item.id.startsWith('plugin:') && utilityIndex >= 0 ? utilityIndex : entries.length
    entries.splice(index, 0, { kind: 'item', id: item.id, visible: true })
    known.add(item.id)
  }
  return entries
}

/** Render useful group boundaries without empty groups or orphaned dividers. */
export function visibleSidebarEntries(items: ActivityNavigationItem[], setting: WorkbenchSidebarSetting): WorkbenchSidebarEntry[] {
  const available = new Set(items.map(item => item.id))
  const visible: WorkbenchSidebarEntry[] = []
  let separator: WorkbenchSidebarEntry | undefined
  for (const entry of resolveSidebarEntries(items, setting)) {
    if (entry.kind === 'separator') {
      if (visible.length)
        separator = entry
      continue
    }
    if (!entry.visible || !available.has(entry.id))
      continue
    if (separator)
      visible.push(separator)
    separator = undefined
    visible.push(entry)
  }
  return visible
}

/** Move an item or divider while preserving hidden and unavailable preferences. */
export function moveSidebarEntry(setting: WorkbenchSidebarSetting, id: string, targetId: string, position: 'before' | 'after'): WorkbenchSidebarSetting {
  if (id === targetId || !setting.entries.some(entry => entry.id === targetId))
    return setting
  const source = setting.entries.find(entry => entry.id === id)
  if (!source)
    return setting
  const entries = setting.entries.filter(entry => entry.id !== id)
  const targetIndex = entries.findIndex(entry => entry.id === targetId)
  entries.splice(targetIndex + (position === 'after' ? 1 : 0), 0, source)
  return { entries }
}

/** Change pin visibility without losing a destination's place in its group. */
export function setSidebarItemVisible(setting: WorkbenchSidebarSetting, id: string, visible: boolean): WorkbenchSidebarSetting {
  return { entries: setting.entries.map(entry => entry.kind === 'item' && entry.id === id ? { ...entry, visible } : entry) }
}

/** Insert a movable group boundary after a destination or another divider. */
export function addSidebarSeparator(setting: WorkbenchSidebarSetting, afterId: string): WorkbenchSidebarSetting {
  if (setting.entries.filter(entry => entry.kind === 'separator').length >= 256)
    return setting
  const index = setting.entries.findIndex(entry => entry.id === afterId)
  if (index < 0)
    return setting
  const entries = [...setting.entries]
  entries.splice(index + 1, 0, { kind: 'separator', id: `separator:${crypto.randomUUID()}`, group: sidebarEntryGroup(setting.entries, afterId) })
  return { entries }
}

/** Remove a divider; destinations remain available even when hidden. */
export function removeSidebarEntry(setting: WorkbenchSidebarSetting, id: string): WorkbenchSidebarSetting {
  return { entries: setting.entries.filter(entry => entry.kind !== 'separator' || entry.id !== id) }
}

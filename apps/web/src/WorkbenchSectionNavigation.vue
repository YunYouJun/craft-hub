<script setup lang="ts">
import type { WorkbenchNavigationEntry, WorkbenchNavigationGroup } from './workbench-navigation'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { NavigationItem, NavigationList } from './components/ui/navigation'
import SidebarIcon from './SidebarIcon.vue'

defineProps<{ title: string, icon?: string, groups: WorkbenchNavigationGroup[] }>()

const route = useRoute()
const router = useRouter()

function isActive(entry: WorkbenchNavigationEntry): boolean {
  const target = router.resolve(entry.to)
  if (route.path !== target.path && !(entry.match === 'prefix' && route.path.startsWith(`${target.path}/`)))
    return false

  const currentQuery = { ...route.query }
  if (target.name === 'integration' && !Object.hasOwn(target.query, 'scope') && currentQuery.scope === 'global')
    delete currentQuery.scope
  const queryKeys = entry.match === 'prefix' ? Object.keys(target.query) : new Set([...Object.keys(target.query), ...Object.keys(currentQuery)])
  return [...queryKeys].every(key => JSON.stringify(target.query[key]) === JSON.stringify(currentQuery[key]))
}
</script>

<template>
  <header class="section-navigation-header">
    <SidebarIcon :icon="icon" fallback="workspace" />
    <strong>{{ title }}</strong>
  </header>
  <NavigationList as="nav" variant="sidebar" class="section-navigation" :aria-label="title">
    <div v-for="(group, index) in groups" :key="index" class="section-navigation-group">
      <h2 v-if="group.title">{{ group.title }}</h2>
      <RouterLink v-for="entry in group.entries" :key="entry.key" v-slot="{ href, navigate }" :to="entry.to" custom>
        <NavigationItem as="a" :href="href" :title="entry.title" :class="{ active: isActive(entry) }" :aria-current="isActive(entry) ? 'page' : undefined" @click="navigate">
          <SidebarIcon :icon="entry.icon" fallback="list" :active="isActive(entry)" />
          <span class="ui-navigation-label">{{ entry.title }}</span>
        </NavigationItem>
      </RouterLink>
    </div>
  </NavigationList>
</template>

<style scoped>
.section-navigation-header { display: flex; flex: none; min-height: var(--workbench-sidebar-header-height); align-items: center; gap: var(--space-2); padding: 6px var(--workbench-sidebar-padding-inline); border-bottom: 1px solid var(--workbench-sidebar-border); }
.section-navigation-header > .visual-icon, .section-navigation-header > .app-icon { width: var(--workbench-sidebar-icon-size); height: var(--workbench-sidebar-icon-size); flex: none; }
.section-navigation-header strong { flex: 1; min-width: 0; color: var(--workbench-sidebar-color); font-size: var(--workbench-sidebar-font-size); font-weight: var(--workbench-sidebar-heading-weight); overflow-wrap: anywhere; }
.section-navigation { display: grid; align-content: start; gap: var(--workbench-sidebar-group-gap); min-height: 0; overflow-y: auto; scrollbar-width: thin; padding: var(--space-2) var(--navigation-sidebar-list-inset) var(--space-3); }
.section-navigation-group { display: grid; gap: 2px; min-width: 0; }
.section-navigation-group h2 { margin: 0; padding: var(--space-2) var(--navigation-sidebar-item-padding-inline); color: var(--text-secondary); font-size: var(--font-size-caption); font-weight: var(--workbench-sidebar-heading-weight); }
@media (max-width: 900px) {
  .section-navigation { display: flex; gap: var(--space-2); overflow-x: auto; scrollbar-width: thin; padding: var(--space-1) var(--space-2); }
  .section-navigation-group { display: flex; flex: none; }
  .section-navigation-group + .section-navigation-group { border-left: 1px solid var(--workbench-sidebar-border); padding-left: var(--space-2); }
  .section-navigation-group h2 { display: none; }
  .section-navigation .ui-navigation-item { width: auto; flex: none; }
}
</style>

<script setup lang="ts">
import Icon from '../../../NavigationIcon.vue'
import { Primitive } from 'reka-ui'
import { RouterLink } from 'vue-router'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../dropdown-menu'

defineProps<{ items: { label: string, to?: string }[], label: string, moreLabel: string }>()
</script>

<template>
  <nav :aria-label="label" class="ui-breadcrumb">
    <ol>
      <template v-for="(item, index) in items" :key="index">
        <li v-if="index === 1 && items.length > 3" class="collapsed-parents">
          <Icon name="arrowRight" class="separator" />
          <DropdownMenu>
            <DropdownMenuTrigger :aria-label="moreLabel">…</DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="breadcrumb-parent-menu">
              <template v-for="(parent, parentIndex) in items.slice(1, -1)" :key="parentIndex">
                <RouterLink v-if="parent.to" v-slot="{ href, navigate }" :to="parent.to" custom>
                  <DropdownMenuItem as-child><a :href="href" @click="navigate">{{ parent.label }}</a></DropdownMenuItem>
                </RouterLink>
                <DropdownMenuItem v-else disabled>{{ parent.label }}</DropdownMenuItem>
              </template>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
        <li :class="{ 'middle-parent': items.length > 3 && index > 0 && index < items.length - 1 }">
          <Icon v-if="index" name="arrowRight" class="separator" />
          <RouterLink v-if="item.to && index < items.length - 1" v-slot="{ href, navigate }" :to="item.to" custom><Primitive as="a" :href="href" @click="navigate"><Icon v-if="item.to === '/'" name="home" /><span>{{ item.label }}</span></Primitive></RouterLink>
          <span v-else :aria-current="index === items.length - 1 ? 'page' : undefined">{{ item.label }}</span>
        </li>
      </template>
    </ol>
  </nav>
</template>

<style scoped>
.ui-breadcrumb { min-width: 0; color: var(--muted); font-size: 12px; }
ol { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; list-style: none; margin: 0; padding: 0; }
li { display: flex; align-items: center; gap: 6px; min-width: 0; }
a, span[aria-current] { overflow-wrap: anywhere; }
a { display: inline-flex; min-width: 0; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 4px; color: inherit; text-decoration: none; } a:hover { color: var(--text); background: var(--surface-hover); }
a:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 3px; }
span[aria-current] { color: var(--text); font-weight: 500; padding: 3px 0; }
 :global(.breadcrumb-parent-menu) { z-index: 100; display: flex; flex-direction: column; min-width: 160px; max-width: min(320px, calc(100vw - 32px)); padding: 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); box-shadow: 0 8px 24px #0002; }
:global(.breadcrumb-parent-menu [role=menuitem]) { display: block; padding: 9px 10px; border-radius: 4px; color: var(--text); font-size: 13px; text-decoration: none; overflow-wrap: anywhere; outline: none; }
:global(.breadcrumb-parent-menu [role=menuitem][data-highlighted]) { background: var(--surface-hover); color: var(--accent); }
.collapsed-parents { display: none; }
.collapsed-parents button { background: transparent; color: var(--text); border: 0; padding: 2px 6px; border-radius: 4px; }
@media (max-width: 720px) { li.middle-parent { display: none; } li.collapsed-parents { display: flex; } }
.ui-breadcrumb :deep(.app-icon) { width: 14px; height: 14px; flex: none; }
.ui-breadcrumb :deep(.separator) { width: 12px; height: 12px; color: var(--muted); opacity: .5; }
</style>

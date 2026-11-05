<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'

withDefaults(defineProps<{ text: string, shortcut?: string, side?: 'top' | 'right' | 'bottom' | 'left' }>(), { side: 'top' })
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <TooltipRoot>
      <TooltipTrigger as-child><slot /></TooltipTrigger>
      <TooltipPortal>
        <TooltipContent class="ui-tooltip" :side="side" :side-offset="6" :collision-padding="12">
          <span>{{ text }}</span>
          <kbd v-if="shortcut" class="ui-tooltip-shortcut">{{ shortcut }}</kbd>
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>

<style>
.ui-tooltip { z-index: 60; display: flex; align-items: center; gap: 8px; max-width: min(var(--tooltip-max-width), var(--reka-tooltip-content-available-width)); padding: 6px 8px; border: 1px solid var(--tooltip-border); border-radius: 10px; background: var(--tooltip-bg); color: var(--tooltip-text); box-shadow: var(--tooltip-shadow); font-size: var(--font-size-control); line-height: var(--line-height-control); overflow-wrap: anywhere; pointer-events: none; }
.ui-tooltip > span { min-width: 0; }
.ui-tooltip .ui-tooltip-shortcut { flex: none; border: 0; border-radius: 5px; background: var(--tooltip-shortcut-background); padding: 1px 5px; color: inherit; font-family: var(--font-body); font-size: inherit; line-height: inherit; }
</style>

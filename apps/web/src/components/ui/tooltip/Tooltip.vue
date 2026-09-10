<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'

withDefaults(defineProps<{ text: string, side?: 'top' | 'right' | 'bottom' | 'left' }>(), { side: 'top' })
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <TooltipRoot>
      <TooltipTrigger as-child><slot /></TooltipTrigger>
      <TooltipPortal>
        <TooltipContent class="ui-tooltip" :side="side" :side-offset="6" :collision-padding="12">
          {{ text }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>

<style>
.ui-tooltip { max-width: min(var(--tooltip-max-width), var(--reka-tooltip-content-available-width)); padding: var(--space-2) var(--space-3); border-radius: var(--control-radius); background: var(--tooltip-bg); color: var(--tooltip-text); box-shadow: var(--tooltip-shadow); font-size: var(--font-size-body); line-height: var(--line-height-body); overflow-wrap: anywhere; }
</style>

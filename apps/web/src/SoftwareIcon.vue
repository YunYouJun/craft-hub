<script setup lang="ts">
import { personalWorkbenchToolSchema } from 'craft-hub/personal-workbench'
import { computed, ref, watch } from 'vue'
import { Icon } from './icons'
import { websiteToolIcon } from './tool-icons'

const props = defineProps<{ url: string, iconUrl?: string, macosIconUrl?: string, iconStyle?: 'original' | 'rounded', iconScale?: number }>()
function safeImageUrl(value: string | undefined): string | undefined {
  const result = personalWorkbenchToolSchema.shape.iconUrl.safeParse(value)
  return result.success ? result.data : undefined
}
const nativeSource = computed(() => safeImageUrl(props.macosIconUrl))
const source = computed(() => {
  return nativeSource.value || safeImageUrl(props.iconUrl)
})
const rounded = computed(() => !nativeSource.value && props.iconStyle === 'rounded')
const scale = computed(() => {
  const result = personalWorkbenchToolSchema.shape.iconScale.safeParse(props.iconScale)
  return result.success ? result.data ?? 1 : 1
})
const loaded = ref(false)
const failed = ref(false)
watch(source, () => {
  loaded.value = false
  failed.value = false
})
</script>

<template>
  <span class="software-icon" :class="{ 'software-icon-loaded': loaded }" :data-shape="rounded ? 'rounded' : 'original'" aria-hidden="true">
    <Icon v-if="!loaded" :name="websiteToolIcon(url)" />
    <img v-if="source && !failed" :key="source" :src="source" :style="{ '--artwork-scale': scale }" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false" @load="loaded = true" @error="failed = true; loaded = false">
  </span>
</template>

<style scoped>
.software-icon { position: relative; display: inline-grid; flex: none; place-items: center; width: var(--software-icon-size, 40px); height: var(--software-icon-size, 40px); border-radius: var(--software-icon-radius, 9px); background: var(--surface); color: var(--text); }
.software-icon > .app-icon { width: 80%; height: 80%; }
/* Size the visible artwork, not its transparent source canvas. Keep shadows unclipped. */
.software-icon img { position: absolute; top: 50%; left: 50%; width: 80%; height: 80%; object-fit: contain; transform: translate(-50%, -50%) scale(var(--artwork-scale)); opacity: 0; }
.software-icon[data-shape='rounded'] img { border-radius: 22.5%; }
.software-icon-loaded { background: transparent; }
.software-icon-loaded img { opacity: 1; }
</style>

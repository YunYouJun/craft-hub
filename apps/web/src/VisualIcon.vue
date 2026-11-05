<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { isNeutralSvgImage } from './icon-monochrome'
import { Icon, type IconName, visualIconNames } from './icons'
import { logoBackdrop } from './logo-backdrop'

const props = withDefaults(defineProps<{ icon?: string, fallback?: IconName, monochrome?: boolean | 'auto', framed?: boolean }>(), { fallback: 'workspace', monochrome: 'auto', framed: false })
const failed = ref(false)
const neutralImage = ref(false)
const backdrop = ref<'light' | 'dark'>('light')
watch(() => props.icon, () => {
  failed.value = false
  neutralImage.value = false
  backdrop.value = 'light'
})
const useMonochrome = computed(() => props.monochrome === true || (props.monochrome === 'auto' && neutralImage.value))
function imageLoaded(event: Event): void {
  if (event.target instanceof HTMLImageElement) {
    neutralImage.value = isNeutralSvgImage(event.target)
    if (props.framed)
      backdrop.value = logoBackdrop(event.target)
  }
}
const imageSource = computed(() => {
  if (failed.value || !props.icon)
    return undefined
  if (/^data:image\/(?:svg\+xml|png|webp|gif|jpeg|avif);base64,/.test(props.icon))
    return props.icon
  try {
    return new URL(props.icon).protocol === 'https:' ? props.icon : undefined
  }
  catch { return undefined }
})
const emoji = computed(() => props.icon?.startsWith('emoji:') ? props.icon.slice('emoji:'.length) : '')
const builtin = computed<IconName | undefined>(() => {
  if (!props.icon?.startsWith('builtin:'))
    return undefined
  const name = props.icon.slice('builtin:'.length)
  return name === 'codex' || name === 'play' || name === 'gitRepository' || visualIconNames.includes(name as typeof visualIconNames[number]) ? name as IconName : undefined
})
</script>

<template>
  <span
    class="visual-icon"
    :class="{ 'visual-icon-monochrome': useMonochrome, 'visual-icon-mask': useMonochrome && imageSource, 'visual-icon-framed': framed, 'visual-icon-framed-dark': framed && backdrop === 'dark' }"
    :style="useMonochrome && imageSource ? { maskImage: `url(${JSON.stringify(imageSource)})` } : undefined"
  >
    <img v-if="imageSource" :src="imageSource" alt="" referrerpolicy="no-referrer" @load="imageLoaded" @error="failed = true">
    <span v-else-if="emoji" class="visual-icon-emoji" aria-hidden="true">{{ emoji }}</span>
    <Icon v-else :name="builtin ?? fallback" />
  </span>
</template>

<style scoped>
.visual-icon-monochrome { color: inherit; }
.visual-icon-mask { background-color: currentColor; mask-size: contain; mask-position: center; mask-repeat: no-repeat; }
.visual-icon-mask img { opacity: 0; }
.visual-icon img { display: block; width: 100%; height: 100%; object-fit: contain; }
.visual-icon-framed { box-sizing: border-box; padding: var(--logo-frame-inset); border-radius: var(--logo-frame-radius); background: var(--logo-surface-light); color: var(--logo-foreground-light); box-shadow: inset 0 0 0 var(--logo-frame-width) var(--logo-edge-light); forced-color-adjust: none; }
.visual-icon-framed-dark { background: var(--logo-surface-dark); color: var(--logo-foreground-dark); box-shadow: inset 0 0 0 var(--logo-frame-width) var(--logo-edge-dark); }
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { isNeutralSvgImage } from './icon-monochrome'
import { Icon, type IconName, visualIconNames } from './icons'

const props = withDefaults(defineProps<{ icon?: string, fallback?: IconName, monochrome?: boolean | 'auto' }>(), { fallback: 'workspace', monochrome: 'auto' })
const failed = ref(false)
const neutralImage = ref(false)
watch(() => props.icon, () => {
  failed.value = false
  neutralImage.value = false
})
const useMonochrome = computed(() => props.monochrome === true || (props.monochrome === 'auto' && neutralImage.value))
function imageLoaded(event: Event): void {
  if (event.target instanceof HTMLImageElement)
    neutralImage.value = isNeutralSvgImage(event.target)
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
    :class="{ 'visual-icon-monochrome': useMonochrome, 'visual-icon-mask': useMonochrome && imageSource }"
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
</style>

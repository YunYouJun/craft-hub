<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon, type IconName, visualIconNames } from './icons'

const props = withDefaults(defineProps<{ icon?: string, fallback?: IconName, monochrome?: boolean }>(), { fallback: 'workspace' })
const failed = ref(false)
watch(() => props.icon, () => { failed.value = false })
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
  return name === 'play' || name === 'gitRepository' || visualIconNames.includes(name as typeof visualIconNames[number]) ? name as IconName : undefined
})
</script>

<template>
  <span
    class="visual-icon"
    :class="{ 'visual-icon-monochrome': monochrome, 'visual-icon-mask': monochrome && imageSource }"
    :style="monochrome && imageSource ? { maskImage: `url(${JSON.stringify(imageSource)})` } : undefined"
  >
    <img v-if="imageSource" :src="imageSource" alt="" referrerpolicy="no-referrer" @error="failed = true">
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

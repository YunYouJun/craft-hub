<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

defineProps<{ primary?: boolean }>()
const state = ref<'idle' | 'opening' | 'fallback'>('idle')
let fallbackTimer: ReturnType<typeof setTimeout> | undefined

function beginOpen(): void {
  state.value = 'opening'
  if (fallbackTimer)
    clearTimeout(fallbackTimer)
  fallbackTimer = setTimeout(() => state.value = 'fallback', 1_500)
}

onBeforeUnmount(() => {
  if (fallbackTimer)
    clearTimeout(fallbackTimer)
})
</script>

<template>
  <section class="desktop-action" :class="{ 'is-primary': primary }" aria-labelledby="desktop-action-title">
    <div>
      <small>CRAFT HUB DESKTOP</small>
      <strong id="desktop-action-title">回到本地工作台</strong>
      <span>项目路径、信任确认和运行记录都保留在你的电脑上。</span>
    </div>
    <a class="desktop-open-link" href="craft-hub://open?v=1" @click="beginOpen">
      {{ state === 'opening' ? '正在尝试打开…' : '在桌面版中打开' }}
      <b aria-hidden="true">↗</b>
    </a>
    <p v-if="state === 'fallback'" role="status">
      如果没有看到桌面窗口，请先
      <a href="https://github.com/YunYouJun/craft-hub/releases/latest">安装或更新 Craft Hub</a>，然后重试。
    </p>
  </section>
</template>

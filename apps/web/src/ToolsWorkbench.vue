<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from './i18n'
import PersonalTools from './PersonalTools.vue'
import WorkbenchViewFrame from './WorkbenchViewFrame.vue'

const { locale } = useI18n()
const zh = computed(() => locale.value === 'zh-CN')
</script>

<template>
  <WorkbenchViewFrame class="tools-workbench" :title="zh ? '常用工具' : 'Favorite tools'" :description="zh ? '收藏常用网站和本机应用，按分组打开或管理工具。' : 'Keep favorite websites and local applications together, grouped for easy access.'" icon="builtin:star">
    <PersonalTools />
  </WorkbenchViewFrame>
</template>

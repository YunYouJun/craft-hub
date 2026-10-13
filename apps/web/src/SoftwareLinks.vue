<script setup lang="ts">
import { Tooltip } from './components/ui/tooltip'
import { useI18n } from './i18n'
import { Icon } from './icons'

defineProps<{ title: string, url?: string, downloadUrl?: string, repositoryUrl?: string }>()
const { locale } = useI18n()
const copy = (chinese: string, english: string) => locale.value === 'zh-CN' ? chinese : english
</script>

<template>
  <div class="software-icon-links">
    <Tooltip v-if="url" :text="`${copy('打开官网', 'Open website')} · ${title}`">
      <a :href="url" target="_blank" rel="noopener noreferrer" :aria-label="`${copy('官网', 'Website')} ${title}`"><Icon name="web" /></a>
    </Tooltip>
    <Tooltip v-if="downloadUrl" :text="`${copy('打开官方下载页', 'Open official download page')} · ${title}`">
      <a :href="downloadUrl" target="_blank" rel="noopener noreferrer" :aria-label="`${copy('下载', 'Download')} ${title}`"><Icon name="download" /></a>
    </Tooltip>
    <Tooltip v-if="repositoryUrl" :text="`${copy('查看源码', 'View source')} · ${title}`">
      <a :href="repositoryUrl" target="_blank" rel="noopener noreferrer" :aria-label="`${copy('GitHub / 源码', 'GitHub / source')} ${title}`"><Icon name="code" /></a>
    </Tooltip>
  </div>
</template>

<style scoped>
.software-icon-links { display: flex; align-items: center; gap: 4px; min-height: 32px; }
.software-icon-links a { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: var(--control-radius); color: var(--muted); text-decoration: none; }
.software-icon-links a:hover, .software-icon-links a:focus-visible { color: var(--accent); background: var(--accent-soft); }
.software-icon-links a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.software-icon-links .app-icon { width: 16px; height: 16px; }
</style>

<script setup lang="ts">
import type { File, FileDiff } from '@pierre/diffs'
import { useMediaQuery } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { Button as UiButton } from './components/ui/button'
import { useI18n } from './i18n'
import { previewFile } from './preview-file'
import { resolvedWorkbenchTheme } from './theme'

const props = defineProps<{
  content: string
  path?: string
  comparison?: { content: string, path?: string }
}>()
const { locale } = useI18n()
const copy = (en: string, zh: string) => locale.value === 'zh-CN' ? zh : en
const container = ref<HTMLElement>()
const ready = ref(false)
const failed = ref(false)
const wrap = ref(false)
const unified = ref(false)
const expand = ref(false)
const narrow = useMediaQuery('(max-width: 760px)')
const identical = computed(() => props.comparison?.content === props.content)
const hasDiff = computed(() => props.comparison !== undefined && !identical.value)
const diffStyle = computed(() => unified.value || narrow.value ? 'unified' : 'split')

watch([container, () => props.content, () => props.path, () => props.comparison?.content, () => props.comparison?.path, wrap, diffStyle, expand, resolvedWorkbenchTheme], async (_, __, onCleanup) => {
  const host = container.value
  if (!host) return
  let cancelled = false
  let instance: File | FileDiff | undefined
  onCleanup(() => {
    cancelled = true
    instance?.cleanUp()
    host.replaceChildren()
  })
  ready.value = false
  failed.value = false
  try {
    const { File, FileDiff, getFiletypeFromFileName, preloadHighlighter } = await import('@pierre/diffs')
    if (cancelled) return
    const file = previewFile(props.content, props.path)
    const oldFile = props.comparison ? previewFile(props.comparison.content, props.comparison.path ?? props.path) : undefined
    await preloadHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: [file, ...(oldFile ? [oldFile] : [])].map(file => file.lang ?? getFiletypeFromFileName(file.name)),
    })
    if (cancelled) return
    const options = {
      theme: { light: 'github-light', dark: 'github-dark' },
      themeType: resolvedWorkbenchTheme.value,
      disableFileHeader: true,
      disableLineNumbers: false,
      enableLineSelection: true,
      overflow: wrap.value ? 'wrap' as const : 'scroll' as const,
      disableErrorHandling: true,
    }
    if (oldFile && hasDiff.value) {
      const diff = new FileDiff({ ...options, diffStyle: diffStyle.value, diffIndicators: 'classic', expandUnchanged: expand.value })
      instance = diff
      diff.render({ oldFile, newFile: file, containerWrapper: host })
    }
    else {
      const preview = new File(options)
      instance = preview
      preview.render({ file, containerWrapper: host })
    }
    ready.value = true
  }
  catch {
    if (!cancelled) {
      instance?.cleanUp()
      host.replaceChildren()
      failed.value = true
    }
  }
}, { flush: 'post' })
</script>

<template>
  <div class="file-preview">
    <div class="file-preview-toolbar" role="group" :aria-label="copy('Preview display', '预览显示')">
      <span>{{ identical ? copy('Contents identical', '内容相同') : copy('Read only', '只读') }}</span>
      <UiButton v-if="hasDiff && !narrow" size="compact" variant="ghost" :aria-pressed="unified" @click="unified = !unified">{{ copy('Unified view', '单栏视图') }}</UiButton>
      <UiButton v-if="hasDiff" size="compact" variant="ghost" :aria-pressed="expand" @click="expand = !expand">{{ copy('Show all lines', '展开全文') }}</UiButton>
      <UiButton size="compact" variant="ghost" :aria-pressed="wrap" @click="wrap = !wrap">{{ copy('Wrap lines', '自动换行') }}</UiButton>
    </div>
    <div class="file-preview-scroll" tabindex="0" :aria-label="copy('File content preview', '文件内容预览')" :aria-busy="!ready && !failed">
      <div ref="container" class="file-preview-renderer" />
      <div v-if="!ready" class="file-preview-fallback">
        <p v-if="failed" role="status">{{ copy('Showing plain text; highlighted preview is unavailable.', '高亮预览暂不可用，显示纯文本。') }}</p>
        <pre v-if="comparison">{{ comparison.content }}</pre>
        <pre>{{ content }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-preview { min-width: 0; margin-block: var(--space-2); border: 1px solid var(--border); border-radius: var(--control-radius); overflow: hidden; background: var(--surface); }
.file-preview-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1); padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--border); background: var(--surface-hover); font-size: var(--font-size-control); }
.file-preview-toolbar > span { flex: 1; color: var(--muted); }
.file-preview-toolbar .ui-button { padding: 3px 7px; font-size: var(--font-size-control); font-weight: 400; }
.file-preview-toolbar .ui-button[aria-pressed='true'] { color: var(--accent); background: var(--surface); }
.file-preview-scroll { max-height: 420px; overflow: auto; scrollbar-width: thin; }
.file-preview-scroll:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
.file-preview-renderer { --diffs-font-family: var(--font-mono, ui-monospace, monospace); --diffs-font-size: var(--font-size-control); --diffs-line-height: 1.6; --diffs-tab-size: 2; --diffs-header-font-family: inherit; }
.file-preview-fallback pre { margin: 0; padding: var(--space-3); overflow: auto; font-size: var(--font-size-control); line-height: 1.6; }
.file-preview-fallback p { margin: 0; padding: var(--space-2) var(--space-3); color: var(--muted); font-size: var(--font-size-control); }
</style>

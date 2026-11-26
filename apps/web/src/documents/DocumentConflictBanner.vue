<script setup lang="ts">
import { ref } from 'vue'
import { Button as UiButton } from '../components/ui/button'
import FileDiffPreview from '../FileDiffPreview.vue'
import { useI18n } from '../i18n'
import Icon from '../NavigationIcon.vue'

defineProps<{
  path: string
  message: string
  diskContent: string
  localContent: string
  saving?: boolean
}>()

const emit = defineEmits<{
  reload: []
  keepLocal: []
}>()

const { locale } = useI18n()
const diffExpanded = ref(false)
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
</script>

<template>
  <aside class="document-conflict-banner" role="alert" data-testid="document-conflict-banner">
    <div class="document-conflict-header">
      <Icon name="error" />
      <div class="document-conflict-copy">
        <strong>{{ copy('文件已在磁盘上更新', 'Document changed on disk') }}</strong>
        <p>{{ message || copy('你在编辑期间外部工具或目录同步更新了该文件，请选择如何解决冲突。', 'An external tool or file watcher updated this file while you had unsaved changes.') }}</p>
      </div>
      <div class="document-conflict-actions">
        <UiButton size="compact" variant="secondary" @click="diffExpanded = !diffExpanded">
          {{ diffExpanded ? copy('收起对比', 'Hide diff') : copy('对比差异', 'View diff') }}
        </UiButton>
        <UiButton size="compact" variant="secondary" :disabled="saving" data-testid="conflict-reload" @click="emit('reload')">
          {{ copy('加载磁盘版本', 'Reload from disk') }}
        </UiButton>
        <UiButton size="compact" variant="warning" :disabled="saving" data-testid="conflict-keep-local" @click="emit('keepLocal')">
          {{ copy('保留我的版本', 'Keep my version') }}
        </UiButton>
      </div>
    </div>
    <div v-if="diffExpanded" class="document-conflict-diff">
      <FileDiffPreview
        :before="diskContent"
        :after="localContent"
        :before-path="path"
        :after-path="path"
        :before-label="copy('磁盘最新版本', 'Latest on disk')"
        :after-label="copy('当前未保存修改', 'Your unsaved version')"
      />
    </div>
  </aside>
</template>

<style scoped>
.document-conflict-banner {
  display: grid;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
  border: 1px solid color-mix(in srgb, var(--warning) 45%, var(--border));
  border-radius: var(--panel-radius);
  background: color-mix(in srgb, var(--warning) 8%, var(--surface));
  padding: var(--space-3) var(--space-4);
}
.document-conflict-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
.document-conflict-header > .app-icon {
  width: 18px;
  height: 18px;
  flex: none;
  color: var(--warning);
}
.document-conflict-copy {
  min-width: 0;
  flex: 1 1 240px;
}
.document-conflict-copy strong {
  display: block;
  color: var(--warning);
  font-size: var(--font-size-body);
}
.document-conflict-copy p {
  margin: 2px 0 0;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
}
.document-conflict-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.document-conflict-diff {
  border-top: 1px solid var(--border);
  padding-top: var(--space-3);
}
</style>

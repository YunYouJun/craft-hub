<script setup lang="ts">
import type { IconName } from '../icons'
import { computed, ref, watch } from 'vue'
import { useI18n } from '../i18n'
import Icon from '../NavigationIcon.vue'

export interface SlashCommandItem {
  id: 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'task' | 'callout-note' | 'callout-tip' | 'callout-warning' | 'toggle' | 'card' | 'code' | 'table' | 'divider'
  icon: IconName
  labelZh: string
  labelEn: string
  hintZh: string
  hintEn: string
  keywords: string[]
}

const props = defineProps<{
  open: boolean
  query: string
  position: { top: number, left: number }
}>()

const emit = defineEmits<{
  select: [commandId: SlashCommandItem['id']]
  close: []
}>()

const { locale } = useI18n()
const activeIndex = ref(0)

const allCommands: SlashCommandItem[] = [
  { id: 'h1', icon: 'docs', labelZh: '一级标题', labelEn: 'Heading 1', hintZh: '# 标题', hintEn: 'Large section heading', keywords: ['h1', 'heading', 'title', '标题'] },
  { id: 'h2', icon: 'docs', labelZh: '二级标题', labelEn: 'Heading 2', hintZh: '## 标题', hintEn: 'Medium section heading', keywords: ['h2', 'heading', '标题'] },
  { id: 'h3', icon: 'docs', labelZh: '三级标题', labelEn: 'Heading 3', hintZh: '### 标题', hintEn: 'Compact section heading', keywords: ['h3', 'heading', '标题'] },
  { id: 'bullet', icon: 'list', labelZh: '无序列表', labelEn: 'Bullet list', hintZh: '条目清单', hintEn: 'Simple bullet list', keywords: ['bullet', 'list', 'ul', '列表'] },
  { id: 'ordered', icon: 'list', labelZh: '有序列表', labelEn: 'Ordered list', hintZh: '数字步骤', hintEn: 'Numbered list', keywords: ['ordered', 'number', 'ol', '有序', '步骤'] },
  { id: 'task', icon: 'task', labelZh: '待办清单', labelEn: 'Checklist', hintZh: '可勾选任务项', hintEn: 'Track tasks inline', keywords: ['task', 'todo', 'checklist', '待办', '清单'] },
  { id: 'callout-note', icon: 'story', labelZh: '提示卡片 (Note)', labelEn: 'Callout · Note', hintZh: '强调背景或补充信息', hintEn: 'Highlight a note block', keywords: ['callout', 'note', 'info', '提示', '卡片'] },
  { id: 'callout-tip', icon: 'skill', labelZh: '技巧卡片 (Tip)', labelEn: 'Callout · Tip', hintZh: '推荐做法与技巧', hintEn: 'Share a helpful tip', keywords: ['callout', 'tip', '技巧'] },
  { id: 'callout-warning', icon: 'error', labelZh: '警示卡片 (Warning)', labelEn: 'Callout · Warning', hintZh: '注意事项与风险提醒', hintEn: 'Highlight an important caveat', keywords: ['callout', 'warning', 'alert', '警告', '提醒'] },
  { id: 'toggle', icon: 'arrowDown', labelZh: '折叠区块', labelEn: 'Toggle section', hintZh: '可展开收起的子内容', hintEn: 'Collapsible detail block', keywords: ['toggle', 'details', 'collapse', '折叠'] },
  { id: 'card', icon: 'collection', labelZh: '子页面卡片', labelEn: 'Subpage card', hintZh: '新建并嵌入子页面卡片', hintEn: 'Create & embed subpage card', keywords: ['card', 'subpage', 'page', '卡片', '子页面'] },
  { id: 'code', icon: 'code', labelZh: '代码块', labelEn: 'Code block', hintZh: '多行代码高亮块', hintEn: 'Fenced code block', keywords: ['code', 'fence', '代码'] },
  { id: 'table', icon: 'chart', labelZh: '表格', labelEn: 'Table', hintZh: '插入 3×3 表格', hintEn: 'Insert a 3×3 table', keywords: ['table', 'grid', '表格'] },
  { id: 'divider', icon: 'more', labelZh: '分割线', labelEn: 'Divider', hintZh: '水平分隔符', hintEn: 'Visual section separator', keywords: ['divider', 'hr', 'line', '分割线'] },
]

const filteredCommands = computed(() => {
  const q = props.query.trim().toLowerCase()
  if (!q)
    return allCommands
  return allCommands.filter(item =>
    item.labelEn.toLowerCase().includes(q)
    || item.labelZh.toLowerCase().includes(q)
    || item.keywords.some(keyword => keyword.includes(q)),
  )
})

watch(() => [props.open, props.query], () => {
  activeIndex.value = 0
})

function moveSelection(delta: number): boolean {
  if (!props.open || !filteredCommands.value.length)
    return false
  activeIndex.value = (activeIndex.value + delta + filteredCommands.value.length) % filteredCommands.value.length
  return true
}

function confirmSelection(): boolean {
  const item = filteredCommands.value[activeIndex.value]
  if (!props.open || !item)
    return false
  emit('select', item.id)
  return true
}

defineExpose({ moveSelection, confirmSelection })
</script>

<template>
  <div
    v-if="open && filteredCommands.length"
    class="slash-command-menu"
    role="listbox"
    data-testid="slash-command-menu"
    :style="{ top: `${position.top}px`, left: `${position.left}px` }"
  >
    <button
      v-for="(item, index) in filteredCommands"
      :key="item.id"
      type="button"
      role="option"
      class="slash-command-item"
      :aria-selected="index === activeIndex"
      :class="{ active: index === activeIndex }"
      @mousedown.prevent="emit('select', item.id)"
      @mouseenter="activeIndex = index"
    >
      <Icon :name="item.icon" />
      <span class="slash-command-copy">
        <strong>{{ locale === 'zh-CN' ? item.labelZh : item.labelEn }}</strong>
        <small>{{ locale === 'zh-CN' ? item.hintZh : item.hintEn }}</small>
      </span>
    </button>
  </div>
</template>

<style scoped>
.slash-command-menu {
  position: fixed;
  z-index: 30;
  width: min(296px, calc(100vw - 24px));
  max-height: 300px;
  overflow-y: auto;
  scrollbar-width: thin;
  border: 1px solid var(--menu-border);
  border-radius: var(--menu-radius);
  background: var(--menu-background);
  padding: var(--menu-padding);
  box-shadow: var(--menu-shadow);
}
.slash-command-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--space-2);
  border-radius: var(--menu-item-radius);
  background: transparent;
  padding: 6px 8px;
  color: var(--text);
  text-align: left;
}
.slash-command-item.active,
.slash-command-item:hover {
  background: var(--accent-soft);
}
.slash-command-item :deep(.app-icon) {
  width: 16px;
  height: 16px;
  flex: none;
  color: var(--accent);
}
.slash-command-copy {
  display: grid;
  min-width: 0;
  gap: 1px;
}
.slash-command-copy strong {
  font-size: var(--font-size-control);
  font-weight: 500;
}
.slash-command-copy small {
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

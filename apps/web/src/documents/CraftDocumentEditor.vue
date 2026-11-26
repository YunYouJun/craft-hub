<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import type { DocumentPropertyValue, DocumentRecord, DocumentSpace } from 'craft-hub'
import type { SlashCommandItem } from './SlashCommandMenu.vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Button as UiButton } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { useI18n } from '../i18n'
import Icon from '../NavigationIcon.vue'
import { formatRawDocument, markdownToTiptap, parseRawDocument, tiptapToMarkdown } from './markdown-codec'
import SlashCommandMenu from './SlashCommandMenu.vue'
import { createDocumentEditorExtensions, resolveSpaceAssetUrl } from './tiptap-extensions'

export interface DocumentDraftPayload {
  title: string
  frontmatter: Record<string, unknown>
  markdown: string
}

const props = withDefaults(defineProps<{
  space: DocumentSpace
  document: DocumentRecord
  focusMode?: boolean
  saving?: boolean
  dirty?: boolean
  hasConflict?: boolean
  saveError?: string
}>(), {
  focusMode: false,
  saving: false,
  dirty: false,
  hasConflict: false,
  saveError: '',
})

const emit = defineEmits<{
  updateDraft: [payload: DocumentDraftPayload]
  save: [payload: { markdown: string, frontmatter: Record<string, unknown> }]
  openCard: [targetPath: string]
  requestSubpageCard: []
  toggleFocus: []
  copyHandoff: [selectionText: string]
}>()

const { locale } = useI18n()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en

const isReadOnly = computed(() => Boolean(props.space.readOnly || props.document.readOnly))
const mode = ref<'visual' | 'markdown'>('visual')
const titleDraft = ref(props.document.title)
const frontmatterDraft = ref<Record<string, unknown>>({ ...props.document.frontmatter })
const markdownDraft = ref(props.document.markdown)
const rawDraft = ref(props.document.rawContent)
const newTagInput = ref('')
const tagInputOpen = ref(false)
const handoffCopied = ref(false)

let suppressEditorUpdate = false
let handoffResetTimer: ReturnType<typeof setTimeout> | undefined

const slashMenuRef = ref<InstanceType<typeof SlashCommandMenu>>()
const slashOpen = ref(false)
const slashQuery = ref('')
const slashPosition = ref({ top: 140, left: 160 })
let slashRange: { from: number, to: number } | undefined

const bubbleOpen = ref(false)
const bubblePosition = ref({ top: 100, left: 200 })
const linkInputOpen = ref(false)
const linkUrlInput = ref('')

const activeTags = computed<string[]>(() => {
  const raw = frontmatterDraft.value.tags
  return Array.isArray(raw) ? raw.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0) : []
})

const activeStatus = computed(() => typeof frontmatterDraft.value.status === 'string' ? frontmatterDraft.value.status : '')

const customProperties = computed<Array<[string, DocumentPropertyValue]>>(() => {
  const result: Array<[string, DocumentPropertyValue]> = []
  for (const [key, value] of Object.entries(frontmatterDraft.value)) {
    if (['title', 'icon', 'cover', 'summary', 'status', 'tags'].includes(key))
      continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || (Array.isArray(value) && value.every(item => typeof item === 'string')))
      result.push([key, value])
  }
  return result
})

const coverPreviewUrl = computed(() => {
  const cover = typeof frontmatterDraft.value.cover === 'string' ? frontmatterDraft.value.cover.trim() : ''
  return cover ? resolveSpaceAssetUrl(props.space.id, props.document.path, cover) : ''
})

function safeCoordsAtPos(currentEditor: Editor, pos: number): { top: number, bottom: number, left: number } | undefined {
  try {
    return currentEditor.view.coordsAtPos(pos)
  }
  catch {
    return undefined
  }
}

function updateSlashMenuState(currentEditor: Editor): void {
  if (isReadOnly.value || mode.value !== 'visual') {
    slashOpen.value = false
    slashRange = undefined
    return
  }
  const { selection } = currentEditor.state
  if (!selection.empty) {
    slashOpen.value = false
    slashRange = undefined
    return
  }
  const { $from } = selection
  if (!$from.parent.isTextblock) {
    slashOpen.value = false
    slashRange = undefined
    return
  }
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
  const slashIndex = textBefore.lastIndexOf('/')
  if (slashIndex < 0) {
    slashOpen.value = false
    slashRange = undefined
    return
  }
  const charBefore = slashIndex > 0 ? textBefore[slashIndex - 1] : ''
  const afterSlash = textBefore.slice(slashIndex + 1)
  if ((slashIndex > 0 && charBefore !== ' ' && charBefore !== '\t') || /\s/.test(afterSlash)) {
    slashOpen.value = false
    slashRange = undefined
    return
  }

  const fromPos = $from.start() + slashIndex
  const toPos = $from.pos
  const coords = safeCoordsAtPos(currentEditor, toPos)
  slashPosition.value = coords
    ? { top: Math.min(window.innerHeight - 320, coords.bottom + 8), left: Math.min(window.innerWidth - 310, Math.max(16, coords.left)) }
    : { top: 160, left: 160 }
  slashRange = { from: fromPos, to: toPos }
  slashQuery.value = afterSlash
  slashOpen.value = true
}

function updateBubbleMenuState(currentEditor: Editor): void {
  if (isReadOnly.value || mode.value !== 'visual') {
    bubbleOpen.value = false
    return
  }
  const { selection } = currentEditor.state
  if (selection.empty || currentEditor.isActive('codeBlock')) {
    bubbleOpen.value = false
    linkInputOpen.value = false
    return
  }
  const coords = safeCoordsAtPos(currentEditor, selection.from)
  bubblePosition.value = coords
    ? { top: Math.max(54, coords.top - 46), left: Math.max(16, Math.min(window.innerWidth - 360, coords.left)) }
    : { top: 96, left: 160 }
  bubbleOpen.value = true
}

function emitCurrentDraft(): void {
  emit('updateDraft', {
    title: titleDraft.value.trim() || props.document.title,
    frontmatter: { ...frontmatterDraft.value },
    markdown: markdownDraft.value,
  })
}

const editor = useEditor({
  editable: !isReadOnly.value,
  content: markdownToTiptap(props.document.markdown),
  extensions: createDocumentEditorExtensions({
    placeholder: copy('开始写作，或输入 / 插入标题、清单、提示卡、子页面…', 'Start writing, or type / for blocks and subpage cards…'),
    currentDocPath: () => props.document.path,
    getCards: () => props.document.cards,
    openCard: targetPath => emit('openCard', targetPath),
    resolveAssetUrl: src => resolveSpaceAssetUrl(props.space.id, props.document.path, src),
  }),
  editorProps: {
    attributes: {
      'class': 'craft-prosemirror-surface',
      'data-testid': 'craft-document-editor-canvas',
    },
    handleKeyDown(_view, event) {
      if (slashOpen.value && slashMenuRef.value) {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          return slashMenuRef.value.moveSelection(1)
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          return slashMenuRef.value.moveSelection(-1)
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          return slashMenuRef.value.confirmSelection()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          slashOpen.value = false
          slashRange = undefined
          return true
        }
      }
      return false
    },
  },
  onUpdate({ editor: currentEditor }) {
    if (suppressEditorUpdate)
      return
    markdownDraft.value = tiptapToMarkdown(currentEditor.getJSON())
    rawDraft.value = formatRawDocument(markdownDraft.value, frontmatterDraft.value)
    updateSlashMenuState(currentEditor as Editor)
    updateBubbleMenuState(currentEditor as Editor)
    emitCurrentDraft()
  },
  onSelectionUpdate({ editor: currentEditor }) {
    updateSlashMenuState(currentEditor as Editor)
    updateBubbleMenuState(currentEditor as Editor)
  },
})

watch(isReadOnly, (readOnly) => {
  editor.value?.setEditable(!readOnly)
})

watch(() => [props.document.path, props.document.revision] as const, () => {
  titleDraft.value = props.document.title
  frontmatterDraft.value = { ...props.document.frontmatter }
  markdownDraft.value = props.document.markdown
  rawDraft.value = props.document.rawContent
  slashOpen.value = false
  bubbleOpen.value = false
  linkInputOpen.value = false
  if (editor.value) {
    suppressEditorUpdate = true
    editor.value.commands.setContent(markdownToTiptap(props.document.markdown), { emitUpdate: false })
    suppressEditorUpdate = false
  }
})

function switchMode(nextMode: 'visual' | 'markdown'): void {
  if (nextMode === mode.value)
    return
  if (nextMode === 'markdown') {
    const latestMarkdown = editor.value ? tiptapToMarkdown(editor.value.getJSON()) : markdownDraft.value
    markdownDraft.value = latestMarkdown
    rawDraft.value = formatRawDocument(latestMarkdown, frontmatterDraft.value)
    slashOpen.value = false
    bubbleOpen.value = false
    mode.value = 'markdown'
    return
  }
  const parsed = parseRawDocument(rawDraft.value)
  frontmatterDraft.value = parsed.frontmatter
  markdownDraft.value = parsed.markdown
  if (typeof parsed.frontmatter.title === 'string' && parsed.frontmatter.title.trim())
    titleDraft.value = parsed.frontmatter.title.trim()
  mode.value = 'visual'
  if (editor.value) {
    suppressEditorUpdate = true
    editor.value.commands.setContent(markdownToTiptap(parsed.markdown), { emitUpdate: false })
    suppressEditorUpdate = false
  }
}

function handleTitleInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value
  titleDraft.value = value
  const nextFrontmatter = { ...frontmatterDraft.value }
  if (value.trim())
    nextFrontmatter.title = value.trim()
  else
    delete nextFrontmatter.title
  frontmatterDraft.value = nextFrontmatter
  if (mode.value === 'markdown')
    rawDraft.value = formatRawDocument(parseRawDocument(rawDraft.value).markdown, nextFrontmatter)
  emitCurrentDraft()
}

function handleRawInput(): void {
  const parsed = parseRawDocument(rawDraft.value)
  frontmatterDraft.value = parsed.frontmatter
  markdownDraft.value = parsed.markdown
  if (typeof parsed.frontmatter.title === 'string' && parsed.frontmatter.title.trim())
    titleDraft.value = parsed.frontmatter.title.trim()
  emitCurrentDraft()
}

function updateStatusProperty(event: Event): void {
  const nextStatus = (event.target as HTMLSelectElement).value
  const nextFrontmatter = { ...frontmatterDraft.value }
  if (nextStatus)
    nextFrontmatter.status = nextStatus
  else
    delete nextFrontmatter.status
  frontmatterDraft.value = nextFrontmatter
  emitCurrentDraft()
}

function addTag(): void {
  const value = newTagInput.value.trim()
  if (!value) {
    tagInputOpen.value = false
    return
  }
  const nextTags = activeTags.value.includes(value) ? activeTags.value : [...activeTags.value, value]
  frontmatterDraft.value = { ...frontmatterDraft.value, tags: nextTags }
  newTagInput.value = ''
  tagInputOpen.value = false
  emitCurrentDraft()
}

function removeTag(tagToRemove: string): void {
  const nextTags = activeTags.value.filter(tag => tag !== tagToRemove)
  const nextFrontmatter = { ...frontmatterDraft.value }
  if (nextTags.length)
    nextFrontmatter.tags = nextTags
  else
    delete nextFrontmatter.tags
  frontmatterDraft.value = nextFrontmatter
  emitCurrentDraft()
}

function applySlashCommand(commandId: SlashCommandItem['id']): void {
  const currentEditor = editor.value
  if (!currentEditor)
    return
  const rangeToDelete = slashRange
  slashOpen.value = false
  slashRange = undefined

  if (commandId === 'card') {
    if (rangeToDelete)
      currentEditor.chain().focus().deleteRange(rangeToDelete).run()
    emit('requestSubpageCard')
    return
  }

  let chain = currentEditor.chain().focus()
  if (rangeToDelete)
    chain = chain.deleteRange(rangeToDelete)

  switch (commandId) {
    case 'h1':
      chain.setHeading({ level: 1 }).run()
      break
    case 'h2':
      chain.setHeading({ level: 2 }).run()
      break
    case 'h3':
      chain.setHeading({ level: 3 }).run()
      break
    case 'bullet':
      chain.toggleBulletList().run()
      break
    case 'ordered':
      chain.toggleOrderedList().run()
      break
    case 'task':
      chain.toggleTaskList().run()
      break
    case 'callout-note':
      chain.insertContent({ type: 'callout', attrs: { variant: 'note' }, content: [{ type: 'paragraph' }] }).run()
      break
    case 'callout-tip':
      chain.insertContent({ type: 'callout', attrs: { variant: 'tip' }, content: [{ type: 'paragraph' }] }).run()
      break
    case 'callout-warning':
      chain.insertContent({ type: 'callout', attrs: { variant: 'warning' }, content: [{ type: 'paragraph' }] }).run()
      break
    case 'toggle':
      chain.insertContent({ type: 'toggleBlock', attrs: { summary: copy('展开细节', 'Details'), open: true }, content: [{ type: 'paragraph' }] }).run()
      break
    case 'code':
      chain.setCodeBlock().run()
      break
    case 'table':
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
      break
    case 'divider':
      chain.setHorizontalRule().run()
      break
  }
}

function applySelectionLink(): void {
  const currentEditor = editor.value
  if (!currentEditor)
    return
  const url = linkUrlInput.value.trim()
  if (!url)
    currentEditor.chain().focus().unsetLink().run()
  else
    currentEditor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  linkInputOpen.value = false
  linkUrlInput.value = ''
}

function flushDraft(): { markdown: string, frontmatter: Record<string, unknown> } {
  if (mode.value === 'markdown') {
    const parsed = parseRawDocument(rawDraft.value)
    return { markdown: parsed.markdown, frontmatter: parsed.frontmatter }
  }
  const markdown = editor.value ? tiptapToMarkdown(editor.value.getJSON()) : markdownDraft.value
  return { markdown, frontmatter: { ...frontmatterDraft.value } }
}

function triggerSave(): void {
  if (isReadOnly.value)
    return
  emit('save', flushDraft())
}

function triggerCopyHandoff(): void {
  let selectedText = ''
  if (mode.value === 'visual' && editor.value) {
    const { from, to, empty } = editor.value.state.selection
    if (!empty)
      selectedText = editor.value.state.doc.textBetween(from, to, '\n')
  }
  emit('copyHandoff', selectedText)
  handoffCopied.value = true
  if (handoffResetTimer)
    clearTimeout(handoffResetTimer)
  handoffResetTimer = setTimeout(() => {
    handoffCopied.value = false
  }, 1800)
}

function insertPageCard(targetRef: string, label?: string): void {
  const currentEditor = editor.value
  if (!currentEditor) {
    const line = label ? `::card[${targetRef} "${label}"]` : `::card[${targetRef}]`
    markdownDraft.value = markdownDraft.value ? `${markdownDraft.value}\n\n${line}` : line
    rawDraft.value = formatRawDocument(markdownDraft.value, frontmatterDraft.value)
    emitCurrentDraft()
    return
  }
  currentEditor
    .chain()
    .focus()
    .insertContent({
      type: 'pageCard',
      attrs: {
        target: targetRef,
        ...(label ? { label } : {}),
      },
    })
    .run()
}

defineExpose({
  flushDraft,
  insertPageCard,
})

onBeforeUnmount(() => {
  if (handoffResetTimer)
    clearTimeout(handoffResetTimer)
  editor.value?.destroy()
})
</script>

<template>
  <div class="craft-editor-shell" @keydown.meta.s.prevent="triggerSave" @keydown.ctrl.s.prevent="triggerSave">
    <header class="craft-editor-toolbar">
      <div class="craft-editor-toolbar-left">
        <div class="craft-mode-switch" role="tablist" :aria-label="copy('编辑模式', 'Editor mode')">
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'visual'"
            :class="{ active: mode === 'visual' }"
            data-testid="mode-visual"
            @click="switchMode('visual')"
          >
            {{ copy('所见即所得', 'Visual') }}
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'markdown'"
            :class="{ active: mode === 'markdown' }"
            data-testid="mode-markdown"
            @click="switchMode('markdown')"
          >
            Markdown
          </button>
        </div>

        <span
          class="craft-save-pill"
          :class="{
            saving,
            dirty: dirty && !saving,
            conflict: hasConflict || Boolean(saveError),
            readonly: isReadOnly,
          }"
          data-testid="editor-save-status"
        >
          <template v-if="isReadOnly">{{ copy('只读', 'Read-only') }}</template>
          <template v-else-if="hasConflict">{{ copy('存在冲突', 'Conflict') }}</template>
          <template v-else-if="saveError">{{ copy('保存失败', 'Save error') }}</template>
          <template v-else-if="saving">{{ copy('保存中…', 'Saving…') }}</template>
          <template v-else-if="dirty">{{ copy('未保存', 'Unsaved') }}</template>
          <template v-else>{{ copy('已保存', 'Saved') }}</template>
        </span>
      </div>

      <div class="craft-editor-toolbar-right">
        <UiButton v-if="!isReadOnly && mode === 'visual'" size="compact" variant="ghost" data-testid="toolbar-add-subpage" @click="emit('requestSubpageCard')">
          <Icon name="collection" />
          {{ copy('子页面卡片', 'Subpage card') }}
        </UiButton>
        <UiButton size="compact" variant="secondary" data-testid="copy-ai-handoff" @click="triggerCopyHandoff">
          <Icon :name="handoffCopied ? 'check' : 'copy'" />
          {{ handoffCopied ? copy('已复制上下文', 'Copied') : copy('复制 AI 上下文', 'AI Handoff') }}
        </UiButton>
        <UiButton
          size="compact"
          :variant="focusMode ? 'primary' : 'ghost'"
          :aria-pressed="focusMode"
          :title="copy('专注模式 (⌘\\)', 'Focus mode (⌘\\)')"
          data-testid="toggle-focus-mode"
          @click="emit('toggleFocus')"
        >
          <Icon :name="focusMode ? 'eyeOff' : 'eye'" />
          {{ copy('专注', 'Focus') }}
        </UiButton>
        <UiButton v-if="!isReadOnly" size="compact" variant="primary" :disabled="saving" data-testid="save-document-button" @click="triggerSave">
          {{ copy('保存', 'Save') }}
        </UiButton>
      </div>
    </header>

    <p v-if="saveError" class="craft-save-error" role="alert">{{ saveError }}</p>

    <div class="craft-canvas-scroll">
      <div class="craft-canvas-column">
        <figure v-if="coverPreviewUrl" class="craft-document-cover">
          <img :src="coverPreviewUrl" :alt="titleDraft" />
        </figure>

        <header class="craft-document-header">
          <input
            :value="titleDraft"
            :readonly="isReadOnly"
            class="craft-document-title-input"
            :placeholder="copy('无标题文档', 'Untitled document')"
            aria-label="Document title"
            data-testid="document-title-input"
            @input="handleTitleInput"
          />

          <div class="craft-properties-row">
            <label v-if="!isReadOnly || activeStatus" class="craft-property-chip">
              <span class="craft-property-key">{{ copy('状态', 'Status') }}</span>
              <select
                :value="activeStatus"
                :disabled="isReadOnly"
                class="craft-property-select"
                aria-label="Document status"
                @change="updateStatusProperty"
              >
                <option value="">{{ copy('无', 'None') }}</option>
                <option value="draft">{{ copy('草稿', 'draft') }}</option>
                <option value="active">{{ copy('进行中', 'active') }}</option>
                <option value="ready">{{ copy('就绪', 'ready') }}</option>
                <option value="archived">{{ copy('归档', 'archived') }}</option>
              </select>
            </label>

            <span v-for="tag in activeTags" :key="tag" class="craft-tag-chip">
              #{{ tag }}
              <button v-if="!isReadOnly" type="button" class="craft-tag-remove" :aria-label="`Remove ${tag}`" @click="removeTag(tag)">
                <Icon name="close" />
              </button>
            </span>

            <template v-if="!isReadOnly">
              <form v-if="tagInputOpen" class="craft-tag-form" @submit.prevent="addTag">
                <Input v-model="newTagInput" :placeholder="copy('标签名', 'Tag')" aria-label="New tag" />
                <UiButton type="submit" size="compact" variant="secondary">{{ copy('添加', 'Add') }}</UiButton>
              </form>
              <button v-else type="button" class="craft-add-tag-btn" @click="tagInputOpen = true">
                <Icon name="plus" />
                {{ copy('添加标签', 'Add tag') }}
              </button>
            </template>

            <span v-for="[key, value] in customProperties" :key="key" class="craft-property-chip readonly">
              <span class="craft-property-key">{{ key }}</span>
              <span class="craft-property-val">{{ Array.isArray(value) ? value.join(', ') : String(value) }}</span>
            </span>
          </div>
        </header>

        <div
          v-if="bubbleOpen && mode === 'visual' && editor"
          class="craft-bubble-menu"
          role="toolbar"
          aria-label="Formatting toolbar"
          :style="{ top: `${bubblePosition.top}px`, left: `${bubblePosition.left}px` }"
        >
          <button type="button" :class="{ active: editor.isActive('bold') }" title="Bold" @mousedown.prevent="editor.chain().focus().toggleBold().run()">B</button>
          <button type="button" :class="{ active: editor.isActive('italic') }" title="Italic" @mousedown.prevent="editor.chain().focus().toggleItalic().run()"><em>I</em></button>
          <button type="button" :class="{ active: editor.isActive('strike') }" title="Strike" @mousedown.prevent="editor.chain().focus().toggleStrike().run()"><s>S</s></button>
          <button type="button" :class="{ active: editor.isActive('code') }" title="Inline code" @mousedown.prevent="editor.chain().focus().toggleCode().run()">`c`</button>
          <span class="craft-bubble-divider" />
          <button type="button" :class="{ active: editor.isActive('heading', { level: 2 }) }" title="Heading 2" @mousedown.prevent="editor.chain().focus().toggleHeading({ level: 2 }).run()">H2</button>
          <button type="button" :class="{ active: editor.isActive('heading', { level: 3 }) }" title="Heading 3" @mousedown.prevent="editor.chain().focus().toggleHeading({ level: 3 }).run()">H3</button>
          <button type="button" :class="{ active: editor.isActive('link') }" title="Link" @mousedown.prevent="linkInputOpen = !linkInputOpen">Link</button>
          <form v-if="linkInputOpen" class="craft-bubble-link-form" @submit.prevent="applySelectionLink">
            <Input v-model="linkUrlInput" placeholder="https://..." aria-label="Link URL" />
            <UiButton type="submit" size="compact" variant="primary">{{ copy('应用', 'Set') }}</UiButton>
          </form>
        </div>

        <EditorContent v-if="mode === 'visual' && editor" :editor="editor" class="craft-tiptap-host" />

        <textarea
          v-else
          v-model="rawDraft"
          :readonly="isReadOnly"
          class="craft-raw-markdown-textarea"
          spellcheck="false"
          data-testid="raw-markdown-textarea"
          aria-label="Raw Markdown editor"
          @input="handleRawInput"
        />
      </div>
    </div>

    <SlashCommandMenu
      ref="slashMenuRef"
      :open="slashOpen"
      :query="slashQuery"
      :position="slashPosition"
      @select="applySlashCommand"
      @close="slashOpen = false"
    />
  </div>
</template>

<style scoped>
.craft-editor-shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.craft-editor-toolbar {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  padding: var(--space-2) var(--space-4);
}
.craft-editor-toolbar-left,
.craft-editor-toolbar-right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.craft-mode-switch {
  display: inline-flex;
  gap: 2px;
  border: 1px solid var(--navigation-track-border);
  border-radius: var(--control-radius);
  background: var(--navigation-track-background);
  padding: 2px;
}
.craft-mode-switch button {
  min-height: 24px;
  border-radius: var(--navigation-segmented-item-radius);
  background: transparent;
  padding: 2px 10px;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  font-weight: 500;
}
.craft-mode-switch button.active {
  background: var(--navigation-selection-background);
  color: var(--text);
  box-shadow: var(--navigation-selection-shadow);
}
.craft-save-pill {
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--success) 12%, var(--surface));
  padding: 2px 9px;
  color: var(--success);
  font-size: var(--font-size-caption);
  font-weight: 500;
}
.craft-save-pill.saving {
  background: var(--accent-soft);
  color: var(--accent);
}
.craft-save-pill.dirty {
  background: var(--warning-soft);
  color: var(--warning);
}
.craft-save-pill.conflict {
  background: var(--danger-soft);
  color: var(--danger);
}
.craft-save-pill.readonly {
  background: var(--surface-muted);
  color: var(--muted);
}
.craft-save-error {
  margin: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--danger) 30%, var(--border));
  background: var(--danger-soft);
  padding: var(--space-2) var(--space-4);
  color: var(--danger);
  font-size: var(--font-size-caption);
}
.craft-canvas-scroll {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--surface);
}
.craft-canvas-column {
  width: min(740px, 100%);
  margin: 0 auto;
  padding: var(--space-5) var(--page-padding-inline) 72px;
}
.craft-document-cover {
  margin: 0 0 var(--space-4);
  overflow: hidden;
  border-radius: var(--panel-radius);
  border: 1px solid var(--border);
  max-height: 220px;
}
.craft-document-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.craft-document-header {
  display: grid;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
  border-bottom: 1px solid var(--border);
  padding-bottom: var(--space-4);
}
.craft-document-title-input {
  width: 100%;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font-family: var(--font-body);
  font-size: 28px;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.02em;
}
.craft-document-title-input::placeholder {
  color: var(--muted);
}
.craft-properties-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.craft-property-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-subtle);
  padding: 2px 10px;
  font-size: var(--font-size-caption);
}
.craft-property-key {
  color: var(--muted);
}
.craft-property-val {
  color: var(--text);
  font-weight: 500;
}
.craft-property-select {
  border: 0;
  outline: none;
  background-color: transparent;
  padding-inline: 0 18px;
  color: var(--text);
  font-size: var(--font-size-caption);
  font-weight: 500;
}
.craft-tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  padding: 2px 9px;
  color: var(--accent);
  font-size: var(--font-size-caption);
  font-weight: 500;
}
.craft-tag-remove {
  display: grid;
  width: 14px;
  height: 14px;
  place-items: center;
  border-radius: 999px;
  background: transparent;
  padding: 0;
  color: inherit;
}
.craft-tag-remove :deep(.app-icon) {
  width: 11px;
  height: 11px;
}
.craft-add-tag-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-pill);
  background: transparent;
  padding: 2px 9px;
  color: var(--muted);
  font-size: var(--font-size-caption);
}
.craft-add-tag-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.craft-add-tag-btn :deep(.app-icon) {
  width: 12px;
  height: 12px;
}
.craft-tag-form {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.craft-tag-form :deep(input) {
  width: 110px;
  height: 24px;
  font-size: var(--font-size-caption);
}
.craft-bubble-menu {
  position: fixed;
  z-index: 25;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  border: 1px solid var(--menu-border);
  border-radius: var(--control-radius);
  background: var(--menu-background);
  padding: 4px;
  box-shadow: var(--menu-shadow);
}
.craft-bubble-menu > button {
  min-width: 28px;
  height: 26px;
  border-radius: 5px;
  background: transparent;
  padding: 0 7px;
  color: var(--text);
  font-size: var(--font-size-caption);
  font-weight: 600;
}
.craft-bubble-menu > button:hover {
  background: var(--surface-hover);
}
.craft-bubble-menu > button.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.craft-bubble-divider {
  width: 1px;
  height: 16px;
  margin: 0 2px;
  background: var(--border);
}
.craft-bubble-link-form {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
}
.craft-bubble-link-form :deep(input) {
  width: 180px;
  height: 26px;
  font-size: var(--font-size-caption);
}
.craft-raw-markdown-textarea {
  width: 100%;
  min-height: 460px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: var(--panel-radius);
  background: var(--surface-subtle);
  padding: var(--space-4);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.65;
  outline: none;
}
.craft-raw-markdown-textarea:focus {
  border-color: var(--accent);
}

.craft-tiptap-host :deep(.craft-prosemirror-surface) {
  min-height: 380px;
  outline: none;
  color: var(--text);
  font-size: 15px;
  line-height: 1.72;
}
.craft-tiptap-host :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  color: var(--muted);
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}
.craft-tiptap-host :deep(h1),
.craft-tiptap-host :deep(h2),
.craft-tiptap-host :deep(h3),
.craft-tiptap-host :deep(h4) {
  margin: 1.4em 0 0.55em;
  font-weight: 650;
  line-height: 1.3;
  letter-spacing: -0.015em;
}
.craft-tiptap-host :deep(h1) { font-size: 24px; }
.craft-tiptap-host :deep(h2) { font-size: 20px; }
.craft-tiptap-host :deep(h3) { font-size: 17px; }
.craft-tiptap-host :deep(p) {
  margin: 0.65em 0;
}
.craft-tiptap-host :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.craft-tiptap-host :deep(code) {
  border-radius: 5px;
  background: var(--surface-muted);
  padding: 1px 5px;
  font-family: var(--font-mono);
  font-size: 0.9em;
}
.craft-tiptap-host :deep(pre) {
  margin: var(--space-3) 0;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  background: var(--surface-subtle);
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
}
.craft-tiptap-host :deep(pre code) {
  background: transparent;
  padding: 0;
}
.craft-tiptap-host :deep(blockquote) {
  margin: var(--space-3) 0;
  border-left: 3px solid var(--border-strong);
  padding: 2px 0 2px var(--space-4);
  color: var(--text-secondary);
}
.craft-tiptap-host :deep(.craft-callout) {
  margin: var(--space-3) 0;
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent);
  border-radius: var(--control-radius);
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
  padding: var(--space-3) var(--space-4);
}
.craft-tiptap-host :deep(.craft-callout[data-variant='tip']) {
  border-left-color: var(--success);
  background: color-mix(in srgb, var(--success) 7%, var(--surface));
}
.craft-tiptap-host :deep(.craft-callout[data-variant='important']) {
  border-left-color: var(--status-review);
  background: color-mix(in srgb, var(--status-review) 7%, var(--surface));
}
.craft-tiptap-host :deep(.craft-callout[data-variant='warning']) {
  border-left-color: var(--warning);
  background: color-mix(in srgb, var(--warning) 8%, var(--surface));
}
.craft-tiptap-host :deep(.craft-callout[data-variant='caution']) {
  border-left-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 7%, var(--surface));
}
.craft-tiptap-host :deep(ul),
.craft-tiptap-host :deep(ol) {
  margin: var(--space-2) 0;
  padding-left: 1.45em;
}
.craft-tiptap-host :deep(ul[data-type='taskList']) {
  list-style: none;
  padding-left: 0;
}
.craft-tiptap-host :deep(ul[data-type='taskList'] li) {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 4px 0;
}
.craft-tiptap-host :deep(ul[data-type='taskList'] li > label) {
  flex: none;
  margin-top: 4px;
}
.craft-tiptap-host :deep(ul[data-type='taskList'] li > div) {
  min-width: 0;
  flex: 1;
}
.craft-tiptap-host :deep(ul[data-type='taskList'] li > div > p) {
  margin: 0;
}
.craft-tiptap-host :deep(table) {
  width: 100%;
  margin: var(--space-3) 0;
  border-collapse: collapse;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
}
.craft-tiptap-host :deep(th),
.craft-tiptap-host :deep(td) {
  border: 1px solid var(--border);
  padding: var(--space-2) var(--space-3);
  text-align: left;
  vertical-align: top;
}
.craft-tiptap-host :deep(th) {
  background: var(--surface-subtle);
  font-weight: 600;
}
.craft-tiptap-host :deep(hr) {
  border: 0;
  border-top: 1px solid var(--border);
  margin: var(--space-5) 0;
}
.craft-tiptap-host :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--control-radius);
  border: 1px solid var(--border);
}
</style>

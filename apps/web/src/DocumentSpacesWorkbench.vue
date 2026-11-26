<script setup lang="ts">
import type { DocumentCard, DocumentNode, DocumentRecord, DocumentSpace, DocumentSpaceChangeEvent } from 'craft-hub'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Input } from './components/ui/input'
import { subscribeDocumentSpaceChanges } from './document-space-events'
import CraftDocumentEditor from './documents/CraftDocumentEditor.vue'
import DocumentConflictBanner from './documents/DocumentConflictBanner.vue'
import DocumentTreeBranch from './documents/DocumentTreeBranch.vue'
import { formatRawDocument } from './documents/markdown-codec'
import { useI18n } from './i18n'
import Icon from './NavigationIcon.vue'
import { matchesShortcut } from './shortcuts'
import { useWorkbenchStore } from './store'
import VisualIcon from './VisualIcon.vue'

const props = withDefaults(defineProps<{
  embedded?: boolean
  initialSpaceId?: string
  initialDocPath?: string
  rootPath?: string
  focusMode?: boolean
}>(), {
  embedded: false,
  focusMode: false,
})

const emit = defineEmits<{
  'update:focusMode': [value: boolean]
  'navigate': [spaceId: string, docPath?: string]
}>()

const store = useWorkbenchStore()
const { locale } = useI18n()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en

const spaces = ref<DocumentSpace[]>([])
const spacesLoading = ref(true)
const spacesError = ref('')
const activeSpaceId = ref('')
const activeSpace = computed(() => spaces.value.find(space => space.id === activeSpaceId.value))
const canBindLocalSpace = computed(() => store.hostEnvironment?.capabilities.localProjectDirectories !== false)
const canChooseLocalDirectory = Boolean(window.craftHubDesktop?.selectProjectDirectory)

const nodesByParent = reactive<Record<string, DocumentNode[]>>({})
const expandedFolders = reactive<Record<string, boolean>>({})
const nodesLoading = ref(false)
const nodesError = ref('')
const selectedFolderPath = ref(props.rootPath ?? '')
const searchQuery = ref('')
const collectionViewMode = ref<'grid' | 'list'>('grid')

const activeDocument = ref<DocumentRecord>()
const documentLoading = ref(false)
const documentError = ref('')
const lastKnownRevision = ref('')
const draftTitle = ref('')
const draftFrontmatter = ref<Record<string, unknown>>({})
const draftMarkdown = ref('')
const draftDirty = ref(false)
const saving = ref(false)
const saveError = ref('')
const conflictState = ref<{ current: DocumentRecord, message: string, localContent: string }>()
const editorRef = ref<InstanceType<typeof CraftDocumentEditor>>()

const addSpaceDialogOpen = ref(false)
const addSpacePath = ref('')
const addSpaceTitle = ref('')
const addSpaceSubmitting = ref(false)
const addSpaceError = ref('')

const createDialogOpen = ref(false)
const createKind = ref<'document' | 'bundle' | 'subpage-card'>('document')
const createTitle = ref('')
const createSubmitting = ref(false)
const createError = ref('')

const handoffToast = ref('')
let handoffToastTimer: ReturnType<typeof setTimeout> | undefined
let autosaveTimer: ReturnType<typeof setTimeout> | undefined
let stopSpaceEvents: (() => void) | undefined

const isReadOnly = computed(() => Boolean(activeSpace.value?.readOnly || activeDocument.value?.readOnly))
const activeBundleDir = computed(() => {
  if (!activeDocument.value)
    return ''
  const fileName = activeDocument.value.path.split('/').at(-1)?.toLowerCase() ?? ''
  if (['index.md', 'brief.md', 'readme.md'].includes(fileName))
    return activeDocument.value.folderPath ?? ''
  return ''
})

const rootNodes = computed(() => nodesByParent[props.rootPath ?? ''] ?? [])

const collectionNodes = computed(() => {
  const list = nodesByParent[selectedFolderPath.value] ?? []
  const q = searchQuery.value.trim().toLowerCase()
  if (!q)
    return list
  return list.filter(node =>
    node.title.toLowerCase().includes(q)
    || node.name.toLowerCase().includes(q)
    || (node.summary?.toLowerCase().includes(q) ?? false)
    || (node.tags?.some(tag => tag.toLowerCase().includes(q)) ?? false),
  )
})

const breadcrumbs = computed(() => {
  if (!activeSpace.value)
    return []
  if (activeDocument.value) {
    return activeDocument.value.breadcrumbs
  }
  if (!selectedFolderPath.value)
    return []
  const parts = selectedFolderPath.value.split('/').filter(Boolean)
  return parts.map((segment, index) => ({
    path: parts.slice(0, index + 1).join('/'),
    title: segment,
  }))
})

function resetSpaceTreeState(): void {
  for (const key of Object.keys(nodesByParent))
    delete nodesByParent[key]
  for (const key of Object.keys(expandedFolders))
    delete expandedFolders[key]
}

async function loadNodes(parentPath = ''): Promise<DocumentNode[]> {
  if (!activeSpaceId.value)
    return []
  nodesLoading.value = true
  nodesError.value = ''
  try {
    const list = await api.documentSpaceNodes(activeSpaceId.value, parentPath)
    nodesByParent[parentPath] = list
    return list
  }
  catch (caught) {
    nodesError.value = caught instanceof Error ? caught.message : String(caught)
    return []
  }
  finally {
    nodesLoading.value = false
  }
}

async function openDocument(docPath: string, options: { emitNav?: boolean } = { emitNav: true }): Promise<void> {
  if (!activeSpaceId.value || !docPath)
    return
  if (draftDirty.value && !conflictState.value && activeDocument.value && !isReadOnly.value && activeDocument.value.path !== docPath)
    await saveNow()

  clearAutosave()
  documentLoading.value = true
  documentError.value = ''
  conflictState.value = undefined
  saveError.value = ''
  try {
    const doc = await api.readDocument(activeSpaceId.value, docPath)
    activeDocument.value = doc
    lastKnownRevision.value = doc.revision
    draftTitle.value = doc.title
    draftFrontmatter.value = { ...doc.frontmatter }
    draftMarkdown.value = doc.markdown
    draftDirty.value = false
    if (doc.folderPath) {
      selectedFolderPath.value = doc.folderPath
      expandedFolders[doc.folderPath] = true
    }
    if (options.emitNav)
      emit('navigate', activeSpaceId.value, doc.path)
  }
  catch (caught) {
    documentError.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    documentLoading.value = false
  }
}

async function selectSpace(spaceId: string, initialDoc?: string): Promise<void> {
  if (!spaceId)
    return
  clearAutosave()
  activeSpaceId.value = spaceId
  activeDocument.value = undefined
  conflictState.value = undefined
  draftDirty.value = false
  saveError.value = ''
  documentError.value = ''
  selectedFolderPath.value = props.rootPath ?? ''
  resetSpaceTreeState()
  const rootList = await loadNodes(props.rootPath ?? '')
  if (initialDoc) {
    await openDocument(initialDoc, { emitNav: false })
  }
  else {
    emit('navigate', spaceId)
    if (!rootList.length)
      selectedFolderPath.value = props.rootPath ?? ''
  }
}

async function loadSpaces(): Promise<void> {
  spacesLoading.value = true
  spacesError.value = ''
  try {
    const list = await api.documentSpaces()
    spaces.value = list
    const targetSpace = (props.initialSpaceId && list.some(space => space.id === props.initialSpaceId))
      ? props.initialSpaceId
      : (activeSpaceId.value && list.some(space => space.id === activeSpaceId.value))
          ? activeSpaceId.value
          : (list[0]?.id ?? '')

    if (targetSpace) {
      await selectSpace(targetSpace, props.initialDocPath)
    }
    else {
      activeSpaceId.value = ''
      activeDocument.value = undefined
      resetSpaceTreeState()
    }
  }
  catch (caught) {
    spacesError.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    spacesLoading.value = false
  }
}

async function toggleFolder(folderPath: string): Promise<void> {
  const next = !expandedFolders[folderPath]
  expandedFolders[folderPath] = next
  if (next)
    await loadNodes(folderPath)
}

async function selectNode(node: DocumentNode): Promise<void> {
  if (node.kind === 'folder') {
    activeDocument.value = undefined
    selectedFolderPath.value = node.path
    expandedFolders[node.path] = true
    await loadNodes(node.path)
    if (activeSpaceId.value)
      emit('navigate', activeSpaceId.value)
    return
  }
  await openDocument(node.primaryDocumentPath ?? node.path)
}

function enterCollectionFolder(folderPath = ''): void {
  activeDocument.value = undefined
  conflictState.value = undefined
  draftDirty.value = false
  selectedFolderPath.value = folderPath
  void loadNodes(folderPath)
  if (activeSpaceId.value)
    emit('navigate', activeSpaceId.value)
}

function openCreateDialog(kind: 'document' | 'bundle' | 'subpage-card'): void {
  createKind.value = kind
  createTitle.value = ''
  createError.value = ''
  createDialogOpen.value = true
}

function deriveSlug(title: string): string {
  const trimmed = title.trim()
  const cleaned = Array.from(trimmed, ch => ('\\/:*?"<>|'.includes(ch) ? '-' : ch))
    .join('')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || `note-${Date.now()}`
}

async function submitCreateDocument(): Promise<void> {
  const title = createTitle.value.trim()
  if (!title || !activeSpaceId.value || createSubmitting.value)
    return
  createSubmitting.value = true
  createError.value = ''
  try {
    const parentPath = createKind.value === 'subpage-card'
      ? (activeDocument.value?.folderPath ?? selectedFolderPath.value)
      : selectedFolderPath.value
    const slug = deriveSlug(title)
    const created = await api.createDocument(activeSpaceId.value, {
      parentPath: parentPath || undefined,
      name: slug,
      title,
      kind: createKind.value === 'bundle' ? 'bundle' : 'document',
    })
    createDialogOpen.value = false
    await loadNodes(parentPath || '')
    if (createKind.value === 'subpage-card' && activeDocument.value) {
      const targetRef = `./${slug}.md`
      editorRef.value?.insertPageCard(targetRef, title)
      await saveNow()
      const refreshed = await api.readDocument(activeSpaceId.value, activeDocument.value.path)
      activeDocument.value = refreshed
      lastKnownRevision.value = refreshed.revision
    }
    else {
      await openDocument(created.path)
    }
  }
  catch (caught) {
    createError.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    createSubmitting.value = false
  }
}

async function openTodayDailyNote(): Promise<void> {
  if (!activeSpaceId.value || activeSpace.value?.readOnly)
    return
  try {
    const doc = await api.openDailyNote(activeSpaceId.value)
    await Promise.all([loadNodes(''), loadNodes('daily')])
    expandedFolders.daily = true
    await openDocument(doc.path)
  }
  catch (caught) {
    documentError.value = caught instanceof Error ? caught.message : String(caught)
  }
}

async function chooseLocalFolder(): Promise<void> {
  const selected = await window.craftHubDesktop?.selectProjectDirectory?.()
  if (selected)
    addSpacePath.value = selected
}

async function submitAddLocalSpace(): Promise<void> {
  const path = addSpacePath.value.trim()
  if (!path || addSpaceSubmitting.value)
    return
  addSpaceSubmitting.value = true
  addSpaceError.value = ''
  try {
    const created = await api.registerLocalDocumentSpace({
      path,
      ...(addSpaceTitle.value.trim() ? { title: addSpaceTitle.value.trim() } : {}),
    })
    addSpaceDialogOpen.value = false
    addSpacePath.value = ''
    addSpaceTitle.value = ''
    spaces.value = await api.documentSpaces()
    await selectSpace(created.id)
  }
  catch (caught) {
    addSpaceError.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    addSpaceSubmitting.value = false
  }
}

async function unregisterCurrentSpace(): Promise<void> {
  if (!activeSpace.value || activeSpace.value.kind !== 'local')
    return
  await api.unregisterLocalDocumentSpace(activeSpace.value.id)
  activeSpaceId.value = ''
  await loadSpaces()
}

function clearAutosave(): void {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer)
    autosaveTimer = undefined
  }
}

function handleDraftUpdate(payload: { title: string, frontmatter: Record<string, unknown>, markdown: string }): void {
  draftTitle.value = payload.title
  draftFrontmatter.value = payload.frontmatter
  draftMarkdown.value = payload.markdown
  draftDirty.value = true
  saveError.value = ''
  if (isReadOnly.value || conflictState.value)
    return
  clearAutosave()
  autosaveTimer = setTimeout(() => {
    void saveNow()
  }, 800)
}

async function saveNow(force = false, explicitPayload?: { markdown: string, frontmatter: Record<string, unknown> }): Promise<void> {
  if (!activeSpaceId.value || !activeDocument.value || isReadOnly.value || saving.value)
    return
  clearAutosave()
  const payload = explicitPayload ?? editorRef.value?.flushDraft() ?? {
    markdown: draftMarkdown.value,
    frontmatter: draftFrontmatter.value,
  }
  const expectedRevision = force
    ? conflictState.value?.current.revision
    : lastKnownRevision.value || activeDocument.value.revision
  saving.value = true
  saveError.value = ''
  try {
    const result = await api.writeDocument(activeSpaceId.value, {
      path: activeDocument.value.path,
      markdown: payload.markdown,
      frontmatter: payload.frontmatter,
      expectedRevision,
    })
    if (result.status === 'conflict') {
      conflictState.value = {
        current: result.current,
        message: result.message,
        localContent: formatRawDocument(payload.markdown, payload.frontmatter),
      }
      return
    }
    activeDocument.value = result.document
    lastKnownRevision.value = result.document.revision
    draftTitle.value = result.document.title
    draftFrontmatter.value = { ...result.document.frontmatter }
    draftMarkdown.value = result.document.markdown
    draftDirty.value = false
    conflictState.value = undefined
    await loadNodes(result.document.folderPath ?? '')
  }
  catch (caught) {
    saveError.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    saving.value = false
  }
}

async function reloadFromDisk(): Promise<void> {
  if (!activeSpaceId.value || !activeDocument.value)
    return
  conflictState.value = undefined
  draftDirty.value = false
  await openDocument(activeDocument.value.path, { emitNav: false })
}

async function keepLocalVersion(): Promise<void> {
  await saveNow(true)
}

function handleOpenCard(targetPath: string): void {
  void openDocument(targetPath)
}

function openSubpageFromCard(card: DocumentCard): void {
  void openDocument(card.path)
}

async function handleCopyHandoff(selectionText: string): Promise<void> {
  if (!activeSpace.value || !activeDocument.value)
    return
  const lines = [
    `- Space: ${activeSpace.value.title} (${activeSpace.value.id})`,
    ...(activeSpace.value.rootPath ? [`- Local Root: ${activeSpace.value.rootPath}`] : []),
    `- Document: ${activeDocument.value.path}`,
    `- Revision: ${activeDocument.value.revision}`,
    `- Title: ${draftTitle.value || activeDocument.value.title}`,
  ]
  if (selectionText.trim())
    lines.push('', 'Excerpt:', '```markdown', selectionText.trim(), '```')
  const payload = lines.join('\n')
  try {
    await navigator.clipboard?.writeText(payload)
    handoffToast.value = copy('已复制 AI / Paseo 上下文', 'Copied AI / Paseo handoff context')
    if (handoffToastTimer)
      clearTimeout(handoffToastTimer)
    handoffToastTimer = setTimeout(() => {
      handoffToast.value = ''
    }, 2200)
  }
  catch {
    handoffToast.value = copy('复制失败，请检查剪贴板权限', 'Clipboard unavailable')
  }
}

async function handleExternalChange(event: DocumentSpaceChangeEvent): Promise<void> {
  if (event.spaceId !== activeSpaceId.value)
    return
  const affectedDirs = new Set<string>([props.rootPath ?? ''])
  for (const changedPath of event.paths) {
    const slash = changedPath.lastIndexOf('/')
    if (slash > 0)
      affectedDirs.add(changedPath.slice(0, slash))
  }
  await Promise.all([...affectedDirs].map(dir => loadNodes(dir).catch(() => [])))

  const currentDoc = activeDocument.value
  if (!currentDoc || !event.paths.includes(currentDoc.path))
    return

  try {
    const latest = await api.readDocument(activeSpaceId.value, currentDoc.path)
    if (latest.revision === lastKnownRevision.value)
      return
    if (!draftDirty.value) {
      activeDocument.value = latest
      lastKnownRevision.value = latest.revision
      draftTitle.value = latest.title
      draftFrontmatter.value = { ...latest.frontmatter }
      draftMarkdown.value = latest.markdown
      conflictState.value = undefined
    }
    else {
      conflictState.value = {
        current: latest,
        message: copy('磁盘文件在外部被更新，当前包含未保存内容。', 'File updated on disk while you have unsaved edits.'),
        localContent: formatRawDocument(draftMarkdown.value, draftFrontmatter.value),
      }
    }
  }
  catch {
    // External delete/transient lock leaves existing editor content intact.
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing)
    return
  const platform = window.craftHubDesktop?.platform ?? navigator.platform
  if (matchesShortcut(event, 'Mod+J', platform)) {
    event.preventDefault()
    void openTodayDailyNote()
    return
  }
  if (matchesShortcut(event, 'Mod+\\', platform)) {
    event.preventDefault()
    emit('update:focusMode', !props.focusMode)
  }
}

async function refresh(): Promise<void> {
  await loadSpaces()
}

defineExpose({ refresh })

watch(() => [props.initialSpaceId, props.initialDocPath] as const, ([spaceId, docPath], [prevSpaceId, prevDocPath]) => {
  if (spaceId && spaceId !== activeSpaceId.value && spaces.value.some(space => space.id === spaceId)) {
    void selectSpace(spaceId, docPath)
    return
  }
  if (docPath && docPath !== activeDocument.value?.path && docPath !== prevDocPath && spaceId === prevSpaceId) {
    void openDocument(docPath, { emitNav: false })
    return
  }
  if (!docPath && prevDocPath && spaceId === activeSpaceId.value) {
    activeDocument.value = undefined
    conflictState.value = undefined
    draftDirty.value = false
  }
})

onMounted(() => {
  if (!props.embedded)
    window.addEventListener('keydown', onKeydown)
  stopSpaceEvents = subscribeDocumentSpaceChanges(event => void handleExternalChange(event))
  void loadSpaces()
})

onBeforeUnmount(() => {
  if (!props.embedded)
    window.removeEventListener('keydown', onKeydown)
  clearAutosave()
  if (handoffToastTimer)
    clearTimeout(handoffToastTimer)
  stopSpaceEvents?.()
})
</script>

<template>
  <section class="document-spaces-workbench" :class="{ embedded, 'focus-mode': focusMode }" data-testid="document-spaces-workbench">
    <aside v-if="!focusMode" class="spaces-sidebar" data-testid="spaces-sidebar">
      <header class="spaces-sidebar-header">
        <div class="spaces-selector-row">
          <select
            v-if="spaces.length"
            :value="activeSpaceId"
            class="spaces-selector"
            aria-label="Document space"
            data-testid="space-selector"
            @change="selectSpace(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="space in spaces" :key="space.id" :value="space.id">
              {{ space.title }}
            </option>
          </select>
          <strong v-else class="spaces-sidebar-title">{{ copy('文档空间', 'Document Spaces') }}</strong>

          <UiButton
            v-if="canBindLocalSpace"
            size="icon"
            variant="ghost"
            :title="copy('添加本地目录', 'Add local folder')"
            aria-label="Add local folder"
            data-testid="add-local-space-button"
            @click="addSpaceDialogOpen = true"
          >
            <Icon name="plus" />
          </UiButton>
          <UiButton
            v-if="activeSpace?.kind === 'local' && canBindLocalSpace"
            size="icon"
            variant="ghost"
            :title="copy('移除空间绑定（不删除文件）', 'Unregister space')"
            aria-label="Unregister space"
            data-testid="remove-local-space-button"
            @click="unregisterCurrentSpace"
          >
            <Icon name="trash" />
          </UiButton>
        </div>

        <div v-if="activeSpace" class="spaces-quick-actions">
          <UiButton
            v-if="!activeSpace.readOnly"
            size="compact"
            variant="secondary"
            data-testid="daily-note-button"
            @click="openTodayDailyNote"
          >
            <Icon name="calendar" />
            {{ copy('今日笔记', 'Daily Note') }}
          </UiButton>
          <UiButton
            v-if="activeSpace.capabilities.create && !activeSpace.readOnly"
            size="compact"
            variant="secondary"
            data-testid="new-document-button"
            @click="openCreateDialog('document')"
          >
            <Icon name="docs" />
            {{ copy('新建页面', 'New page') }}
          </UiButton>
          <UiButton
            v-if="activeSpace.capabilities.create && !activeSpace.readOnly"
            size="compact"
            variant="ghost"
            :title="copy('新建目录卡片包', 'New folder bundle')"
            data-testid="new-bundle-button"
            @click="openCreateDialog('bundle')"
          >
            <Icon name="collection" />
            {{ copy('卡片包', 'Bundle') }}
          </UiButton>
        </div>

        <div v-if="activeSpace" class="spaces-search-box">
          <Icon name="search" />
          <input
            v-model="searchQuery"
            type="search"
            :placeholder="copy('过滤文档与卡片…', 'Filter pages and cards…')"
            aria-label="Filter documents"
            data-testid="space-search-input"
          />
          <button v-if="searchQuery" type="button" aria-label="Clear search" @click="searchQuery = ''">
            <Icon name="close" />
          </button>
        </div>
      </header>

      <div class="spaces-tree-scroll">
        <p v-if="spacesLoading || (nodesLoading && !rootNodes.length)" class="spaces-tree-empty">
          {{ copy('正在加载文档空间…', 'Loading spaces…') }}
        </p>
        <p v-else-if="nodesError" class="spaces-tree-error">{{ nodesError }}</p>
        <p v-else-if="activeSpace && !rootNodes.length" class="spaces-tree-empty">
          {{ copy('此目录中还没有 Markdown 文档。', 'No Markdown documents in this folder yet.') }}
        </p>
        <DocumentTreeBranch
          v-else-if="activeSpace"
          :nodes="rootNodes"
          :nodes-by-parent="nodesByParent"
          :expanded-folders="expandedFolders"
          :active-doc-path="activeDocument?.path ?? ''"
          :active-folder-path="selectedFolderPath"
          :search-query="searchQuery"
          @toggle-folder="toggleFolder"
          @select-node="selectNode"
        />
      </div>
    </aside>

    <main class="spaces-main">
      <div v-if="handoffToast" class="spaces-toast" role="status">{{ handoffToast }}</div>

      <section v-if="!spacesLoading && !spaces.length" class="spaces-empty-onboarding" data-testid="spaces-empty-state">
        <div class="spaces-empty-card">
          <span class="spaces-empty-icon"><Icon name="docs" /></span>
          <h1>{{ copy('本地优先的文档与灵感空间', 'Local-first Document Spaces') }}</h1>
          <p>{{ copy('挂载本机 Markdown 目录或项目文档库，用卡片、折叠块、今日笔记与本地 AI 一起创作，文件始终留在你的磁盘上。', 'Mount a local Markdown folder to write with Craft-style cards, toggles, daily notes, and local AI handoff while files stay on disk.') }}</p>
          <div class="spaces-empty-actions">
            <UiButton v-if="canBindLocalSpace" variant="primary" data-testid="empty-add-space-button" @click="addSpaceDialogOpen = true">
              <Icon name="folderOpen" />
              {{ copy('添加本地文档目录', 'Add local Markdown folder') }}
            </UiButton>
            <p v-else class="spaces-hosted-hint">{{ copy('当前托管环境不支持挂载本机目录，可查看插件提供的只读文档空间。', 'Local directories are unavailable on this host.') }}</p>
          </div>
          <p v-if="spacesError" class="spaces-tree-error">{{ spacesError }}</p>
        </div>
      </section>

      <template v-else-if="activeSpace">
        <nav v-if="breadcrumbs.length || activeDocument" class="spaces-breadcrumbs" aria-label="Document breadcrumbs">
          <button type="button" class="spaces-breadcrumb-item" data-testid="breadcrumb-root" @click="enterCollectionFolder(rootPath ?? '')">
            <Icon name="folderOpen" />
            {{ activeSpace.title }}
          </button>
          <template v-for="(crumb, index) in breadcrumbs" :key="crumb.path">
            <Icon name="arrowRight" class="spaces-breadcrumb-sep" />
            <button
              type="button"
              class="spaces-breadcrumb-item"
              :class="{ current: index === breadcrumbs.length - 1 && activeDocument }"
              @click="index === breadcrumbs.length - 1 && activeDocument ? undefined : crumb.path.endsWith('.md') ? openDocument(crumb.path) : enterCollectionFolder(crumb.path)"
            >
              {{ crumb.title }}
            </button>
          </template>
          <UiButton
            v-if="focusMode"
            size="compact"
            variant="ghost"
            class="spaces-exit-focus"
            data-testid="exit-focus-mode"
            @click="emit('update:focusMode', false)"
          >
            {{ copy('退出专注 (⌘\\)', 'Exit focus') }}
          </UiButton>
        </nav>

        <section v-if="documentLoading && !activeDocument" class="spaces-loading-panel">
          <Icon name="loading" />
          <span>{{ copy('正在打开文档…', 'Opening document…') }}</span>
        </section>

        <section v-else-if="activeDocument" class="spaces-document-view">
          <DocumentConflictBanner
            v-if="conflictState"
            :path="activeDocument.path"
            :message="conflictState.message"
            :disk-content="conflictState.current.rawContent"
            :local-content="conflictState.localContent"
            :saving="saving"
            @reload="reloadFromDisk"
            @keep-local="keepLocalVersion"
          />

          <p v-if="documentError" class="spaces-tree-error">{{ documentError }}</p>

          <CraftDocumentEditor
            ref="editorRef"
            :space="activeSpace"
            :document="activeDocument"
            :focus-mode="focusMode"
            :saving="saving"
            :dirty="draftDirty"
            :has-conflict="Boolean(conflictState)"
            :save-error="saveError"
            @update-draft="handleDraftUpdate"
            @save="payload => saveNow(false, payload)"
            @open-card="handleOpenCard"
            @request-subpage-card="openCreateDialog('subpage-card')"
            @toggle-focus="emit('update:focusMode', !focusMode)"
            @copy-handoff="handleCopyHandoff"
          />

          <footer v-if="activeDocument.cards.length || activeBundleDir" class="spaces-subpage-strip" data-testid="subpage-cards-strip">
            <div class="spaces-subpage-strip-header">
              <h2>{{ copy('关联子页面与卡片', 'Subpage cards') }}</h2>
              <UiButton
                v-if="!isReadOnly && activeSpace.capabilities.create"
                size="compact"
                variant="secondary"
                data-testid="add-subpage-card-button"
                @click="openCreateDialog('subpage-card')"
              >
                <Icon name="plus" />
                {{ copy('添加子页面卡片', 'Add subpage card') }}
              </UiButton>
            </div>
            <div v-if="activeDocument.cards.length" class="spaces-card-grid compact">
              <button
                v-for="card in activeDocument.cards"
                :key="card.path"
                type="button"
                class="spaces-collection-card"
                data-testid="subpage-card-item"
                @click="openSubpageFromCard(card)"
              >
                <span class="spaces-card-icon">
                  <VisualIcon v-if="card.icon" :icon="card.icon" :fallback="card.kind === 'bundle' ? 'folderOpen' : 'docs'" />
                  <Icon v-else :name="card.kind === 'bundle' ? 'folderOpen' : 'docs'" />
                </span>
                <span class="spaces-card-body">
                  <strong>{{ card.title }}</strong>
                  <small v-if="card.summary">{{ card.summary }}</small>
                  <small v-else>{{ card.path }}</small>
                </span>
              </button>
            </div>
          </footer>
        </section>

        <section v-else class="spaces-collection-view" data-testid="collection-view">
          <header class="spaces-collection-header">
            <div>
              <h1>{{ selectedFolderPath ? selectedFolderPath.split('/').at(-1) : activeSpace.title }}</h1>
              <p v-if="activeSpace.description">{{ activeSpace.description }}</p>
              <code v-else-if="activeSpace.rootPath">{{ activeSpace.rootPath }}</code>
            </div>
            <div class="spaces-collection-actions">
              <div class="spaces-view-toggle" role="tablist" aria-label="Collection view layout">
                <button
                  type="button"
                  role="tab"
                  :aria-selected="collectionViewMode === 'grid'"
                  :class="{ active: collectionViewMode === 'grid' }"
                  data-testid="collection-view-grid"
                  @click="collectionViewMode = 'grid'"
                >
                  {{ copy('卡片网格', 'Cards') }}
                </button>
                <button
                  type="button"
                  role="tab"
                  :aria-selected="collectionViewMode === 'list'"
                  :class="{ active: collectionViewMode === 'list' }"
                  data-testid="collection-view-list"
                  @click="collectionViewMode = 'list'"
                >
                  {{ copy('列表', 'List') }}
                </button>
              </div>
              <UiButton
                v-if="activeSpace.capabilities.create && !activeSpace.readOnly"
                size="compact"
                variant="primary"
                @click="openCreateDialog('document')"
              >
                <Icon name="plus" />
                {{ copy('新建页面', 'New page') }}
              </UiButton>
            </div>
          </header>

          <div v-if="collectionNodes.length" :class="collectionViewMode === 'grid' ? 'spaces-card-grid' : 'spaces-card-list'">
            <button
              v-for="node in collectionNodes"
              :key="node.path"
              type="button"
              class="spaces-collection-card"
              :data-testid="`collection-node-${node.path}`"
              @click="selectNode(node)"
            >
              <span class="spaces-card-icon">
                <VisualIcon
                  v-if="node.icon"
                  :icon="node.icon"
                  :fallback="node.kind === 'bundle' ? 'folderOpen' : node.kind === 'folder' ? 'folder' : 'docs'"
                />
                <Icon v-else :name="node.kind === 'bundle' ? 'folderOpen' : node.kind === 'folder' ? 'folder' : 'docs'" />
              </span>
              <span class="spaces-card-body">
                <span class="spaces-card-title-row">
                  <strong>{{ node.title }}</strong>
                  <span v-if="node.status" class="spaces-card-badge">{{ node.status }}</span>
                  <span v-else-if="node.kind === 'bundle'" class="spaces-card-badge">{{ copy('卡片包', 'Bundle') }}</span>
                </span>
                <small v-if="node.summary">{{ node.summary }}</small>
                <span v-if="node.tags?.length || node.updatedAt" class="spaces-card-meta">
                  <span v-for="tag in (node.tags ?? []).slice(0, 3)" :key="tag">#{{ tag }}</span>
                  <time v-if="node.updatedAt">{{ new Date(node.updatedAt).toLocaleDateString(locale) }}</time>
                </span>
              </span>
            </button>
          </div>
          <div v-else class="spaces-collection-empty">
            <Icon name="docs" />
            <p>{{ copy('点击左上角“今日笔记”或“新建页面”开始创作。', 'Click Daily Note or New page to start writing.') }}</p>
          </div>
        </section>
      </template>
    </main>

    <DialogShell v-model:open="addSpaceDialogOpen" layout="panel">
      <template #title>{{ copy('添加本地文档目录', 'Add local document folder') }}</template>
      <template #description>{{ copy('选择一个已有的 Markdown 文件夹；Craft Hub 只读取与编辑你选定的目录，不会移动原有文件。', 'Choose an existing folder containing Markdown notes or docs. Files stay in place on disk.') }}</template>
      <form id="add-local-space-form" class="spaces-dialog-form" data-testid="add-local-space-form" @submit.prevent="submitAddLocalSpace">
        <label class="spaces-dialog-field">
          <span>{{ copy('目录路径', 'Folder path') }}</span>
          <div class="spaces-path-input-row">
            <Input v-model="addSpacePath" name="space-path" placeholder="/Users/you/Documents/Notes" required />
            <UiButton v-if="canChooseLocalDirectory" type="button" size="compact" variant="secondary" @click="chooseLocalFolder">
              {{ copy('选择目录…', 'Browse…') }}
            </UiButton>
          </div>
        </label>
        <label class="spaces-dialog-field">
          <span>{{ copy('显示名称（可选）', 'Title (optional)') }}</span>
          <Input v-model="addSpaceTitle" name="space-title" :placeholder="copy('默认使用文件夹名', 'Defaults to folder name')" />
        </label>
        <p v-if="addSpaceError" class="spaces-tree-error">{{ addSpaceError }}</p>
      </form>
      <template #footer>
        <UiButton variant="secondary" @click="addSpaceDialogOpen = false">{{ copy('取消', 'Cancel') }}</UiButton>
        <UiButton type="submit" form="add-local-space-form" variant="primary" :disabled="addSpaceSubmitting">
          {{ addSpaceSubmitting ? copy('添加中…', 'Adding…') : copy('添加空间', 'Add space') }}
        </UiButton>
      </template>
    </DialogShell>

    <DialogShell v-model:open="createDialogOpen" layout="panel">
      <template #title>
        {{ createKind === 'bundle' ? copy('新建卡片包', 'New folder bundle') : createKind === 'subpage-card' ? copy('新建并嵌入子页面卡片', 'New subpage card') : copy('新建 Markdown 页面', 'New Markdown page') }}
      </template>
      <form id="create-document-form" class="spaces-dialog-form" data-testid="create-document-form" @submit.prevent="submitCreateDocument">
        <label class="spaces-dialog-field">
          <span>{{ copy('标题', 'Title') }}</span>
          <Input v-model="createTitle" name="document-title" :placeholder="copy('例如：产品发布灵感与分镜', 'e.g. Release notes & draft')" required />
        </label>
        <p v-if="createError" class="spaces-tree-error">{{ createError }}</p>
      </form>
      <template #footer>
        <UiButton variant="secondary" @click="createDialogOpen = false">{{ copy('取消', 'Cancel') }}</UiButton>
        <UiButton type="submit" form="create-document-form" variant="primary" :disabled="createSubmitting">
          {{ createSubmitting ? copy('创建中…', 'Creating…') : copy('创建', 'Create') }}
        </UiButton>
      </template>
    </DialogShell>
  </section>
</template>

<style scoped>
.document-spaces-workbench {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--workbench-canvas);
}
.document-spaces-workbench.embedded {
  min-height: 560px;
  border: 1px solid var(--border);
  border-radius: var(--panel-radius);
}
.spaces-sidebar {
  display: flex;
  flex: 0 0 264px;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--workbench-sidebar-border);
  background: var(--workbench-sidebar-background);
}
.spaces-sidebar-header {
  display: grid;
  gap: var(--space-2);
  border-bottom: 1px solid var(--workbench-sidebar-border);
  padding: var(--space-3);
}
.spaces-selector-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.spaces-selector {
  min-width: 0;
  height: 32px;
  flex: 1;
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  background: var(--surface);
  color: var(--text);
  font-size: var(--font-size-body);
  font-weight: 600;
}
.spaces-sidebar-title {
  flex: 1;
  font-size: var(--font-size-body);
}
.spaces-quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.spaces-search-box {
  display: flex;
  height: 30px;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  background: var(--surface);
  padding: 0 8px;
  color: var(--muted);
}
.spaces-search-box > .app-icon {
  width: 14px;
  height: 14px;
}
.spaces-search-box input {
  width: 0;
  min-width: 0;
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: var(--font-size-caption);
}
.spaces-search-box button {
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  background: transparent;
  color: var(--muted);
}
.spaces-tree-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  padding: var(--space-2);
}
.spaces-tree-scroll :deep(.space-tree-list) {
  list-style: none;
  margin: 0;
  padding: 0;
}
.spaces-tree-scroll :deep(.space-tree-list .space-tree-list) {
  padding-left: 14px;
}
.spaces-tree-scroll :deep(.space-tree-row) {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: var(--control-radius);
  min-height: 30px;
}
.spaces-tree-scroll :deep(.space-tree-row:hover) {
  background: var(--surface-hover);
}
.spaces-tree-scroll :deep(.space-tree-row.selected) {
  background: var(--workbench-sidebar-active-background);
  color: var(--workbench-sidebar-active-color);
  font-weight: var(--workbench-sidebar-active-weight);
}
.spaces-tree-scroll :deep(.space-tree-disclosure),
.spaces-tree-scroll :deep(.space-tree-spacer) {
  display: grid;
  width: 20px;
  height: 24px;
  flex: none;
  place-items: center;
  background: transparent;
  color: var(--muted);
}
.spaces-tree-scroll :deep(.space-tree-disclosure .app-icon) {
  width: 14px;
  height: 14px;
}
.spaces-tree-scroll :deep(.space-tree-button) {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 6px;
  border-radius: var(--control-radius);
  background: transparent;
  padding: 4px 6px 4px 2px;
  color: inherit;
  text-align: left;
  font-size: var(--workbench-sidebar-font-size);
}
.spaces-tree-scroll :deep(.space-tree-button .app-icon) {
  width: 15px;
  height: 15px;
  flex: none;
  color: var(--muted);
}
.spaces-tree-scroll :deep(.space-tree-label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.spaces-tree-scroll :deep(.space-tree-count) {
  border-radius: var(--radius-pill);
  background: var(--surface-hover);
  padding: 0 6px;
  color: var(--muted);
  font-size: var(--font-size-caption);
}
.spaces-tree-empty,
.spaces-tree-error {
  margin: var(--space-3) var(--space-2);
  font-size: var(--font-size-caption);
}
.spaces-tree-empty {
  color: var(--muted);
}
.spaces-tree-error {
  color: var(--danger);
}
.spaces-main {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--surface);
}
.spaces-toast {
  position: absolute;
  top: var(--space-3);
  right: var(--space-4);
  z-index: 20;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface);
  padding: 4px 12px;
  color: var(--success);
  font-size: var(--font-size-caption);
  font-weight: 500;
  box-shadow: var(--menu-shadow);
}
.spaces-breadcrumbs {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  background: var(--workbench-chrome);
  padding: 6px var(--space-4);
}
.spaces-breadcrumb-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 6px;
  background: transparent;
  padding: 2px 6px;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
}
.spaces-breadcrumb-item:hover:not(.current) {
  background: var(--surface-hover);
  color: var(--text);
}
.spaces-breadcrumb-item.current {
  color: var(--text);
  font-weight: 600;
}
.spaces-breadcrumb-item :deep(.app-icon),
.spaces-breadcrumb-sep {
  width: 14px;
  height: 14px;
  color: var(--muted);
}
.spaces-exit-focus {
  margin-left: auto;
}
.spaces-empty-onboarding {
  display: grid;
  flex: 1;
  place-items: center;
  padding: var(--space-6);
}
.spaces-empty-card {
  display: grid;
  justify-items: center;
  max-width: 500px;
  gap: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--panel-radius);
  background: var(--surface-subtle);
  padding: var(--space-6);
  text-align: center;
}
.spaces-empty-icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--accent);
}
.spaces-empty-card h1 {
  margin: 0;
  font-size: var(--font-size-heading-md);
}
.spaces-empty-card p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.55;
}
.spaces-hosted-hint {
  color: var(--muted);
  font-size: var(--font-size-caption);
}
.spaces-loading-panel {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  color: var(--muted);
}
.spaces-document-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.spaces-subpage-strip {
  flex: none;
  border-top: 1px solid var(--border);
  background: var(--surface-subtle);
  padding: var(--space-3) var(--space-4);
}
.spaces-subpage-strip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}
.spaces-subpage-strip-header h2 {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  font-weight: 600;
}
.spaces-collection-view {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: var(--space-5) var(--page-padding-inline);
}
.spaces-collection-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.spaces-collection-header h1 {
  margin: 0;
  font-size: var(--page-title-size);
}
.spaces-collection-header p,
.spaces-collection-header code {
  display: block;
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
}
.spaces-collection-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.spaces-view-toggle {
  display: inline-flex;
  gap: 2px;
  border: 1px solid var(--navigation-track-border);
  border-radius: var(--control-radius);
  background: var(--navigation-track-background);
  padding: 2px;
}
.spaces-view-toggle button {
  min-height: 24px;
  border-radius: var(--navigation-segmented-item-radius);
  background: transparent;
  padding: 2px 10px;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
}
.spaces-view-toggle button.active {
  background: var(--navigation-selection-background);
  color: var(--text);
  box-shadow: var(--navigation-selection-shadow);
}
.spaces-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--space-3);
}
.spaces-card-grid.compact {
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
}
.spaces-card-list {
  display: grid;
  gap: var(--space-2);
}
.spaces-collection-card {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--panel-radius);
  background: var(--surface);
  padding: var(--space-3) var(--space-4);
  color: var(--text);
  text-align: left;
  transition: border-color var(--motion-duration-fast) ease, background-color var(--motion-duration-fast) ease;
}
.spaces-collection-card:hover {
  border-color: var(--border-strong);
  background: var(--surface-subtle);
}
.spaces-card-icon {
  display: grid;
  width: 32px;
  height: 32px;
  flex: none;
  place-items: center;
  border-radius: var(--control-radius);
  background: var(--accent-soft);
  color: var(--accent);
}
.spaces-card-body {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 4px;
}
.spaces-card-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.spaces-card-title-row strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-body);
  font-weight: 600;
}
.spaces-card-badge {
  border-radius: var(--radius-pill);
  background: var(--surface-muted);
  padding: 1px 7px;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
}
.spaces-card-body small {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
  line-height: 1.45;
}
.spaces-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--muted);
  font-size: var(--font-size-caption);
}
.spaces-collection-empty {
  display: grid;
  justify-items: center;
  gap: var(--space-2);
  padding: var(--space-6);
  color: var(--muted);
  text-align: center;
}
.spaces-dialog-form {
  display: grid;
  gap: var(--space-3);
}
.spaces-dialog-field {
  display: grid;
  gap: var(--space-1);
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}
.spaces-path-input-row {
  display: flex;
  gap: var(--space-2);
}
.spaces-path-input-row :deep(input) {
  flex: 1;
}
@media (max-width: 900px) {
  .document-spaces-workbench {
    flex-direction: column;
  }
  .spaces-sidebar {
    flex: none;
    max-height: 240px;
    border-right: 0;
    border-bottom: 1px solid var(--workbench-sidebar-border);
  }
}
</style>

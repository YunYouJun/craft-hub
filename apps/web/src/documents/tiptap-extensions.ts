import type { Extensions } from '@tiptap/core'
import type { ImageOptions } from '@tiptap/extension-image'
import type { NodeViewProps } from '@tiptap/vue-3'
import type { DocumentCard } from 'craft-hub'
import type { Component } from 'vue'
import type { CalloutVariant } from './markdown-codec'
import { mergeAttributes, Node } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import Typography from '@tiptap/extension-typography'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import PageCardView from './PageCardView.vue'
import ToggleBlockView from './ToggleBlockView.vue'

export interface PageCardExtensionOptions {
  currentDocPath: () => string
  getCards: () => DocumentCard[]
  openCard: (targetPath: string) => void
}

/** Resolve a space-relative path from an active document path using POSIX rules (browser-safe). */
export function resolveDocumentRelativePath(docPath: string, ref: string): string {
  const cleaned = ref.replaceAll('\\', '/').trim()
  if (!cleaned)
    return ''
  if (/^(?:https?:|data:|blob:|\/)/i.test(cleaned))
    return cleaned
  const slashIndex = docPath.lastIndexOf('/')
  const baseDir = slashIndex > 0 ? docPath.slice(0, slashIndex) : ''
  const combined = baseDir ? `${baseDir}/${cleaned}` : cleaned
  const parts: string[] = []
  for (const segment of combined.split('/')) {
    if (!segment || segment === '.')
      continue
    if (segment === '..')
      parts.pop()
    else
      parts.push(segment)
  }
  return parts.join('/')
}

/** Rewrite document-relative image URLs to the sandboxed Document Space asset endpoint. */
export function resolveSpaceAssetUrl(spaceId: string, docPath: string, src: string): string {
  const trimmed = src.trim()
  if (!trimmed || /^(?:https?:|blob:)/i.test(trimmed) || trimmed.startsWith('/api/document-spaces/'))
    return trimmed
  const resolvedPath = resolveDocumentRelativePath(docPath, trimmed)
  if (!resolvedPath || resolvedPath.startsWith('/'))
    return trimmed
  return `/api/document-spaces/${encodeURIComponent(spaceId)}/asset?path=${encodeURIComponent(resolvedPath)}`
}

export const CalloutNode = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'note' satisfies CalloutVariant,
        parseHTML: element => element.getAttribute('data-variant') ?? 'note',
        renderHTML: attributes => ({ 'data-variant': attributes.variant }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'aside.craft-callout' }]
  },

  renderHTML({ HTMLAttributes }) {
    const variant = typeof HTMLAttributes['data-variant'] === 'string' ? HTMLAttributes['data-variant'] : 'note'
    return [
      'aside',
      mergeAttributes(HTMLAttributes, { 'class': 'craft-callout', 'data-variant': variant }),
      0,
    ]
  },
})

export const ToggleBlockNode = Node.create({
  name: 'toggleBlock',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      summary: { default: 'Toggle' },
      open: { default: true },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle-block"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle-block' }), 0]
  },

  addNodeView() {
    return VueNodeViewRenderer(ToggleBlockView as unknown as Component<NodeViewProps>)
  },
})

export const PageCardNode = Node.create<PageCardExtensionOptions>({
  name: 'pageCard',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      currentDocPath: () => '',
      getCards: () => [],
      openCard: () => {},
    }
  },

  addAttributes() {
    return {
      target: { default: '' },
      label: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="page-card"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'page-card' })]
  },

  addNodeView() {
    return VueNodeViewRenderer(PageCardView as unknown as Component<NodeViewProps>)
  },
})

export interface SpaceAwareImageOptions extends ImageOptions {
  resolveAssetUrl?: (src: string) => string
}

export const SpaceAwareImage = Image.extend<SpaceAwareImageOptions>({
  addOptions() {
    const parentOptions = this.parent?.()
    return {
      inline: parentOptions?.inline ?? false,
      allowBase64: parentOptions?.allowBase64 ?? false,
      HTMLAttributes: parentOptions?.HTMLAttributes ?? {},
      resize: parentOptions?.resize ?? false,
      resolveAssetUrl: undefined,
    }
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      'data-markdown-src': {
        default: null,
        rendered: false,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: this.options.allowBase64 ? 'img[src]' : 'img[src]:not([src^="data:"])',
        getAttrs: (element) => {
          if (typeof element === 'string')
            return false
          const rawSrc = element.getAttribute('data-markdown-src') || element.getAttribute('src')
          if (!rawSrc)
            return false
          return {
            src: rawSrc,
            alt: element.getAttribute('alt'),
            title: element.getAttribute('title'),
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const rawSrc = typeof HTMLAttributes.src === 'string' ? HTMLAttributes.src : ''
    const resolvedSrc = this.options.resolveAssetUrl ? this.options.resolveAssetUrl(rawSrc) : rawSrc
    return [
      'img',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'src': resolvedSrc,
        'data-markdown-src': rawSrc,
        'loading': 'lazy',
      }),
    ]
  },
})

export interface DocumentEditorExtensionsOptions {
  placeholder: string
  currentDocPath: () => string
  getCards: () => DocumentCard[]
  openCard: (targetPath: string) => void
  resolveAssetUrl: (src: string) => string
}

/** Build the Tiptap extension stack for Craft-style local-first Markdown editing. */
export function createDocumentEditorExtensions(options: DocumentEditorExtensionsOptions): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow' },
      },
    }),
    Placeholder.configure({
      placeholder: options.placeholder,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    SpaceAwareImage.configure({
      inline: false,
      allowBase64: false,
      resolveAssetUrl: options.resolveAssetUrl,
    }),
    Typography,
    CalloutNode,
    ToggleBlockNode,
    PageCardNode.configure({
      currentDocPath: options.currentDocPath,
      getCards: options.getCards,
      openCard: options.openCard,
    }),
  ]
}

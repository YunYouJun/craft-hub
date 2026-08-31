<script setup lang="ts">
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { computed } from 'vue'

const props = defineProps<{ content: string, projectId: string, readmePath: string }>()

function projectRelativePath(target: string): string | undefined {
  const cleanTarget = target.split(/[?#]/, 1)[0] ?? ''
  const parts = [...props.readmePath.split('/').slice(0, -1), ...cleanTarget.split('/')]
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.')
      continue
    if (part === '..') {
      if (!normalized.length)
        return undefined
      normalized.pop()
      continue
    }
    normalized.push(part)
  }
  return normalized.join('/')
}

function safeExternalUrl(value: string): boolean {
  return /^(?:https?:|mailto:)/i.test(value)
}

function hasUrlScheme(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(value)
}

const html = computed(() => {
  const document = new DOMParser().parseFromString(String(marked.parse(props.content, { async: false, gfm: true })), 'text/html')
  for (const element of document.querySelectorAll<HTMLElement>('script, iframe, object, embed, style, svg, math'))
    element.remove()
  for (const image of document.querySelectorAll<HTMLImageElement>('img')) {
    const source = image.getAttribute('src') ?? ''
    if (/^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i.test(source) || /^https:\/\//i.test(source))
      continue
    const path = hasUrlScheme(source) ? undefined : projectRelativePath(source)
    if (!path) {
      image.removeAttribute('src')
      continue
    }
    image.src = `/api/projects/${encodeURIComponent(props.projectId)}/overview-asset?path=${encodeURIComponent(path)}`
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a')) {
    const href = link.getAttribute('href') ?? ''
    if (href.startsWith('#'))
      continue
    if (safeExternalUrl(href)) {
      if (/^https?:/i.test(href)) {
        link.target = '_blank'
        link.rel = 'noreferrer noopener'
      }
      continue
    }
    const path = hasUrlScheme(href) ? undefined : projectRelativePath(href)
    link.href = '#'
    if (path)
      link.dataset.localPath = path
    else
      link.setAttribute('aria-disabled', 'true')
  }
  return DOMPurify.sanitize(document.body.innerHTML, {
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['embed', 'iframe', 'math', 'object', 'script', 'style', 'svg'],
    USE_PROFILES: { html: true },
  })
})

async function handleClick(event: MouseEvent): Promise<void> {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-local-path]')
  if (!link)
    return
  event.preventDefault()
  if (window.craftHubDesktop?.openProjectEvidenceInEditor)
    await window.craftHubDesktop.openProjectEvidenceInEditor(props.projectId, link.dataset.localPath!)
}
</script>

<template>
  <!-- The HTML is parsed, URL-rewritten, and sanitized immediately above before rendering. -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <article class="markdown-preview" @click="handleClick" v-html="html" />
</template>

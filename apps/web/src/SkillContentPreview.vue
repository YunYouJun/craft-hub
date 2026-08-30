<script setup lang="ts">
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import markdown from 'shiki/langs/markdown.mjs'
import githubDark from 'shiki/themes/github-dark.mjs'
import githubLight from 'shiki/themes/github-light.mjs'
import { ref, watch } from 'vue'

const props = defineProps<{ content: string }>()
const highlighted = ref('')
const error = ref(false)
let renderSequence = 0

const highlighter = createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  langs: [markdown],
  themes: [githubLight, githubDark],
})

watch(() => props.content, async (content) => {
  const sequence = ++renderSequence
  error.value = false
  try {
    const instance = await highlighter
    const html = instance.codeToHtml(content, {
      lang: 'markdown',
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    })
    if (sequence === renderSequence)
      highlighted.value = html
  }
  catch {
    if (sequence === renderSequence) {
      highlighted.value = ''
      error.value = true
    }
  }
}, { immediate: true })
</script>

<template>
  <div class="skill-content" data-testid="skill-content-preview">
    <div v-if="highlighted" class="skill-highlighted" v-html="highlighted" />
    <pre v-else :class="{ 'highlight-error': error }">{{ content }}</pre>
  </div>
</template>

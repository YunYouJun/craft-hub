import { expect, it } from 'vitest'
import { bundledLanguages, codeToHtml, hasPreviewGrammar } from './shiki-curated'

it('covers the language ids file previews derive from file names', () => {
  for (const lang of ['typescript', 'tsx', 'vue', 'json', 'yml', 'yaml', 'zsh', 'bash', 'toml', 'dockerfile', 'markdown', 'rust', 'go', 'swift', 'text', 'ansi'])
    expect(hasPreviewGrammar(lang), lang).toBe(true)
  for (const lang of ['haskell', 'cobol', 'emacs-lisp', 'constructor', '__proto__'])
    expect(hasPreviewGrammar(lang), lang).toBe(false)
})

it('loads a grammar for every curated language', async () => {
  for (const [lang, load] of Object.entries(bundledLanguages)) {
    const { default: grammars } = await load()
    expect(grammars.length, lang).toBeGreaterThan(0)
  }
})

it('highlights through the same API as the full shiki entry', async () => {
  const html = await codeToHtml('const answer: number = 42', { lang: 'typescript', theme: 'github-dark' })
  expect(html).toContain('<span style="color:')
  expect(html).toContain('answer')
})

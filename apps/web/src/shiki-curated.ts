import type { DynamicImportLanguageRegistration } from 'shiki/core'
import { createBundledHighlighter, createSingletonShorthands, guessEmbeddedLanguages } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { bundledThemes } from 'shiki/themes'

/**
 * The `shiki` entry for file previews, with the languages a developer workbench shows instead of all 240. The full
 * bundle ships a lazily loaded chunk per grammar; this keeps the same API for `@pierre/diffs` while dropping about
 * 10 MB of grammars from the web assets. A file in another language falls back to plain text in `FilePreview`.
 *
 * Keys include the alias ids `@pierre/diffs` derives from file names, such as `yml` and `zsh`.
 */
const shellscript: DynamicImportLanguageRegistration = () => import('shiki/langs/shellscript.mjs')
const yaml: DynamicImportLanguageRegistration = () => import('shiki/langs/yaml.mjs')
export const bundledLanguages: Record<string, DynamicImportLanguageRegistration> = {
  astro: () => import('shiki/langs/astro.mjs'),
  bash: shellscript,
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  dart: () => import('shiki/langs/dart.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  dotenv: () => import('shiki/langs/dotenv.mjs'),
  fish: () => import('shiki/langs/fish.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  json5: () => import('shiki/langs/json5.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  less: () => import('shiki/langs/less.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  makefile: () => import('shiki/langs/makefile.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  mdx: () => import('shiki/langs/mdx.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  prisma: () => import('shiki/langs/prisma.mjs'),
  protobuf: () => import('shiki/langs/protobuf.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  sh: shellscript,
  shell: shellscript,
  shellscript,
  sql: () => import('shiki/langs/sql.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  terraform: () => import('shiki/langs/terraform.mjs'),
  tf: () => import('shiki/langs/terraform.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml,
  yml: yaml,
  zsh: shellscript,
}

/** Whether a preview language has a grammar here; `text` and `ansi` need none. */
export function hasPreviewGrammar(lang: string): boolean {
  return lang === 'text' || lang === 'ansi' || Object.hasOwn(bundledLanguages, lang)
}

export * from 'shiki/core'
export { bundledThemes, createJavaScriptRegexEngine, createOnigurumaEngine }

/** Mirrors `shiki/bundle/full` with the curated languages. */
export const createHighlighter = /* @__PURE__ */ createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => createOnigurumaEngine(import('shiki/wasm')),
})

export const { codeToHtml, codeToHast, codeToTokens, codeToTokensBase, codeToTokensWithThemes, getSingletonHighlighter, getLastGrammarState } = /* @__PURE__ */ createSingletonShorthands(createHighlighter, { guessEmbeddedLanguages })

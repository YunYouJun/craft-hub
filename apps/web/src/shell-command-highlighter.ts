import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import bash from 'shiki/langs/bash.mjs'
import githubDark from 'shiki/themes/github-dark.mjs'
import githubLight from 'shiki/themes/github-light.mjs'

const highlighter = createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  langs: [bash],
  themes: [githubLight, githubDark],
})

/** Render one shell command with theme-aware, escaped Bash syntax highlighting. */
export async function highlightShellCommand(command: string): Promise<string> {
  const instance = await highlighter
  return instance.codeToHtml(command, {
    lang: 'bash',
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  })
}

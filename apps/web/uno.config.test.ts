import { createGenerator } from 'unocss'
import { describe, expect, it } from 'vitest'
import { iconClasses } from './src/icons'
import unoConfig from './uno.config'

describe('unoCSS icon generation', () => {
  it('includes every icon class', () => {
    expect(unoConfig.safelist).toEqual(expect.arrayContaining(Object.values(iconClasses)))
  })

  it('compiles brand assets locally and lets monochrome marks follow text color', async () => {
    const generator = await createGenerator(unoConfig)
    const classes = ['git', 'nodejs', 'pnpm', 'homebrew', 'claude', 'gemini', 'chatgpt', 'perplexity', 'raycast'].map(name => iconClasses[name as keyof typeof iconClasses])
    const { css, matched } = await generator.generate(classes.join(' '), { preflights: false })

    expect(classes.every(icon => matched.has(icon))).toBe(true)
    expect(css).toContain('data:image/svg+xml')
    expect(css).toContain('background-size:contain')
    expect(css).not.toContain('https://')
    for (const icon of ['i-simple-icons-openai', 'i-simple-icons-perplexity', 'i-simple-icons-raycast'])
      expect(css).toMatch(new RegExp(`\\.${icon}\\{[^}]*background-color:currentColor`))
  })
})

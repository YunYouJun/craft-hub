import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(import.meta.dirname, '..')
const tokensCss = readFileSync(resolve(packageRoot, 'styles/docs-tokens.css'), 'utf8')
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))

function extractBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))
  return match?.[1] ?? ''
}

function readTokenValue(block: string, token: string): string | undefined {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = block.match(new RegExp(`${escaped}\\s*:\\s*([^;]+);`))
  return match?.[1]?.trim()
}

describe('docs-tokens.css', () => {
  it('exports ./docs-tokens.css and includes styles in published files', () => {
    expect(packageJson.exports['./docs-tokens.css']).toBe('./styles/docs-tokens.css')
    expect(packageJson.files).toContain('styles')
    expect(packageJson.sideEffects).toContain('*.css')
  })

  it('avoids missing-hyphen VitePress text token typos', () => {
    expect(tokensCss).not.toMatch(/(^|[^-])-vp-c-text-/m)
  })

  it('defines required semantic tokens in both :root and .dark', () => {
    const requiredTokens = [
      '--ch-brand',
      '--ch-brand-fill',
      '--ch-on-brand',
      '--ch-bg',
      '--ch-surface',
      '--ch-text',
      '--ch-border',
    ]

    const lightBlock = extractBlock(tokensCss, ':root')
    const darkBlock = extractBlock(tokensCss, '.dark')

    expect(lightBlock).not.toBe('')
    expect(darkBlock).not.toBe('')

    for (const token of requiredTokens) {
      expect(readTokenValue(lightBlock, token)).toBeTruthy()
      expect(readTokenValue(darkBlock, token)).toBeTruthy()
    }

    // Dark mode keeps bright text accents separate from high-contrast solid button fills.
    expect(readTokenValue(darkBlock, '--ch-brand-fill')).not.toBe(
      readTokenValue(darkBlock, '--ch-brand'),
    )
  })
})

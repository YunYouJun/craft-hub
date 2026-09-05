import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

describe('primary navigation motion', () => {
  it('does not fade or slide the marketplace into view', () => {
    expect(styles).not.toMatch(/\.marketplace-page\s*\{[^}]*\banimation\s*:/)
    expect(styles).not.toContain('@keyframes marketplace-view-in')
  })
})

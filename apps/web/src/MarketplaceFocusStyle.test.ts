import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

describe('marketplace plugin focus style', () => {
  it('keeps keyboard focus visible without outlining the whole summary row', () => {
    expect(styles).not.toMatch(/\.plugin-summary-link:focus-visible\s*\{[^}]*box-shadow/)
    expect(styles).toMatch(/\.plugin-summary-link:focus-visible \.plugin-mark\s*\{[^}]*outline:/)
  })
})

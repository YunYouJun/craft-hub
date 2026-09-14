import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

describe('workbench titlebar layout', () => {
  it('left-aligns the project picker below the macOS window controls', () => {
    expect(styles).not.toMatch(/\.workbench-titlebar\.desktop-mac\s*\{[^}]*padding-left:\s*84px/)
  })
})

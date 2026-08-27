import { describe, expect, it } from 'vitest'
import { iconClasses } from './src/icons'
import unoConfig from './uno.config'

describe('unoCSS icon generation', () => {
  it('includes every icon class', () => {
    expect(unoConfig.safelist).toEqual(expect.arrayContaining(Object.values(iconClasses)))
  })
})

import { describe, expect, it } from 'vitest'
import { formatDisplayPath } from './display-path'

describe('formatDisplayPath', () => {
  it('abbreviates macOS and Linux home directories while keeping subpaths and line suffixes', () => {
    expect(formatDisplayPath('/Users/alice/Projects/craft-hub')).toBe('~/Projects/craft-hub')
    expect(formatDisplayPath('/Users/alice/Projects/craft-hub/package.json:12')).toBe('~/Projects/craft-hub/package.json:12')
    expect(formatDisplayPath('/home/alice/repos/widget')).toBe('~/repos/widget')
    expect(formatDisplayPath('/Users/alice')).toBe('~')
  })

  it('abbreviates Windows user directories cleanly', () => {
    expect(formatDisplayPath('C:\\Users\\alice\\Projects\\craft-hub')).toBe('~\\Projects\\craft-hub')
    expect(formatDisplayPath('D:\\Users\\alice')).toBe('~')
  })

  it('preserves non-home paths and empty values', () => {
    expect(formatDisplayPath('/workspace/example')).toBe('/workspace/example')
    expect(formatDisplayPath('/repos/project-a')).toBe('/repos/project-a')
    expect(formatDisplayPath('')).toBe('')
    expect(formatDisplayPath(undefined)).toBe('')
  })
})

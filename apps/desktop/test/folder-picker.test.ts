import { describe, expect, it } from 'vitest'
import { selectedDirectoryPath, selectedDirectoryPaths } from '../src/folder-picker'

describe('folder picker', () => {
  it('returns the selected directory', () => {
    expect(selectedDirectoryPath({ canceled: false, filePaths: ['/tmp/project'] })).toBe('/tmp/project')
  })

  it('returns undefined when selection is cancelled', () => {
    expect(selectedDirectoryPath({ canceled: true, filePaths: ['/tmp/ignored'] })).toBeUndefined()
  })

  it('returns every unique directory selected for a workspace', () => {
    expect(selectedDirectoryPaths({
      canceled: false,
      filePaths: ['/tmp/first', '/tmp/second', '/tmp/first'],
    })).toEqual(['/tmp/first', '/tmp/second'])
  })

  it('returns undefined when a multi-directory selection is cancelled', () => {
    expect(selectedDirectoryPaths({ canceled: true, filePaths: ['/tmp/ignored'] })).toBeUndefined()
  })
})

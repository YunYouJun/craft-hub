import { describe, expect, it } from 'vitest'
import { bundledSoftwareCatalog } from '../src/bundled-software-catalog'

describe('bundled software platform metadata', () => {
  it('includes Thaw once as an optional macOS menu bar manager', () => {
    const entries = bundledSoftwareCatalog.items.filter(item => item.id === 'thaw')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      title: { en: 'Thaw' },
      platforms: ['macos'],
      group: { id: 'developer-utilities' },
      url: 'https://www.getthaw.app/',
      downloadUrl: 'https://github.com/thaw-app/Thaw/releases',
      repositoryUrl: 'https://github.com/thaw-app/Thaw',
      installation: { kind: 'brew-cask', packageId: 'thaw' },
    })
    expect(entries[0]?.description).toContain('Thaw Bar')
  })

  it('keeps verified cross-platform support and leaves unknown metadata absent', () => {
    const find = (id: string) => bundledSoftwareCatalog.items.find(item => item.id === id)
    expect(find('vscode')?.platforms).toEqual(['macos', 'windows', 'linux'])
    expect(find('ghostty')?.platforms).toEqual(['macos', 'linux'])
    expect(find('cyberduck')?.platforms).toEqual(['macos', 'windows'])
    expect(bundledSoftwareCatalog.items.some(item => item.platforms === undefined)).toBe(true)
  })
})

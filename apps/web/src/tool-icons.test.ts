import { describe, expect, it } from 'vitest'
import { environmentToolIcon, softwareArtwork, toolArtwork, websiteToolIcon } from './tool-icons'

describe('workbench tool icons', () => {
  it('upgrades copied catalog artwork without changing a user override', () => {
    const catalog = { iconUrl: 'https://example.com/site.png', macosIconUrl: 'https://example.com/mac.png', iconStyle: 'rounded' as const, iconScale: 1.25 }
    expect(softwareArtwork({}, catalog)).toEqual(catalog)
    expect(softwareArtwork({ iconUrl: catalog.iconUrl }, catalog)).toEqual(catalog)
    expect(softwareArtwork({ iconUrl: 'https://example.com/custom.svg' }, catalog)).toEqual({ iconUrl: 'https://example.com/custom.svg' })
    expect(softwareArtwork({ iconUrl: catalog.iconUrl, iconStyle: 'original' }, catalog).iconStyle).toBe('original')
    expect(softwareArtwork({ macosIconUrl: 'https://example.com/custom-mac.png' }, catalog).iconScale).toBeUndefined()
    expect(softwareArtwork({ iconUrl: catalog.iconUrl, iconScale: 1.1 }, catalog).iconScale).toBe(1.1)
  })

  it('falls back to the destination favicon only without explicit, catalog, or local brand artwork', () => {
    expect(toolArtwork({ url: 'https://store.example.com/games?tab=new#top' })).toEqual({ iconUrl: 'https://store.example.com/favicon.ico' })
    expect(toolArtwork({ url: 'https://example.com/', iconUrl: 'https://example.com/custom.svg' }).iconUrl).toBe('https://example.com/custom.svg')
    expect(toolArtwork({ url: 'https://example.com/' }, { macosIconUrl: 'https://example.com/mac.png' })).toEqual({ macosIconUrl: 'https://example.com/mac.png' })
    expect(toolArtwork({ url: 'https://claude.ai/new' }).iconUrl).toBeUndefined()
    expect(toolArtwork({ url: 'https://www.onorca.dev/' }).iconUrl).toBeUndefined()
    for (const url of ['http://example.com/', 'https://user:secret@example.com/', 'not a url'])
      expect(toolArtwork({ url }).iconUrl).toBeUndefined()
  })

  it('keeps environment products distinct and uses semantic fallbacks without a verified brand', () => {
    expect(environmentToolIcon('git')).toBe('git')
    expect(environmentToolIcon('node')).toBe('nodejs')
    expect(environmentToolIcon('pnpm')).toBe('pnpm')
    expect(environmentToolIcon('homebrew')).toBe('homebrew')
    expect(environmentToolIcon('fnm')).toBe('terminal')
    expect(environmentToolIcon('workstation')).toBe('workspace')
  })

  it.each([
    ['https://chatgpt.com/', 'chatgpt'],
    ['https://chat.openai.com/', 'chatgpt'],
    ['https://claude.ai/new', 'claude'],
    ['https://gemini.google.com/app', 'gemini'],
    ['https://www.perplexity.ai/', 'perplexity'],
    ['https://www.raycast.com/', 'raycast'],
    ['https://code.visualstudio.com/download', 'vscode'],
    ['https://www.onorca.dev/', 'terminalApp'],
    ['https://store.steampowered.com/', 'steam'],
    ['https://steamcommunity.com/', 'steam'],
    ['https://itch.io/', 'itchio'],
  ] as const)('recognizes the destination %s independently of an editable title', (url, icon) => {
    expect(websiteToolIcon(url)).toBe(icon)
  })

  it.each([
    'https://docs.example.com/claude.ai',
    'https://claude.ai.example.com/',
    'https://notclaude.ai/',
    'https://creator.itch.io/',
    'https://code.visualstudio.com.example.com/',
    'https://claude.ai@example.com/',
    'https://user:password@claude.ai/',
    'http://claude.ai/',
    'not a url',
  ])('keeps an unknown or ambiguous destination generic: %s', (url) => {
    expect(websiteToolIcon(url)).toBe('web')
  })
})

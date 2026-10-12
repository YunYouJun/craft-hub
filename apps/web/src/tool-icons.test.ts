import { describe, expect, it } from 'vitest'
import { environmentToolIcon, websiteToolIcon } from './tool-icons'

describe('workbench tool icons', () => {
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
  ] as const)('recognizes the destination %s independently of an editable title', (url, icon) => {
    expect(websiteToolIcon(url)).toBe(icon)
  })

  it.each([
    'https://docs.example.com/claude.ai',
    'https://claude.ai.example.com/',
    'https://notclaude.ai/',
    'https://code.visualstudio.com.example.com/',
    'https://claude.ai@example.com/',
    'https://user:password@claude.ai/',
    'http://claude.ai/',
    'not a url',
  ])('keeps an unknown or ambiguous destination generic: %s', (url) => {
    expect(websiteToolIcon(url)).toBe('web')
  })
})

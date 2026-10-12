import type { LocalEnvironmentTool } from 'craft-hub'
import type { IconName } from './icons'

const environmentIcons = {
  git: 'git',
  node: 'nodejs',
  pnpm: 'pnpm',
  fnm: 'terminal',
  homebrew: 'homebrew',
  workstation: 'workspace',
} satisfies Record<LocalEnvironmentTool['id'], IconName>

/** Use verified brands for environment tools and semantic symbols for tools without a logo. */
export function environmentToolIcon(id: LocalEnvironmentTool['id']): IconName {
  return environmentIcons[id]
}

const websiteIcons: Readonly<Record<string, IconName>> = {
  'chatgpt.com': 'chatgpt',
  'chat.openai.com': 'chatgpt',
  'claude.ai': 'claude',
  'gemini.google.com': 'gemini',
  'perplexity.ai': 'perplexity',
  'raycast.com': 'raycast',
  'code.visualstudio.com': 'vscode',
  // Orca has no verified icon in the selected collections; keep a coding-tool symbol.
  'onorca.dev': 'terminalApp',
}

/** Resolve local brand assets by the actual website destination, never by editable titles or IDs. */
export function websiteToolIcon(value: string): IconName {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password)
      return 'web'
    return websiteIcons[url.hostname.replace(/^www\./, '')] ?? 'web'
  }
  catch {
    return 'web'
  }
}

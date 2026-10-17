import type { LocalEnvironmentTool, PersonalWorkbenchTool } from 'craft-hub'
import type { IconName } from './icons'

const environmentIcons = {
  git: 'git',
  node: 'nodejs',
  npm: 'nodejs',
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

/** Display-only artwork; native app images already include their intended shape. */
export type SoftwareArtwork = Pick<PersonalWorkbenchTool, 'iconUrl' | 'macosIconUrl' | 'iconStyle' | 'iconScale'>

/** Enrich existing catalog favorites while retaining user-supplied artwork overrides. */
export function softwareArtwork(tool: SoftwareArtwork, catalog?: SoftwareArtwork): SoftwareArtwork {
  const matchesCatalog = catalog && (!tool.iconUrl || tool.iconUrl === catalog.iconUrl || tool.iconUrl === catalog.macosIconUrl)
  const iconUrl = tool.iconUrl ?? catalog?.iconUrl
  const macosIconUrl = tool.macosIconUrl ?? (matchesCatalog ? catalog.macosIconUrl : undefined)
  return {
    iconUrl,
    macosIconUrl,
    iconStyle: tool.iconStyle ?? (matchesCatalog ? catalog.iconStyle : undefined),
    iconScale: tool.iconScale ?? ((macosIconUrl ?? iconUrl) === (catalog?.macosIconUrl ?? catalog?.iconUrl) ? catalog?.iconScale : undefined),
  }
}

/** Match catalog artwork to a website, including its path, without trusting an editable name. */
export function softwareWebsiteIdentity(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password)
      return ''
    url.hash = ''
    return url.href.replace(/\/$/, '')
  }
  catch { return '' }
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

import type { LocalizedText } from './config'
import { z } from 'zod'
import { localizedText } from './discovery'

const localizedNavigationTextSchema = z.union([
  z.string().min(1),
  z.object({ default: z.string().min(1) }).catchall(z.string().min(1)),
])

const navigationIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/)
const navigationUrlSchema = z.string().min(1).refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  }
  catch {
    return false
  }
}, 'Navigation links must use HTTPS and must not contain credentials')

/** One safe external destination shown in a plugin-provided navigation panel. */
export const navigationLinkContributionSchema = z.strictObject({
  id: navigationIdSchema,
  title: localizedNavigationTextSchema,
  description: localizedNavigationTextSchema.optional(),
  url: navigationUrlSchema,
  icon: z.string().min(1).max(32).optional(),
  keywords: z.array(z.string().min(1).max(64)).max(16).default([]),
})

/** A global, project-independent panel of company or team navigation links. */
export const navigationPanelContributionSchema = z.strictObject({
  id: navigationIdSchema,
  title: localizedNavigationTextSchema,
  description: localizedNavigationTextSchema.optional(),
  icon: z.string().min(1).max(32).optional(),
  links: z.array(navigationLinkContributionSchema).min(1).max(64),
}).superRefine((panel, context) => {
  const linkIds = new Set<string>()
  for (const [index, link] of panel.links.entries()) {
    if (linkIds.has(link.id))
      context.addIssue({ code: 'custom', message: `Navigation link id must be unique within a panel: ${link.id}`, path: ['links', index, 'id'] })
    linkIds.add(link.id)
  }
})

export type NavigationLinkContribution = z.infer<typeof navigationLinkContributionSchema>
export type NavigationPanelContribution = z.infer<typeof navigationPanelContributionSchema>

/** Localized navigation panel returned by the runtime for one active plugin. */
export interface InstalledNavigationPanel {
  id: string
  pluginId: string
  pluginName: string
  pluginVersion: string
  title: string
  description?: string
  icon?: string
  links: Array<{
    id: string
    title: string
    description?: string
    url: string
    icon?: string
    keywords: string[]
  }>
}

/** Resolve declarative panel copy for the workbench locale without changing destinations. */
export function localizeNavigationPanel(
  panel: NavigationPanelContribution,
  locale: string,
): Omit<InstalledNavigationPanel, 'pluginId' | 'pluginName' | 'pluginVersion'> {
  return {
    id: panel.id,
    title: localizedText(panel.title as LocalizedText, locale) ?? panel.id,
    ...(panel.description ? { description: localizedText(panel.description as LocalizedText, locale) } : {}),
    ...(panel.icon ? { icon: panel.icon } : {}),
    links: panel.links.map(link => ({
      id: link.id,
      title: localizedText(link.title as LocalizedText, locale) ?? link.id,
      ...(link.description ? { description: localizedText(link.description as LocalizedText, locale) } : {}),
      url: link.url,
      ...(link.icon ? { icon: link.icon } : {}),
      keywords: [...link.keywords],
    })),
  }
}

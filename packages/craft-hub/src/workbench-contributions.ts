import type { LocalizedText } from './config'
import { z } from 'zod'
import { localizedText } from './discovery'

const localizedWorkbenchTextSchema = z.union([
  z.string().min(1),
  z.object({ default: z.string().min(1) }).catchall(z.string().min(1)),
])
const workbenchIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/)
const pluginPackageSchema = z.string().regex(/^@[a-z0-9][a-z0-9._-]*\/(?:craft-hub-plugin-[a-z0-9][a-z0-9._-]*|plugin-[a-z0-9][a-z0-9._-]*)$/)

/** One existing plugin view composed into a contributed workbench. */
export const workbenchViewReferenceSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('integration'),
    plugin: pluginPackageSchema,
    integration: workbenchIdSchema,
    view: workbenchIdSchema,
  }),
  z.strictObject({
    type: z.literal('navigation'),
    plugin: pluginPackageSchema,
    panel: workbenchIdSchema,
  }),
])

/** A product-level workbench that composes existing plugin views without owning their behavior. */
export const workbenchContributionSchema = z.strictObject({
  id: workbenchIdSchema,
  title: localizedWorkbenchTextSchema,
  description: localizedWorkbenchTextSchema.optional(),
  icon: z.string().min(1).max(32).optional(),
  order: z.number().int().optional(),
  views: z.array(workbenchViewReferenceSchema).min(1).max(24),
}).superRefine((workbench, context) => {
  const references = new Set<string>()
  for (const [index, view] of workbench.views.entries()) {
    const key = view.type === 'integration'
      ? `integration:${view.plugin}:${view.integration}:${view.view}`
      : `navigation:${view.plugin}:${view.panel}`
    if (references.has(key))
      context.addIssue({ code: 'custom', message: `Workbench view reference must be unique: ${key}`, path: ['views', index] })
    references.add(key)
  }
})

export type WorkbenchViewReference = z.infer<typeof workbenchViewReferenceSchema>
export type WorkbenchContribution = z.infer<typeof workbenchContributionSchema>

/** Localized contributed workbench returned for one active plugin. */
export interface InstalledPluginWorkbench {
  id: string
  pluginId: string
  pluginName: string
  pluginVersion: string
  title: string
  description?: string
  icon?: string
  order?: number
  views: WorkbenchViewReference[]
}

/** Resolve workbench copy for the requested locale while preserving inert view references. */
export function localizeWorkbench(
  workbench: WorkbenchContribution,
  locale: string,
): Omit<InstalledPluginWorkbench, 'pluginId' | 'pluginName' | 'pluginVersion'> {
  return {
    id: workbench.id,
    title: localizedText(workbench.title as LocalizedText, locale) ?? workbench.id,
    ...(workbench.description ? { description: localizedText(workbench.description as LocalizedText, locale) } : {}),
    ...(workbench.icon ? { icon: workbench.icon } : {}),
    ...(workbench.order === undefined ? {} : { order: workbench.order }),
    views: structuredClone(workbench.views),
  }
}

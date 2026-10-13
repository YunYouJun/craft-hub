import { z } from 'zod'

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

/** Validate the supported Raycast command-deeplink subset without passing arguments or launch context. */
export function isRaycastCommandUrl(value: string): boolean {
  if (hasControlCharacters(value) || !/^raycast:\/\/extensions\/[^/?#]+\/[^/?#]+\/[^/?#]+$/.test(value))
    return false
  try {
    const url = new URL(value)
    return url.protocol === 'raycast:'
      && url.hostname === 'extensions'
      && !url.username && !url.password && !url.port && !url.search && !url.hash
      && /^\/[\w-]{1,128}\/[\w-]{1,128}\/[\w-]{1,128}$/.test(url.pathname)
  }
  catch {
    return false
  }
}

const toolLaunchSchema = z.discriminatedUnion('application', [
  z.object({
    application: z.literal('raycast'),
    commandUrl: z.string().max(4096).refine(isRaycastCommandUrl, 'Raycast command URLs must use raycast://extensions/owner/extension/command without parameters').optional(),
  }).strict(),
  z.object({ application: z.literal('orca') }).strict(),
])

const toolWebsiteUrlSchema = z.string().max(4096).refine(value => !hasControlCharacters(value), 'Tool URLs must use HTTPS without credentials or control characters').pipe(z.string().trim().min(1).max(4096).url().refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  }
  catch {
    return false
  }
}, 'Tool URLs must use HTTPS without credentials or control characters'))

/** Validate a website shortcut or known application handoff with a required browser fallback. */
export const personalWorkbenchToolSchema = z.object({
  id: z.string().trim().min(1).max(128).refine(value => !value.includes('\0'), 'Tool identifier cannot contain NUL'),
  title: z.string().trim().min(1).max(128).refine(value => !value.includes('\0'), 'Tool title cannot contain NUL'),
  url: toolWebsiteUrlSchema,
  downloadUrl: toolWebsiteUrlSchema.optional(),
  repositoryUrl: toolWebsiteUrlSchema.optional(),
  iconUrl: toolWebsiteUrlSchema.optional(),
  macosIconUrl: toolWebsiteUrlSchema.optional(),
  iconStyle: z.enum(['original', 'rounded']).optional(),
  iconScale: z.number().min(0.5).max(1.5).optional(),
  group: z.string().trim().min(1).max(64).refine(value => !value.includes('\0'), 'Tool group cannot contain NUL'),
  description: z.string().trim().max(512).refine(value => !value.includes('\0'), 'Tool description cannot contain NUL').optional(),
  launch: toolLaunchSchema.optional(),
}).strict()

/** Validate personal home links, project pins and task display preferences without Node dependencies. */
export const personalWorkbenchHomeSchema = z.object({
  tools: z.array(personalWorkbenchToolSchema).max(100).refine(tools => new Set(tools.map(tool => tool.id)).size === tools.length, 'Tool identifiers must be unique'),
  pinnedProjectIds: z.array(z.string().trim().min(1).max(128).refine(value => !value.includes('\0'), 'Pinned project identifier cannot contain NUL')).max(200).refine(ids => new Set(ids).size === ids.length, 'Pinned project identifiers must be unique').optional(),
  workItems: z.object({
    groupByList: z.boolean(),
    density: z.enum(['comfortable', 'compact']),
    showEmptyLists: z.boolean(),
  }).strict().optional(),
}).strict()

/** One grouped tool entry with HTTPS website, download and source links and an optional application launcher. */
export type PersonalWorkbenchTool = z.infer<typeof personalWorkbenchToolSchema>
/** Supported application launch presets; Orca intentionally receives no project context. */
export type PersonalWorkbenchToolLaunch = z.infer<typeof toolLaunchSchema>
/** Personal shortcuts, project pins and task display preferences stored in the operating-system data directory. */
export type PersonalWorkbenchHome = z.infer<typeof personalWorkbenchHomeSchema>

/** Outcome of a user-initiated tool handoff; Craft Hub does not transfer project or task context automatically. */
export interface WorkbenchToolOpenResult {
  destination: 'application' | 'website'
  application?: PersonalWorkbenchToolLaunch['application']
  contextTransferred: false
  fallbackReason?: 'unsupported-platform' | 'application-unavailable'
}

/** Editable tool destinations suggested for a newly opened personal workbench. */
export const defaultPersonalWorkbenchTools: ReadonlyArray<Readonly<PersonalWorkbenchTool>> = Object.freeze([
  Object.freeze({ id: 'raycast', title: 'Raycast', url: 'https://www.raycast.com/', group: 'Work tools', description: 'Launch tools and installed Raycast commands', launch: Object.freeze({ application: 'raycast' as const }) }),
  Object.freeze({ id: 'orca', title: 'Orca', url: 'https://www.onorca.dev/', group: 'Work tools', description: 'Continue agent work in Orca; project context is not transferred', launch: Object.freeze({ application: 'orca' as const }) }),
  Object.freeze({ id: 'chatgpt', title: 'ChatGPT', url: 'https://chatgpt.com/', group: 'AI Tools' }),
  Object.freeze({ id: 'claude', title: 'Claude', url: 'https://claude.ai/', group: 'AI Tools' }),
])

/** Return independent default preferences for runtime or browser consumers. */
export function createDefaultPersonalWorkbenchHome(): PersonalWorkbenchHome {
  return { tools: defaultPersonalWorkbenchTools.map(tool => ({ ...tool, ...(tool.launch ? { launch: { ...tool.launch } } : {}) })) }
}

import type { ParseError } from 'jsonc-parser'
import type { WorkspaceManifest } from './types'
import { Buffer } from 'node:buffer'
import { parse } from 'jsonc-parser'
import { z } from 'zod'
import { normalizeRepositoryUrl } from './project-reference'
import { projectAccentColors } from './types'
import { WorkspaceSubscriptionError } from './workspace-repository'

const id = z.string().regex(/^[\w-]+$/).max(100)
const repository = z.string().refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !!normalizeRepositoryUrl(value)
  }
  catch { return false }
}, 'Members must use credential-free HTTPS repository references')
const member = z.object({ project: repository, label: z.string().min(1).max(200).optional(), pinned: z.boolean().optional() }).strict()
/** Portable source workspace: no owner assignment, machine paths, commands, or credentials. */
export const sourceWorkspaceSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  name: z.string().trim().min(1).max(200),
  icon: z.string().max(200).optional(),
  color: z.enum(projectAccentColors).optional(),
  primaryProject: repository.optional(),
  members: z.array(member).max(200),
}).strict().superRefine((workspace, context) => {
  if (new Set(workspace.members.map(item => normalizeRepositoryUrl(item.project))).size !== workspace.members.length)
    context.addIssue({ code: 'custom', message: 'Duplicate project references' })
  if (workspace.primaryProject && !workspace.members.some(item => normalizeRepositoryUrl(item.project) === normalizeRepositoryUrl(workspace.primaryProject!)))
    context.addIssue({ code: 'custom', message: 'Primary project must be a member' })
})

/** Repository-owned source identity and its portable workspace documents. */
export const workspaceSourceSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  name: z.string().trim().min(1).max(200),
  workspaces: z.array(sourceWorkspaceSchema).max(200),
}).strict().superRefine((source, context) => {
  if (new Set(source.workspaces.map(workspace => workspace.id)).size !== source.workspaces.length)
    context.addIssue({ code: 'custom', message: 'Duplicate workspace ids' })
})
export type WorkspaceSource = z.infer<typeof workspaceSourceSchema>

/** Decode a source.json(c) bundle or a directory of portable workspace JSON(C) documents. */
export function readWorkspaceSource(files: Record<string, string>): WorkspaceSource {
  if (Object.keys(files).length > 200 || Buffer.byteLength(JSON.stringify(files)) > 3 * 1024 * 1024)
    throw new WorkspaceSubscriptionError(400, 'Source exceeds the configuration limit')
  const json = (content: string): unknown => {
    if (Buffer.byteLength(content) > 256 * 1024)
      throw new WorkspaceSubscriptionError(400, 'Configuration file exceeds 256 KiB')
    const errors: ParseError[] = []
    const value: unknown = parse(content, errors, { allowTrailingComma: true })
    if (errors.length)
      throw new WorkspaceSubscriptionError(400, 'Invalid configuration JSONC')
    return value
  }
  if (files['source.json'] && files['source.jsonc'])
    throw new WorkspaceSubscriptionError(400, 'Publish only one source manifest')
  const bundle = files['source.jsonc'] ?? files['source.json']
  const source = workspaceSourceSchema.parse(bundle
    ? json(bundle)
    : {
        schemaVersion: 1,
        id: 'workspaces',
        name: 'Workspaces',
        workspaces: Object.entries(files).filter(([path]) => /^(?:workspaces\/)?[\w-]+\.jsonc?$/.test(path) && !['catalog.json', 'catalog.jsonc', 'projects.json', 'projects.jsonc'].includes(path)).map(([, content]) => json(content)),
      })
  if (!bundle && !source.workspaces.length)
    throw new WorkspaceSubscriptionError(400, 'No source.jsonc or workspace configuration documents were found')
  return { ...source, workspaces: source.workspaces.map(workspace => ({ ...workspace, primaryProject: workspace.primaryProject ? normalizeRepositoryUrl(workspace.primaryProject) : undefined, members: workspace.members.map(item => ({ ...item, project: normalizeRepositoryUrl(item.project) })) })) }
}

/** Read-only projection provided to the workspace module from one atomic subscription state. */
export interface SubscribedWorkspace extends WorkspaceManifest {
  subscription: { id: string, sourceId: string, workspaceId: string, sourceName: string, revision: string }
}

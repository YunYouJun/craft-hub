import type { ParseError } from 'jsonc-parser'
import type { WorkspaceManifest } from './types'
import { Buffer } from 'node:buffer'
import { parse } from 'jsonc-parser'
import { z } from 'zod'
import { normalizeRepositoryUrl } from './project-reference'
import { projectAccentColors } from './types'
import { WorkspaceSubscriptionError } from './workspace-repository'

/** Stable public identity for the version 1 workspace source schema. */
export const workspaceSourceSchemaUrl = 'https://raw.githubusercontent.com/YunYouJun/craft-hub/main/packages/craft-hub/schema/workspace-source-v1.schema.json' as const

/** Editor schema reference for an individual workspace in a source directory. */
export const sourceWorkspaceSchemaUrl = `${workspaceSourceSchemaUrl}#/$defs/workspace` as const

const id = z.string().regex(/^[\w-]+$/).max(100)
const schemaHint = z.string().optional()
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
  $schema: schemaHint,
  schemaVersion: z.literal(1),
  id,
  name: z.string().trim().min(1).max(200),
  icon: z.string().max(200).optional(),
  color: z.enum(projectAccentColors).optional(),
  primaryProject: repository.optional(),
  members: z.array(member).max(200),
}).strict().superRefine((workspace, context) => {
  let members: string[]
  let primaryProject: string | undefined
  try {
    members = workspace.members.map(item => normalizeRepositoryUrl(item.project))
    primaryProject = workspace.primaryProject ? normalizeRepositoryUrl(workspace.primaryProject) : undefined
  }
  catch {
    // Repository field refinements already report invalid URLs at their exact paths.
    return
  }
  if (new Set(members).size !== members.length)
    context.addIssue({ code: 'custom', message: 'Duplicate project references' })
  if (primaryProject && !members.includes(primaryProject))
    context.addIssue({ code: 'custom', message: 'Primary project must be a member' })
})

/** Repository-owned source identity and its portable workspace documents. */
export const workspaceSourceSchema = z.object({
  $schema: schemaHint,
  schemaVersion: z.literal(1),
  id,
  name: z.string().trim().min(1).max(200),
  workspaces: z.array(sourceWorkspaceSchema).max(200),
}).strict().superRefine((source, context) => {
  if (new Set(source.workspaces.map(workspace => workspace.id)).size !== source.workspaces.length)
    context.addIssue({ code: 'custom', message: 'Duplicate workspace ids' })
})
export type WorkspaceSource = z.infer<typeof workspaceSourceSchema>

/** Generate a portable Draft 2020-12 schema; repository and cross-field checks remain in readWorkspaceSource. */
export function workspaceSourceJsonSchema(): Record<string, unknown> {
  const metadata = z.registry<{ id?: string, description?: string }>()
  metadata.add(schemaHint, { description: 'Editor schema hint only; Craft Hub does not fetch or execute this URL' })
  metadata.add(sourceWorkspaceSchema, { id: 'workspace', description: 'Portable workspace; primaryProject must be a member and repository identities must be unique' })
  metadata.add(repository, { description: 'Credential-free HTTPS Git repository URL with a repository path, without a query or fragment; validated and normalized by Craft Hub' })
  const generated = z.toJSONSchema(workspaceSourceSchema, { target: 'draft-2020-12', metadata }) as Record<string, unknown>
  return {
    ...generated,
    $id: workspaceSourceSchemaUrl,
    title: 'Craft Hub workspace source',
    description: 'Repository-owned source identity and portable workspace definitions. Individual workspace documents use #/$defs/workspace.',
    $comment: 'Run the Craft Hub read-only repository validator for HTTPS repository identity, duplicate workspace ids, duplicate project references, primary project membership, and configuration size limits. JSON Schema does not replace those semantic checks.',
  }
}

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
  if (files['source.json'] !== undefined && files['source.jsonc'] !== undefined)
    throw new WorkspaceSubscriptionError(400, 'Publish only one source manifest')
  const bundle = files['source.jsonc'] ?? files['source.json']
  const source = workspaceSourceSchema.parse(bundle !== undefined
    ? json(bundle)
    : {
        schemaVersion: 1,
        id: 'workspaces',
        name: 'Workspaces',
        workspaces: Object.entries(files).filter(([path]) => /^(?:workspaces\/)?[\w-]+\.jsonc?$/.test(path) && !['catalog.json', 'catalog.jsonc', 'projects.json', 'projects.jsonc'].includes(path)).map(([, content]) => json(content)),
      })
  if (bundle === undefined && !source.workspaces.length)
    throw new WorkspaceSubscriptionError(400, 'No source.jsonc or workspace configuration documents were found')
  return { ...source, workspaces: source.workspaces.map(workspace => ({ ...workspace, primaryProject: workspace.primaryProject ? normalizeRepositoryUrl(workspace.primaryProject) : undefined, members: workspace.members.map(item => ({ ...item, project: normalizeRepositoryUrl(item.project) })) })) }
}

/** Read-only projection provided to the workspace module from one atomic subscription state. */
export interface SubscribedWorkspace extends WorkspaceManifest {
  subscription: { id: string, sourceId: string, workspaceId: string, sourceName: string, revision: string }
}

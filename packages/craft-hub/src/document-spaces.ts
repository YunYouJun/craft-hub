import type { FSWatcher } from 'chokidar'
import type { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { access, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import chokidar from 'chokidar'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { z } from 'zod'
import { writeFileAtomic } from './atomic-file'

/** Error raised by Document Space operations with an HTTP status code. */
export class DocumentSpaceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Source kind of a registered or plugin-supplied Document Space. */
export type DocumentSpaceKind = 'local' | 'plugin'

/** Operations supported by a Document Space provider. */
export interface DocumentSpaceCapabilities {
  create: boolean
  write: boolean
  delete: boolean
  move: boolean
  snapshot: boolean
  resolveAsset: boolean
}

/** A navigable document workspace exposed in Craft Hub. */
export interface DocumentSpace {
  id: string
  title: string
  description?: string
  icon?: string
  rootPath?: string
  readOnly?: boolean
  providerId: string
  kind: DocumentSpaceKind
  capabilities: DocumentSpaceCapabilities
}

/** Classification for entries inside a Document Space tree or collection. */
export type DocumentNodeKind = 'document' | 'folder' | 'bundle'

/** Scalar or string-list metadata derived from YAML frontmatter. */
export type DocumentPropertyValue = string | number | boolean | string[]

/** One folder, bundle, or Markdown document node inside a Document Space. */
export interface DocumentNode {
  path: string
  name: string
  title: string
  kind: DocumentNodeKind
  icon?: string
  cover?: string
  summary?: string
  status?: string
  tags?: string[]
  updatedAt?: string
  childCount?: number
  primaryDocumentPath?: string
  properties?: Record<string, DocumentPropertyValue>
}

/** Subpage card metadata surfaced inside a document or bundle header. */
export interface DocumentCard {
  path: string
  title: string
  summary?: string
  icon?: string
  cover?: string
  kind: 'document' | 'bundle'
  status?: string
  updatedAt?: string
}

/** Ancestor trail entry from space root down to the active document. */
export interface DocumentBreadcrumb {
  path: string
  title: string
}

/** Full Markdown document payload with optimistic revision and subpage cards. */
export interface DocumentRecord {
  spaceId: string
  path: string
  title: string
  frontmatter: Record<string, unknown>
  markdown: string
  rawContent: string
  revision: string
  updatedAt: string
  readOnly?: boolean
  cards: DocumentCard[]
  breadcrumbs: DocumentBreadcrumb[]
  folderPath?: string
}

/** Optimistic write request for updating an existing document. */
export interface DocumentWriteInput {
  markdown: string
  frontmatter?: Record<string, unknown>
  expectedRevision?: string
}

/** Result of writing a document, preserving disk state when revisions diverge. */
export type DocumentWriteResult
  = | { status: 'saved', document: DocumentRecord }
    | { status: 'conflict', current: DocumentRecord, message: string }

/** Request to create a standalone Markdown document or folder bundle. */
export interface DocumentCreateInput {
  parentPath?: string
  name: string
  title?: string
  kind?: 'document' | 'bundle'
  markdown?: string
  frontmatter?: Record<string, unknown>
}

/** Request to rename or move a document or folder bundle within a space. */
export interface DocumentMoveInput {
  fromPath: string
  toPath: string
}

/** Resolved local or plugin-backed asset response. */
export type DocumentAssetResult
  = | { content: Buffer, mimeType: string, sha256: string, filename: string }
    | { redirectUrl: string, mimeType?: string }

/** Coalesced change notification emitted when documents change externally. */
export interface DocumentSpaceChangeEvent {
  spaceId: string
  paths: string[]
}

/** Request to register a machine-local directory as a Document Space. */
export interface LocalDocumentSpaceInput {
  path: string
  title?: string
  icon?: string
}

/** Pluggable provider contract for local or Host-Plugin Document Spaces. */
export interface DocumentSpaceProvider {
  readonly id: string
  listSpaces: () => Promise<DocumentSpace[]>
  listNodes: (spaceId: string, parentPath?: string) => Promise<DocumentNode[]>
  readDocument: (spaceId: string, docPath: string) => Promise<DocumentRecord>
  writeDocument?: (spaceId: string, docPath: string, input: DocumentWriteInput) => Promise<DocumentWriteResult>
  createDocument?: (spaceId: string, input: DocumentCreateInput) => Promise<DocumentRecord>
  moveDocument?: (spaceId: string, input: DocumentMoveInput) => Promise<DocumentRecord>
  deleteDocument?: (spaceId: string, docPath: string) => Promise<void>
  openOrCreateDailyNote?: (spaceId: string, date: string) => Promise<DocumentRecord>
  resolveAsset?: (spaceId: string, assetPath: string) => Promise<DocumentAssetResult>
  subscribe?: (listener: (event: DocumentSpaceChangeEvent) => void) => () => void
  close?: () => Promise<void>
}

const spaceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/, 'Invalid document space ID')
const forbiddenSegments = new Set(['.git', 'node_modules'])
const bundleEntryNames = ['index.md', 'brief.md', 'README.md', 'readme.md'] as const
const inlineCardPattern = /^::card\[([^\s\]]+)(?:\s+"([^"]*)")?\]\s*$/gm

const assetMimeTypes: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
}

export const localDocumentSpaceInputSchema = z.strictObject({
  path: z.string().trim().min(1).max(2048),
  title: z.string().trim().min(1).max(200).optional(),
  icon: z.string().trim().min(1).max(128).optional(),
})

export const documentWriteInputSchema = z.strictObject({
  path: z.string().trim().min(1).max(2048),
  markdown: z.string(),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
  expectedRevision: z.string().trim().min(1).max(128).optional(),
})

export const documentCreateInputSchema = z.strictObject({
  parentPath: z.string().max(2048).optional(),
  name: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(['document', 'bundle']).optional(),
  markdown: z.string().optional(),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
})

export const documentMoveInputSchema = z.strictObject({
  fromPath: z.string().trim().min(1).max(2048),
  toPath: z.string().trim().min(1).max(2048),
})

export const documentDailyInputSchema = z.strictObject({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format').optional(),
})

const storedSpacesSchema = z.object({
  schemaVersion: z.literal(1),
  spaces: z.array(z.object({
    id: spaceIdSchema,
    title: z.string().min(1),
    icon: z.string().min(1).optional(),
    rootPath: z.string().min(1),
  })),
})

interface StoredLocalSpace {
  id: string
  title: string
  icon?: string
  rootPath: string
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127)
      return true
  }
  return false
}

/** Normalize a space-relative document or folder path to POSIX slashes while rejecting traversal. */
export function normalizeDocumentPath(input: string, options: { allowEmpty?: boolean } = {}): string {
  const allowEmpty = options.allowEmpty ?? false
  if (typeof input !== 'string')
    throw new DocumentSpaceError(400, 'Document path must be a string')
  if (hasControlCharacter(input))
    throw new DocumentSpaceError(400, 'Document path contains invalid control characters')

  const unixPath = input.replaceAll('\\', '/')
  if (unixPath.startsWith('/') || /^[A-Z]:/i.test(unixPath))
    throw new DocumentSpaceError(400, 'Document path must be relative to the space root')

  const trimmed = unixPath.replace(/\/+$/, '')
  if (!trimmed) {
    if (allowEmpty)
      return ''
    throw new DocumentSpaceError(400, 'Document path is required')
  }

  const segments = trimmed.split('/')
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..')
      throw new DocumentSpaceError(400, `Invalid document path segment: ${input}`)
    if (forbiddenSegments.has(segment))
      throw new DocumentSpaceError(403, `Access to ${segment} is forbidden inside a document space`)
  }
  return segments.join('/')
}

/** Verify a relative target path (or its nearest existing ancestor) remains inside the space root without symlink escape. */
export async function assertWithinSpaceRoot(rootPath: string, relativePath: string): Promise<string> {
  const rootReal = await realpath(rootPath)
  const normalized = normalizeDocumentPath(relativePath, { allowEmpty: true })
  if (!normalized)
    return rootReal

  const segments = normalized.split('/')
  let current = rootReal
  for (let index = 0; index < segments.length; index++) {
    const candidate = resolve(current, segments[index]!)
    try {
      const linkInfo = await lstat(candidate)
      if (linkInfo.isSymbolicLink())
        throw new DocumentSpaceError(403, 'Symbolic links cannot be traversed inside a document space')
      const resolvedCandidate = await realpath(candidate)
      const rel = relative(rootReal, resolvedCandidate)
      if (rel.startsWith('..') || isAbsolute(rel))
        throw new DocumentSpaceError(403, 'Document path escapes the space root')
      current = resolvedCandidate
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const remaining = segments.slice(index)
        const target = resolve(current, ...remaining)
        const rel = relative(rootReal, target)
        if (rel.startsWith('..') || isAbsolute(rel))
          throw new DocumentSpaceError(403, 'Document path escapes the space root')
        return target
      }
      throw error
    }
  }
  return current
}

/** Compute the SHA-256 optimistic concurrency revision of a UTF-8 document. */
export function computeDocumentRevision(rawContent: string): string {
  return createHash('sha256').update(rawContent, 'utf8').digest('hex')
}

/** Parse optional YAML frontmatter from raw Markdown without altering the body when absent. */
export function parseMarkdownDocument(rawContent: string): { frontmatter: Record<string, unknown>, markdown: string } {
  const emptyFrontmatter = /^---\r?\n---(?:\r?\n|$)/.exec(rawContent)
  if (emptyFrontmatter) {
    let body = rawContent.slice(emptyFrontmatter[0].length)
    if (body.startsWith('\r\n'))
      body = body.slice(2)
    else if (body.startsWith('\n'))
      body = body.slice(1)
    return { frontmatter: {}, markdown: body }
  }

  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(rawContent)
  if (!match)
    return { frontmatter: {}, markdown: rawContent }

  try {
    const parsed = parseYaml(match[1] ?? '')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { frontmatter: {}, markdown: rawContent }

    let body = rawContent.slice(match[0].length)
    if (body.startsWith('\r\n'))
      body = body.slice(2)
    else if (body.startsWith('\n'))
      body = body.slice(1)
    return { frontmatter: parsed as Record<string, unknown>, markdown: body }
  }
  catch {
    return { frontmatter: {}, markdown: rawContent }
  }
}

/** Serialize Markdown and optional YAML frontmatter cleanly with round-trip consistency. */
export function serializeMarkdownDocument(markdown: string, frontmatter?: Record<string, unknown>): string {
  const cleanEntries = Object.entries(frontmatter ?? {}).filter(([, value]) => value !== undefined)
  if (!cleanEntries.length)
    return markdown

  const yamlText = stringifyYaml(Object.fromEntries(cleanEntries)).trimEnd()
  if (!yamlText)
    return markdown
  if (!markdown)
    return `---\n${yamlText}\n---\n`
  return `---\n${yamlText}\n---\n\n${markdown}`
}

/** Extract clean display metadata and frontmatter properties from a parsed Markdown file. */
export function extractDocumentMetadata(filePath: string, rawContent: string): {
  title: string
  frontmatter: Record<string, unknown>
  markdown: string
  icon?: string
  cover?: string
  summary?: string
  status?: string
  tags?: string[]
  properties?: Record<string, DocumentPropertyValue>
} {
  const { frontmatter, markdown } = parseMarkdownDocument(rawContent)
  const stem = basename(filePath).replace(/\.md$/i, '')
  const fmTitle = typeof frontmatter.title === 'string' && frontmatter.title.trim() ? frontmatter.title.trim() : undefined
  const headingLine = markdown.split(/\r?\n/).find(line => /^# +\S/.test(line))
  const headingTitle = headingLine ? headingLine.replace(/^# +/, '').trim() : undefined
  const title = fmTitle ?? headingTitle ?? stem

  const icon = typeof frontmatter.icon === 'string' && frontmatter.icon.trim() ? frontmatter.icon.trim() : undefined
  const cover = typeof frontmatter.cover === 'string' && frontmatter.cover.trim() ? frontmatter.cover.trim() : undefined
  const status = typeof frontmatter.status === 'string' && frontmatter.status.trim() ? frontmatter.status.trim() : undefined
  const tags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).map(tag => tag.trim())
    : undefined

  let summary = typeof frontmatter.summary === 'string' && frontmatter.summary.trim() ? frontmatter.summary.trim() : undefined
  if (!summary) {
    const firstParagraphLine = markdown
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('::card[') && !line.startsWith('```') && !line.startsWith('---'))
    if (firstParagraphLine) {
      const stripped = firstParagraphLine
        .replace(/^>\s*(?:\[![A-Z]+\])?\s*/i, '')
        .replace(/[*_`~[\]]/g, '')
        .trim()
      if (stripped)
        summary = stripped.length > 140 ? `${stripped.slice(0, 137)}...` : stripped
    }
  }

  const properties: Record<string, DocumentPropertyValue> = {}
  for (const [key, value] of Object.entries(frontmatter)) {
    if (['title', 'icon', 'cover', 'summary', 'status', 'tags'].includes(key))
      continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      properties[key] = value
    else if (Array.isArray(value) && value.every(item => typeof item === 'string'))
      properties[key] = value
  }

  return {
    title,
    frontmatter,
    markdown,
    ...(icon ? { icon } : {}),
    ...(cover ? { cover } : {}),
    ...(summary ? { summary } : {}),
    ...(status ? { status } : {}),
    ...(tags?.length ? { tags } : {}),
    ...(Object.keys(properties).length ? { properties } : {}),
  }
}

/** Extract relative `::card[path "title"]` references declared inside a Markdown document. */
export function extractInlineCardReferences(markdown: string): Array<{ ref: string, title?: string }> {
  const results: Array<{ ref: string, title?: string }> = []
  for (const match of markdown.matchAll(inlineCardPattern)) {
    const ref = match[1]?.trim()
    const title = match[2]?.trim() || undefined
    if (ref)
      results.push({ ref, ...(title ? { title } : {}) })
  }
  return results
}

function slugifySegment(input: string): string {
  const stripped = Array.from(input.trim().replace(/\.md$/i, ''), (char) => {
    const code = char.charCodeAt(0)
    if (code < 32 || code === 127 || '\\/:*?"<>|'.includes(char))
      return '-'
    return char
  }).join('')
  const cleaned = stripped
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!cleaned || cleaned === '.' || cleaned === '..' || forbiddenSegments.has(cleaned))
    throw new DocumentSpaceError(400, 'Document name must be a valid filename')
  return cleaned
}

function createSpaceId(title: string, rootRealPath: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'space'
  const hash = createHash('sha256').update(rootRealPath).digest('hex').slice(0, 8)
  return `${slug}-${hash}`
}

async function isDirectoryEntry(parentAbs: string, name: string, dirent: { isDirectory: () => boolean, isSymbolicLink: () => boolean }): Promise<boolean> {
  if (dirent.isSymbolicLink())
    return false
  if (dirent.isDirectory())
    return true
  return false
}

async function isFileEntry(dirent: { isFile: () => boolean, isSymbolicLink: () => boolean }): Promise<boolean> {
  if (dirent.isSymbolicLink())
    return false
  return dirent.isFile()
}

function findBundleEntryName(fileNames: readonly string[]): string | undefined {
  for (const candidate of bundleEntryNames) {
    const match = fileNames.find(name => name === candidate)
    if (match)
      return match
  }
  return undefined
}

function defaultDailyDate(): string {
  const now = new Date()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Persistent store for machine-local Document Space registrations. */
export class LocalDocumentSpaceStore {
  readonly path: string
  private writeTail: Promise<unknown> = Promise.resolve()

  constructor(dataDir: string) {
    this.path = resolve(dataDir, 'document-spaces.json')
  }

  /** Return all registered local Document Spaces. */
  async list(): Promise<StoredLocalSpace[]> {
    try {
      const parsed = storedSpacesSchema.parse(JSON.parse(await readFile(this.path, 'utf8')))
      return parsed.spaces
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return []
      throw error
    }
  }

  /** Register a local directory as a Document Space after verifying it exists on disk. */
  async add(input: LocalDocumentSpaceInput): Promise<StoredLocalSpace> {
    const parsedInput = localDocumentSpaceInputSchema.parse(input)
    let directoryReal: string
    try {
      const info = await stat(parsedInput.path)
      if (!info.isDirectory())
        throw new DocumentSpaceError(400, 'Document space path must be an existing directory')
      directoryReal = await realpath(parsedInput.path)
    }
    catch (error) {
      if (error instanceof DocumentSpaceError)
        throw error
      throw new DocumentSpaceError(400, `Document space directory is unavailable: ${parsedInput.path}`)
    }

    const title = parsedInput.title ?? (basename(directoryReal) || 'Documents')
    const operation = this.writeTail.then(async () => {
      const spaces = await this.list()
      const existing = spaces.find(space => space.rootPath === directoryReal)
      if (existing) {
        const updated: StoredLocalSpace = {
          ...existing,
          title: parsedInput.title ?? existing.title,
          ...(parsedInput.icon !== undefined ? { icon: parsedInput.icon } : existing.icon ? { icon: existing.icon } : {}),
        }
        await writeFileAtomic(this.path, JSON.stringify({
          schemaVersion: 1,
          spaces: spaces.map(item => item.id === existing.id ? updated : item),
        }, null, 2))
        return updated
      }

      const baseId = createSpaceId(title, directoryReal)
      let id = baseId
      let suffix = 2
      while (spaces.some(space => space.id === id))
        id = `${baseId}-${suffix++}`

      const entry: StoredLocalSpace = {
        id,
        title,
        ...(parsedInput.icon ? { icon: parsedInput.icon } : {}),
        rootPath: directoryReal,
      }
      await writeFileAtomic(this.path, JSON.stringify({
        schemaVersion: 1,
        spaces: [...spaces, entry],
      }, null, 2))
      return entry
    })
    this.writeTail = operation.catch(() => {})
    return operation
  }

  /** Unregister a local Document Space without deleting files on disk. */
  async remove(spaceId: string): Promise<void> {
    spaceIdSchema.parse(spaceId)
    const operation = this.writeTail.then(async () => {
      const spaces = await this.list()
      if (!spaces.some(space => space.id === spaceId))
        throw new DocumentSpaceError(404, `Unknown document space: ${spaceId}`)
      await writeFileAtomic(this.path, JSON.stringify({
        schemaVersion: 1,
        spaces: spaces.filter(space => space.id !== spaceId),
      }, null, 2))
    })
    this.writeTail = operation.catch(() => {})
    await operation
  }
}

/** Built-in local filesystem Document Space provider with bundle cards, optimistic locking, and file watching. */
export class LocalFilesystemDocumentSpaceProvider implements DocumentSpaceProvider {
  readonly id = 'local'
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly pending = new Map<string, Set<string>>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly listeners = new Set<(event: DocumentSpaceChangeEvent) => void>()

  constructor(
    private readonly store: LocalDocumentSpaceStore,
    private readonly debounceMs = 150,
  ) {}

  /** Register a local directory and begin watching its files for external changes. */
  async addSpace(input: LocalDocumentSpaceInput): Promise<DocumentSpace> {
    const stored = await this.store.add(input)
    await this.watchSpace(stored).catch(() => {})
    return this.toSpace(stored)
  }

  /** Unregister a local space and stop watching its directory. */
  async removeSpace(spaceId: string): Promise<void> {
    await this.store.remove(spaceId)
    await this.unwatchSpace(spaceId)
  }

  /** Start watchers for all persisted local spaces. */
  async startWatching(): Promise<void> {
    const spaces = await this.store.list()
    await Promise.allSettled(spaces.map(space => this.watchSpace(space)))
  }

  /** Return all registered local Document Spaces. */
  async listSpaces(): Promise<DocumentSpace[]> {
    const spaces = await this.store.list()
    return spaces.map(space => this.toSpace(space))
  }

  /** List folders, bundles, and Markdown documents under a directory inside a local space. */
  async listNodes(spaceId: string, parentPath = ''): Promise<DocumentNode[]> {
    const space = await this.requireSpace(spaceId)
    const normalizedParent = normalizeDocumentPath(parentPath, { allowEmpty: true })
    const parentAbs = await assertWithinSpaceRoot(space.rootPath, normalizedParent)

    let entries
    try {
      entries = await readdir(parentAbs, { withFileTypes: true })
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR')
        throw new DocumentSpaceError(404, `Folder not found: ${normalizedParent || '/'}`)
      throw error
    }

    const nodes: DocumentNode[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.') || forbiddenSegments.has(entry.name))
        continue
      const childRel = normalizedParent ? `${normalizedParent}/${entry.name}` : entry.name
      if (await isDirectoryEntry(parentAbs, entry.name, entry)) {
        nodes.push(await this.describeDirectoryNode(space.rootPath, childRel, entry.name))
        continue
      }
      if ((await isFileEntry(entry)) && entry.name.toLowerCase().endsWith('.md'))
        nodes.push(await this.describeDocumentNode(space.rootPath, childRel, entry.name))
    }

    return nodes.sort((left, right) => {
      const rank = (kind: DocumentNodeKind): number => kind === 'folder' ? 0 : kind === 'bundle' ? 1 : 2
      return rank(left.kind) - rank(right.kind) || left.title.localeCompare(right.title)
    })
  }

  /** Read a Markdown document (or resolve a bundle directory to its primary entry document). */
  async readDocument(spaceId: string, docPath: string): Promise<DocumentRecord> {
    const space = await this.requireSpace(spaceId)
    const resolvedPath = await this.resolveReadableDocumentPath(space.rootPath, docPath)
    const absPath = await assertWithinSpaceRoot(space.rootPath, resolvedPath)

    let rawContent: string
    let fileStats
    try {
      ;[rawContent, fileStats] = await Promise.all([readFile(absPath, 'utf8'), stat(absPath)])
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new DocumentSpaceError(404, `Document not found: ${resolvedPath}`)
      throw error
    }

    const meta = extractDocumentMetadata(resolvedPath, rawContent)
    const folderRel = posix.dirname(resolvedPath) === '.' ? '' : posix.dirname(resolvedPath)
    const cards = await this.collectCards(space.rootPath, resolvedPath, folderRel, meta.markdown)
    const breadcrumbs = await this.buildBreadcrumbs(space.rootPath, resolvedPath, meta.title)

    return {
      spaceId: space.id,
      path: resolvedPath,
      title: meta.title,
      frontmatter: meta.frontmatter,
      markdown: meta.markdown,
      rawContent,
      revision: computeDocumentRevision(rawContent),
      updatedAt: fileStats.mtime.toISOString(),
      cards,
      breadcrumbs,
      ...(folderRel ? { folderPath: folderRel } : {}),
    }
  }

  /** Atomically write updated Markdown/frontmatter while enforcing optimistic revision checks. */
  async writeDocument(spaceId: string, docPath: string, input: DocumentWriteInput): Promise<DocumentWriteResult> {
    const space = await this.requireSpace(spaceId)
    const normalized = await this.resolveReadableDocumentPath(space.rootPath, docPath)
    const absPath = await assertWithinSpaceRoot(space.rootPath, normalized)

    let existingRaw: string | undefined
    try {
      existingRaw = await readFile(absPath, 'utf8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }

    const currentRevision = existingRaw === undefined ? undefined : computeDocumentRevision(existingRaw)
    if (input.expectedRevision !== undefined && currentRevision !== undefined && input.expectedRevision !== currentRevision) {
      const current = await this.readDocument(spaceId, normalized)
      return {
        status: 'conflict',
        current,
        message: 'Document changed on disk since it was opened',
      }
    }

    const nextRaw = serializeMarkdownDocument(input.markdown, input.frontmatter)
    await writeFileAtomic(absPath, nextRaw)
    const saved = await this.readDocument(spaceId, normalized)
    return { status: 'saved', document: saved }
  }

  /** Create a new standalone Markdown document or folder bundle without overwriting existing files. */
  async createDocument(spaceId: string, input: DocumentCreateInput): Promise<DocumentRecord> {
    const space = await this.requireSpace(spaceId)
    const parentRel = normalizeDocumentPath(input.parentPath ?? '', { allowEmpty: true })
    const slug = slugifySegment(input.name)
    const kind = input.kind ?? 'document'
    const docRel = kind === 'bundle'
      ? (parentRel ? `${parentRel}/${slug}/index.md` : `${slug}/index.md`)
      : (parentRel ? `${parentRel}/${slug}.md` : `${slug}.md`)

    const targetAbs = await assertWithinSpaceRoot(space.rootPath, docRel)
    if (kind === 'bundle') {
      const bundleAbs = dirname(targetAbs)
      try {
        await access(bundleAbs)
        throw new DocumentSpaceError(409, `Bundle already exists: ${parentRel ? `${parentRel}/${slug}` : slug}`)
      }
      catch (error) {
        if (error instanceof DocumentSpaceError)
          throw error
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw error
      }
    }
    else {
      try {
        await access(targetAbs)
        throw new DocumentSpaceError(409, `Document already exists: ${docRel}`)
      }
      catch (error) {
        if (error instanceof DocumentSpaceError)
          throw error
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw error
      }
    }

    const title = input.title?.trim() || input.name.trim().replace(/\.md$/i, '')
    const frontmatter = {
      ...(input.frontmatter ?? {}),
      ...(input.title?.trim() && input.frontmatter?.title === undefined ? { title } : {}),
    }
    const markdown = input.markdown ?? `# ${title}\n`
    await writeFileAtomic(targetAbs, serializeMarkdownDocument(markdown, frontmatter))
    return this.readDocument(spaceId, docRel)
  }

  /** Move or rename a Markdown document or folder bundle inside the same space. */
  async moveDocument(spaceId: string, input: DocumentMoveInput): Promise<DocumentRecord> {
    const space = await this.requireSpace(spaceId)
    const fromRel = normalizeDocumentPath(input.fromPath)
    const toRel = normalizeDocumentPath(input.toPath)
    if (fromRel === toRel)
      return this.readDocument(spaceId, toRel)

    const fromAbs = await assertWithinSpaceRoot(space.rootPath, fromRel)
    const toAbs = await assertWithinSpaceRoot(space.rootPath, toRel)

    let fromInfo
    try {
      fromInfo = await stat(fromAbs)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new DocumentSpaceError(404, `Source not found: ${fromRel}`)
      throw error
    }

    if (fromInfo.isFile() && !fromRel.toLowerCase().endsWith('.md'))
      throw new DocumentSpaceError(400, 'Only Markdown documents or folders can be moved')
    if (fromInfo.isFile() && !toRel.toLowerCase().endsWith('.md'))
      throw new DocumentSpaceError(400, 'Destination document path must end with .md')
    if (fromInfo.isDirectory() && (toRel === fromRel || toRel.startsWith(`${fromRel}/`)))
      throw new DocumentSpaceError(400, 'Cannot move a folder into itself')

    try {
      await access(toAbs)
      throw new DocumentSpaceError(409, `Target already exists: ${toRel}`)
    }
    catch (error) {
      if (error instanceof DocumentSpaceError)
        throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }

    await mkdir(dirname(toAbs), { recursive: true })
    await rename(fromAbs, toAbs)
    return this.readDocument(spaceId, toRel)
  }

  /** Delete a Markdown document or bundle folder inside a space. */
  async deleteDocument(spaceId: string, docPath: string): Promise<void> {
    const space = await this.requireSpace(spaceId)
    const normalized = normalizeDocumentPath(docPath)
    const absPath = await assertWithinSpaceRoot(space.rootPath, normalized)

    let info
    try {
      info = await stat(absPath)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new DocumentSpaceError(404, `Document not found: ${normalized}`)
      throw error
    }

    if (info.isDirectory()) {
      await rm(absPath, { recursive: true, force: false })
      return
    }
    if (!normalized.toLowerCase().endsWith('.md'))
      throw new DocumentSpaceError(403, 'Only Markdown documents or bundle directories can be deleted')
    await rm(absPath, { force: false })
  }

  /** Open today's daily note (`daily/YYYY-MM-DD.md`), creating it if missing. */
  async openOrCreateDailyNote(spaceId: string, date = defaultDailyDate()): Promise<DocumentRecord> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new DocumentSpaceError(400, 'Daily note date must use YYYY-MM-DD format')
    const docPath = `daily/${date}.md`
    try {
      return await this.readDocument(spaceId, docPath)
    }
    catch (error) {
      if (!(error instanceof DocumentSpaceError) || error.status !== 404)
        throw error
    }
    try {
      return await this.createDocument(spaceId, {
        parentPath: 'daily',
        name: date,
        title: date,
        markdown: `# ${date}\n`,
        frontmatter: { title: date, date, tags: ['daily'] },
      })
    }
    catch (error) {
      if (error instanceof DocumentSpaceError && error.status === 409)
        return this.readDocument(spaceId, docPath)
      throw error
    }
  }

  /** Read a safe, allowlisted media/document asset contained inside the local space root. */
  async resolveAsset(spaceId: string, assetPath: string): Promise<DocumentAssetResult> {
    const space = await this.requireSpace(spaceId)
    const normalized = normalizeDocumentPath(assetPath)
    const extension = extname(normalized).toLowerCase()
    const mimeType = assetMimeTypes[extension]
    if (!mimeType)
      throw new DocumentSpaceError(403, `Unsupported asset type: ${extension || 'unknown'}`)

    const absPath = await assertWithinSpaceRoot(space.rootPath, normalized)
    let content: Buffer
    try {
      const info = await stat(absPath)
      if (!info.isFile())
        throw new DocumentSpaceError(404, `Asset not found: ${normalized}`)
      content = await readFile(absPath)
    }
    catch (error) {
      if (error instanceof DocumentSpaceError)
        throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new DocumentSpaceError(404, `Asset not found: ${normalized}`)
      throw error
    }

    return {
      content,
      mimeType,
      sha256: createHash('sha256').update(content).digest('hex'),
      filename: basename(normalized),
    }
  }

  /** Subscribe to coalesced external change events for local Document Spaces. */
  subscribe(listener: (event: DocumentSpaceChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Stop all active filesystem watchers. */
  async close(): Promise<void> {
    for (const timer of this.timers.values())
      clearTimeout(timer)
    this.timers.clear()
    this.pending.clear()
    await Promise.all([...this.watchers.values()].map(watcher => watcher.close()))
    this.watchers.clear()
  }

  private toSpace(stored: StoredLocalSpace): DocumentSpace {
    return {
      id: stored.id,
      title: stored.title,
      ...(stored.icon ? { icon: stored.icon } : {}),
      rootPath: stored.rootPath,
      providerId: this.id,
      kind: 'local',
      capabilities: {
        create: true,
        write: true,
        delete: true,
        move: true,
        snapshot: false,
        resolveAsset: true,
      },
    }
  }

  private async requireSpace(spaceId: string): Promise<StoredLocalSpace> {
    const spaces = await this.store.list()
    const found = spaces.find(space => space.id === spaceId)
    if (!found)
      throw new DocumentSpaceError(404, `Unknown document space: ${spaceId}`)
    return found
  }

  private async resolveReadableDocumentPath(rootPath: string, rawPath: string): Promise<string> {
    const normalized = normalizeDocumentPath(rawPath)
    const absPath = await assertWithinSpaceRoot(rootPath, normalized)
    try {
      const info = await stat(absPath)
      if (info.isDirectory()) {
        const entries = await readdir(absPath, { withFileTypes: true })
        const fileNames = entries.filter(entry => !entry.isSymbolicLink() && entry.isFile()).map(entry => entry.name)
        const entryName = findBundleEntryName(fileNames)
        if (!entryName)
          throw new DocumentSpaceError(404, `Folder has no entry document: ${normalized}`)
        return `${normalized}/${entryName}`
      }
      if (!normalized.toLowerCase().endsWith('.md'))
        throw new DocumentSpaceError(400, 'Document path must reference a Markdown file or bundle folder')
      return normalized
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return normalized
      throw error
    }
  }

  private async describeDocumentNode(rootPath: string, relPath: string, filename: string): Promise<DocumentNode> {
    const absPath = await assertWithinSpaceRoot(rootPath, relPath)
    const [rawContent, info] = await Promise.all([readFile(absPath, 'utf8'), stat(absPath)])
    const meta = extractDocumentMetadata(relPath, rawContent)
    return {
      path: relPath,
      name: filename,
      title: meta.title,
      kind: 'document',
      ...(meta.icon ? { icon: meta.icon } : {}),
      ...(meta.cover ? { cover: meta.cover } : {}),
      ...(meta.summary ? { summary: meta.summary } : {}),
      ...(meta.status ? { status: meta.status } : {}),
      ...(meta.tags ? { tags: meta.tags } : {}),
      updatedAt: info.mtime.toISOString(),
      ...(meta.properties ? { properties: meta.properties } : {}),
    }
  }

  private async describeDirectoryNode(rootPath: string, relPath: string, folderName: string): Promise<DocumentNode> {
    const absPath = await assertWithinSpaceRoot(rootPath, relPath)
    const [entries, dirStat] = await Promise.all([readdir(absPath, { withFileTypes: true }), stat(absPath)])
    const visibleFiles: string[] = []
    let childCount = 0

    for (const entry of entries) {
      if (entry.name.startsWith('.') || forbiddenSegments.has(entry.name) || entry.isSymbolicLink())
        continue
      if (entry.isDirectory()) {
        childCount++
      }
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        visibleFiles.push(entry.name)
        childCount++
      }
    }

    const entryName = findBundleEntryName(visibleFiles)
    if (!entryName) {
      return {
        path: relPath,
        name: folderName,
        title: folderName,
        kind: 'folder',
        updatedAt: dirStat.mtime.toISOString(),
        childCount,
      }
    }

    const primaryDocumentPath = `${relPath}/${entryName}`
    const primaryAbs = join(absPath, entryName)
    const [rawContent, primaryStat] = await Promise.all([readFile(primaryAbs, 'utf8'), stat(primaryAbs)])
    const meta = extractDocumentMetadata(primaryDocumentPath, rawContent)
    return {
      path: relPath,
      name: folderName,
      title: meta.title === entryName.replace(/\.md$/i, '') ? folderName : meta.title,
      kind: 'bundle',
      ...(meta.icon ? { icon: meta.icon } : {}),
      ...(meta.cover ? { cover: meta.cover } : {}),
      ...(meta.summary ? { summary: meta.summary } : {}),
      ...(meta.status ? { status: meta.status } : {}),
      ...(meta.tags ? { tags: meta.tags } : {}),
      updatedAt: primaryStat.mtime.toISOString(),
      childCount: Math.max(0, childCount - 1),
      primaryDocumentPath,
      ...(meta.properties ? { properties: meta.properties } : {}),
    }
  }

  private async collectCards(rootPath: string, docPath: string, folderRel: string, markdown: string): Promise<DocumentCard[]> {
    const cards = new Map<string, DocumentCard>()
    const folderAbs = await assertWithinSpaceRoot(rootPath, folderRel)
    const entries = await readdir(folderAbs, { withFileTypes: true }).catch(() => [])
    const mdNames = entries
      .filter(entry => !entry.isSymbolicLink() && entry.isFile() && !entry.name.startsWith('.') && entry.name.toLowerCase().endsWith('.md'))
      .map(entry => entry.name)
    const bundleEntry = findBundleEntryName(mdNames)
    const docBasename = basename(docPath)

    // Sibling pages and nested bundles become subpage cards when viewing a folder bundle's primary page.
    if (bundleEntry && bundleEntry === docBasename && folderRel) {
      for (const entry of entries) {
        if (entry.name.startsWith('.') || forbiddenSegments.has(entry.name) || entry.isSymbolicLink())
          continue
        if (entry.name === docBasename)
          continue
        const childRel = `${folderRel}/${entry.name}`
        if (entry.isDirectory()) {
          const node = await this.describeDirectoryNode(rootPath, childRel, entry.name)
          if (node.kind === 'bundle' && node.primaryDocumentPath) {
            cards.set(node.primaryDocumentPath, {
              path: node.primaryDocumentPath,
              title: node.title,
              kind: 'bundle',
              ...(node.summary ? { summary: node.summary } : {}),
              ...(node.icon ? { icon: node.icon } : {}),
              ...(node.cover ? { cover: node.cover } : {}),
              ...(node.status ? { status: node.status } : {}),
              ...(node.updatedAt ? { updatedAt: node.updatedAt } : {}),
            })
          }
        }
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          const node = await this.describeDocumentNode(rootPath, childRel, entry.name)
          cards.set(node.path, {
            path: node.path,
            title: node.title,
            kind: 'document',
            ...(node.summary ? { summary: node.summary } : {}),
            ...(node.icon ? { icon: node.icon } : {}),
            ...(node.cover ? { cover: node.cover } : {}),
            ...(node.status ? { status: node.status } : {}),
            ...(node.updatedAt ? { updatedAt: node.updatedAt } : {}),
          })
        }
      }
    }

    // Inline ::card[./target.md "Optional title"] links resolve relative to the current document's directory.
    for (const inline of extractInlineCardReferences(markdown)) {
      const normalizedRef = inline.ref.replaceAll('\\', '/')
      if (normalizedRef.startsWith('/') || /^[A-Z]:/i.test(normalizedRef) || /^[a-z]+:/i.test(normalizedRef))
        continue
      const combined = folderRel ? `${folderRel}/${normalizedRef}` : normalizedRef
      const resolved = posix.normalize(combined)
      if (!resolved || resolved === '.' || resolved.startsWith('..'))
        continue
      try {
        const targetPath = await this.resolveReadableDocumentPath(rootPath, resolved)
        const targetAbs = await assertWithinSpaceRoot(rootPath, targetPath)
        const targetStat = await stat(targetAbs)
        if (!targetStat.isFile())
          continue
        const targetNode = await this.describeDocumentNode(rootPath, targetPath, basename(targetPath))
        const folderDir = posix.dirname(targetPath)
        const isBundleTarget = folderDir !== '.' && bundleEntryNames.includes(basename(targetPath) as typeof bundleEntryNames[number])
        cards.set(targetPath, {
          path: targetPath,
          title: inline.title ?? targetNode.title,
          kind: isBundleTarget ? 'bundle' : 'document',
          ...(targetNode.summary ? { summary: targetNode.summary } : {}),
          ...(targetNode.icon ? { icon: targetNode.icon } : {}),
          ...(targetNode.cover ? { cover: targetNode.cover } : {}),
          ...(targetNode.status ? { status: targetNode.status } : {}),
          ...(targetNode.updatedAt ? { updatedAt: targetNode.updatedAt } : {}),
        })
      }
      catch {
        // Broken or unsafe inline card targets stay omitted from resolved cards.
      }
    }

    return [...cards.values()]
  }

  private async buildBreadcrumbs(rootPath: string, docPath: string, docTitle: string): Promise<DocumentBreadcrumb[]> {
    const segments = docPath.split('/')
    const breadcrumbs: DocumentBreadcrumb[] = []
    let prefix = ''
    for (let index = 0; index < segments.length - 1; index++) {
      prefix = prefix ? `${prefix}/${segments[index]}` : segments[index]!
      const node = await this.describeDirectoryNode(rootPath, prefix, segments[index]!)
      breadcrumbs.push({
        path: node.primaryDocumentPath ?? prefix,
        title: node.title,
      })
    }
    const parentBreadcrumb = breadcrumbs.at(-1)
    if (!parentBreadcrumb || parentBreadcrumb.path !== docPath)
      breadcrumbs.push({ path: docPath, title: docTitle })
    return breadcrumbs
  }

  private async watchSpace(space: StoredLocalSpace): Promise<void> {
    if (this.watchers.has(space.id))
      return
    const watchRoot = await realpath(space.rootPath)
    const watcher = chokidar.watch(watchRoot, {
      atomic: true,
      depth: 8,
      followSymlinks: false,
      ignoreInitial: true,
      ignored: (targetPath, stats) => {
        const rel = relative(watchRoot, targetPath).split(sep).join('/')
        if (!rel)
          return false
        if (rel.split('/').some(part => part.startsWith('.') || forbiddenSegments.has(part)))
          return true
        if (rel.endsWith('.tmp'))
          return true
        if (stats?.isDirectory())
          return false
        return false
      },
    })
    this.watchers.set(space.id, watcher)
    watcher.on('all', (event, targetPath) => {
      if (event === 'addDir' || event === 'unlinkDir')
        return
      const rel = relative(watchRoot, targetPath).split(sep).join('/')
      if (!rel || rel.endsWith('.tmp'))
        return
      let set = this.pending.get(space.id)
      if (!set) {
        set = new Set()
        this.pending.set(space.id, set)
      }
      set.add(rel)
      const existingTimer = this.timers.get(space.id)
      if (existingTimer)
        clearTimeout(existingTimer)
      const timer = setTimeout(() => {
        this.timers.delete(space.id)
        const paths = [...(this.pending.get(space.id) ?? [])]
        this.pending.delete(space.id)
        if (!paths.length)
          return
        const change: DocumentSpaceChangeEvent = { spaceId: space.id, paths }
        for (const listener of this.listeners)
          listener(change)
      }, this.debounceMs)
      timer.unref()
      this.timers.set(space.id, timer)
    })
    watcher.on('error', () => {})
    await new Promise<void>((resolveReady) => {
      watcher.once('ready', resolveReady)
    })
  }

  private async unwatchSpace(spaceId: string): Promise<void> {
    const timer = this.timers.get(spaceId)
    if (timer)
      clearTimeout(timer)
    this.timers.delete(spaceId)
    this.pending.delete(spaceId)
    const watcher = this.watchers.get(spaceId)
    if (watcher) {
      this.watchers.delete(spaceId)
      await watcher.close()
    }
  }
}

/** Coordinates built-in local Document Spaces and plugin-contributed Document Space providers. */
export class DocumentSpaceService {
  readonly localProvider: LocalFilesystemDocumentSpaceProvider
  private readonly providers: DocumentSpaceProvider[]
  private readonly listeners = new Set<(event: DocumentSpaceChangeEvent) => void>()
  private readonly unsubscribers: Array<() => void> = []

  constructor(
    dataDir: string,
    pluginProviders: DocumentSpaceProvider[] = [],
    private readonly localDirectoriesEnabled = true,
  ) {
    this.localProvider = new LocalFilesystemDocumentSpaceProvider(new LocalDocumentSpaceStore(dataDir))
    this.providers = [this.localProvider, ...pluginProviders]
    for (const provider of this.providers) {
      if (provider.subscribe) {
        this.unsubscribers.push(provider.subscribe((event) => {
          for (const listener of this.listeners)
            listener(event)
        }))
      }
    }
  }

  /** Begin filesystem watching for persisted local Document Spaces. */
  async startWatching(): Promise<void> {
    if (this.localDirectoriesEnabled)
      await this.localProvider.startWatching()
  }

  /** Subscribe to external Document Space change notifications across all providers. */
  onChanged(listener: (event: DocumentSpaceChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** List all available Document Spaces from built-in local storage and trusted plugins. */
  async listSpaces(): Promise<DocumentSpace[]> {
    const groups = await Promise.all(this.providers.map(provider => provider.listSpaces().catch(() => [])))
    return groups.flat()
  }

  /** Register a local directory as a Document Space when local directories are enabled. */
  async addLocalSpace(input: LocalDocumentSpaceInput): Promise<DocumentSpace> {
    if (!this.localDirectoriesEnabled)
      throw new DocumentSpaceError(403, 'Local document spaces are unavailable on this host')
    return this.localProvider.addSpace(input)
  }

  /** Remove a registered local Document Space without deleting files on disk. */
  async removeLocalSpace(spaceId: string): Promise<void> {
    if (!this.localDirectoriesEnabled)
      throw new DocumentSpaceError(403, 'Local document spaces are unavailable on this host')
    await this.localProvider.removeSpace(spaceId)
  }

  /** List folder, bundle, and Markdown document nodes inside a space. */
  async listNodes(spaceId: string, parentPath = ''): Promise<DocumentNode[]> {
    const provider = await this.providerFor(spaceId)
    return provider.listNodes(spaceId, parentPath)
  }

  /** Read one Markdown document or bundle entry inside a space. */
  async readDocument(spaceId: string, docPath: string): Promise<DocumentRecord> {
    const provider = await this.providerFor(spaceId)
    return provider.readDocument(spaceId, docPath)
  }

  /** Update a document with optimistic revision protection. */
  async writeDocument(spaceId: string, docPath: string, input: DocumentWriteInput): Promise<DocumentWriteResult> {
    const provider = await this.providerFor(spaceId)
    if (!provider.writeDocument)
      throw new DocumentSpaceError(403, 'This document space is read-only')
    return provider.writeDocument(spaceId, docPath, input)
  }

  /** Create a new document or folder bundle inside a space. */
  async createDocument(spaceId: string, input: DocumentCreateInput): Promise<DocumentRecord> {
    const provider = await this.providerFor(spaceId)
    if (!provider.createDocument)
      throw new DocumentSpaceError(403, 'Creating documents is not supported by this document space')
    return provider.createDocument(spaceId, input)
  }

  /** Move or rename a document or folder bundle inside a space. */
  async moveDocument(spaceId: string, input: DocumentMoveInput): Promise<DocumentRecord> {
    const provider = await this.providerFor(spaceId)
    if (!provider.moveDocument)
      throw new DocumentSpaceError(403, 'Moving documents is not supported by this document space')
    return provider.moveDocument(spaceId, input)
  }

  /** Delete a document or bundle inside a space. */
  async deleteDocument(spaceId: string, docPath: string): Promise<void> {
    const provider = await this.providerFor(spaceId)
    if (!provider.deleteDocument)
      throw new DocumentSpaceError(403, 'Deleting documents is not supported by this document space')
    await provider.deleteDocument(spaceId, docPath)
  }

  /** Open or create a daily note inside a space. */
  async openOrCreateDailyNote(spaceId: string, date?: string): Promise<DocumentRecord> {
    const provider = await this.providerFor(spaceId)
    if (!provider.openOrCreateDailyNote)
      throw new DocumentSpaceError(403, 'Daily notes are not supported by this document space')
    return provider.openOrCreateDailyNote(spaceId, date ?? defaultDailyDate())
  }

  /** Resolve an image or media asset referenced by a document inside a space. */
  async resolveAsset(spaceId: string, assetPath: string): Promise<DocumentAssetResult> {
    const provider = await this.providerFor(spaceId)
    if (!provider.resolveAsset)
      throw new DocumentSpaceError(404, 'Asset resolution is unavailable for this document space')
    return provider.resolveAsset(spaceId, assetPath)
  }

  /** Dispose all providers and watchers. */
  async close(): Promise<void> {
    for (const unsubscribe of this.unsubscribers.splice(0))
      unsubscribe()
    await Promise.allSettled(this.providers.map(provider => provider.close?.()))
  }

  private async providerFor(spaceId: string): Promise<DocumentSpaceProvider> {
    spaceIdSchema.parse(spaceId)
    for (const provider of this.providers) {
      const spaces = await provider.listSpaces().catch(() => [])
      if (spaces.some(space => space.id === spaceId))
        return provider
    }
    throw new DocumentSpaceError(404, `Unknown document space: ${spaceId}`)
  }
}

/** Validate plugin-supplied DocumentSpaceProvider implementations at plugin load time. */
export function assertDocumentSpaceProviders(providers: unknown, specifier: string): asserts providers is DocumentSpaceProvider[] {
  if (!Array.isArray(providers) || providers.length > 20)
    throw new TypeError(`Plugin ${specifier} documentSpaceProviders must be an array with at most 20 providers`)
  const ids = new Set<string>()
  for (const provider of providers) {
    if (!provider || typeof provider !== 'object')
      throw new TypeError(`Plugin ${specifier} has an invalid document space provider`)
    const candidate = provider as Partial<DocumentSpaceProvider>
    if (typeof candidate.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(candidate.id)
      || typeof candidate.listSpaces !== 'function'
      || typeof candidate.listNodes !== 'function'
      || typeof candidate.readDocument !== 'function') {
      throw new TypeError(`Plugin ${specifier} has an invalid document space provider`)
    }
    if (ids.has(candidate.id))
      throw new TypeError(`Plugin ${specifier} has duplicate document space provider ids`)
    ids.add(candidate.id)
  }
}

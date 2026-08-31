import type { Buffer } from 'node:buffer'
import type { CommandPackage, ProjectReadme } from './types'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { TextDecoder } from 'node:util'

const maxReadmeBytes = 1_000_000
const maxAssetBytes = 8_000_000
const readmeNames = ['README.md', 'README.markdown', 'README.mdown', 'README']
const assetTypes: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function portablePath(path: string): string {
  return path.split('\\').join('/')
}

async function safeRealpath(root: string, target: string): Promise<string | undefined> {
  try {
    const [canonicalRoot, canonicalTarget] = await Promise.all([realpath(root), realpath(target)])
    return isInside(canonicalRoot, canonicalTarget) ? canonicalTarget : undefined
  }
  catch {
    return undefined
  }
}

async function conventionalReadme(directory: string): Promise<string | undefined> {
  let entries: string[]
  try {
    entries = await readdir(directory)
  }
  catch {
    return undefined
  }
  const byLowercase = new Map(entries.map(entry => [entry.toLowerCase(), entry]))
  for (const candidate of readmeNames) {
    const match = byLowercase.get(candidate.toLowerCase())
    if (match) {
      return join(directory, match)
    }
  }
  return undefined
}

/** Resolve and read one bounded UTF-8 README without exposing arbitrary filesystem access. */
export async function readProjectReadme(projectRoot: string, commandPackage: CommandPackage): Promise<ProjectReadme> {
  const packageDirectory = commandPackage.root ? projectRoot : resolve(projectRoot, commandPackage.relativePath)
  if (!isInside(resolve(projectRoot), packageDirectory))
    return { status: 'invalid', message: 'Package path resolves outside the project.' }

  const configuredPath = commandPackage.readme ? resolve(projectRoot, commandPackage.readme) : undefined
  if (configuredPath && !isInside(resolve(projectRoot), configuredPath))
    return { status: 'invalid', message: 'Configured README path resolves outside the project.' }
  const candidate = configuredPath ?? await conventionalReadme(packageDirectory)
  if (!candidate)
    return { status: 'missing' }

  const canonicalPath = await safeRealpath(projectRoot, candidate)
  if (!canonicalPath) {
    return configuredPath
      ? { status: 'invalid', path: portablePath(relative(projectRoot, candidate)), message: 'Configured README is missing or resolves outside the project.' }
      : { status: 'missing' }
  }

  const path = portablePath(relative(await realpath(projectRoot), canonicalPath))
  try {
    const metadata = await stat(canonicalPath)
    if (!metadata.isFile())
      return { status: 'invalid', path, message: 'README target is not a file.' }
    if (metadata.size > maxReadmeBytes)
      return { status: 'too-large', path, message: `README exceeds the ${maxReadmeBytes} byte limit.` }
    const content = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(canonicalPath))
    if (content.includes('\0'))
      return { status: 'invalid', path, message: 'README contains binary data.' }
    return { status: 'found', path, content }
  }
  catch (error) {
    return { status: 'unreadable', path, message: error instanceof Error ? error.message : String(error) }
  }
}

/** Read one bounded raster image inside a registered project for README rendering. */
export async function readProjectOverviewAsset(projectRoot: string, projectRelativePath: string): Promise<{ content: Buffer, contentType: string } | undefined> {
  const contentType = assetTypes[extname(projectRelativePath).toLowerCase()]
  if (!contentType)
    return undefined
  const candidate = resolve(projectRoot, projectRelativePath)
  if (!isInside(resolve(projectRoot), candidate))
    return undefined
  const canonicalPath = await safeRealpath(projectRoot, candidate)
  if (!canonicalPath)
    return undefined
  const metadata = await stat(canonicalPath)
  if (!metadata.isFile() || metadata.size > maxAssetBytes)
    return undefined
  return { content: await readFile(canonicalPath), contentType }
}

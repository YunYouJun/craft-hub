import type { CatalogPluginV1, PluginManifestV1 } from './marketplace'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { valid } from 'semver'
import { z } from 'zod'
import { catalogPluginV1Schema, PluginManager, pluginManifestV1Schema, resolveNpmInvocation } from './marketplace'
import { craftHubVersion } from './version'

const execFileAsync = promisify(execFile)
const initialPluginVersion = '0.1.0'

const npmPackResultSchema = z.array(z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  filename: z.string().min(1),
  integrity: z.string().regex(/^sha512-[A-Za-z0-9+/=]+$/),
  files: z.array(z.object({ path: z.string().min(1) })),
})).length(1)

/** Explicit metadata and starter contributions for a new Marketplace Plugin package. */
export interface MarketplacePluginInitOptions {
  packageName: string
  displayName: string
  license: string
  description?: string
  version?: string
  minCraftHubVersion?: string
  withCommand?: boolean
  withSkill?: boolean
  withProjectTemplate?: boolean
}

/** Validated package identity, normalized Manifest, and npm pack file list. */
export interface MarketplacePluginValidation {
  rootPath: string
  packageName: string
  version: string
  license: string
  manifest: PluginManifestV1
  packedFiles: string[]
}

/** Immutable package artifacts and Catalog Entry draft produced from a validated plugin. */
export interface MarketplacePluginPackResult extends MarketplacePluginValidation {
  tarballPath: string
  catalogEntryPath: string
  integrity: string
  catalogEntry: CatalogPluginV1
}

/** Create a new declarative Marketplace Plugin without overwriting existing content. */
export async function initializeMarketplacePlugin(directory: string, options: MarketplacePluginInitOptions): Promise<{
  rootPath: string
  packageName: string
  files: string[]
}> {
  const rootPath = resolve(directory)
  await assertEmptyTarget(rootPath)
  const packageDocument = marketplacePluginPackageDocument(options)
  const files = marketplacePluginFiles(packageDocument, options)

  await mkdir(rootPath, { recursive: true })
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(rootPath, relativePath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, { encoding: 'utf8', flag: 'wx' })
  }

  return { rootPath, packageName: packageDocument.name, files: Object.keys(files).sort() }
}

/** Validate a local Marketplace Plugin and the files npm would include, without changing the plugin. */
export async function validateMarketplacePlugin(directory: string): Promise<MarketplacePluginValidation> {
  const rootPath = await realpath(resolve(directory))
  if (!(await stat(rootPath)).isDirectory())
    throw new Error(`Marketplace Plugin path must be a directory: ${rootPath}`)

  const packageDocument = await readPackageDocument(rootPath)
  const packageName = requiredString(packageDocument.name, 'package.json name')
  const version = requiredString(packageDocument.version, 'package.json version')
  const license = requiredString(packageDocument.license, 'package.json license')
  if (valid(version) === null)
    throw new Error('Marketplace Plugin package version must be valid SemVer')
  if (packageDocument.private === true)
    throw new Error('Marketplace Plugin packages must be publishable; remove package.json private')

  const validationDataDir = await mkdtemp(join(tmpdir(), 'craft-hub-plugin-validation-'))
  let manifest: PluginManifestV1
  try {
    const manager = new PluginManager(validationDataDir)
    manifest = (await manager.linkLocal(rootPath)).manifest
  }
  finally {
    await rm(validationDataDir, { recursive: true, force: true })
  }

  const pack = await inspectNpmPack(rootPath, true)
  if (pack.name !== packageName || pack.version !== version)
    throw new Error(`npm pack identity does not match ${packageName}@${version}`)
  const packedFiles = pack.files.map(file => normalizePackPath(file.path)).sort()
  assertContributionFilesPacked(manifest, packedFiles)

  return { rootPath, packageName, version, license, manifest, packedFiles }
}

/** Pack a validated Marketplace Plugin and write a reviewable Catalog Entry draft. */
export async function packMarketplacePlugin(directory: string, publisher: string, outputDirectory?: string): Promise<MarketplacePluginPackResult> {
  const normalizedPublisher = publisher.trim()
  if (!normalizedPublisher)
    throw new Error('Publisher must be a non-empty explicit value')

  const validation = await validateMarketplacePlugin(directory)
  const dryRun = await inspectNpmPack(validation.rootPath, true)
  const outputPath = resolve(outputDirectory ?? join(validation.rootPath, 'dist'))
  const catalogFilename = `${dryRun.filename.replace(/\.tgz$/i, '')}.catalog-entry.json`
  const tarballPath = join(outputPath, dryRun.filename)
  const catalogEntryPath = join(outputPath, catalogFilename)
  await assertPathAbsent(tarballPath)
  await assertPathAbsent(catalogEntryPath)

  const staging = await mkdtemp(join(tmpdir(), 'craft-hub-plugin-pack-'))
  const created: string[] = []
  try {
    const packed = await inspectNpmPack(validation.rootPath, false, staging)
    if (packed.filename !== dryRun.filename)
      throw new Error(`npm pack filename changed between validation and packing: ${dryRun.filename} -> ${packed.filename}`)
    assertContributionFilesPacked(validation.manifest, packed.files.map(file => normalizePackPath(file.path)))
    const sourceTarball = join(staging, packed.filename)
    const integrity = `sha512-${createHash('sha512').update(await readFile(sourceTarball)).digest('base64')}`
    if (integrity !== packed.integrity)
      throw new Error('npm pack integrity does not match the generated tarball')

    const catalogEntry = createCatalogEntry(validation, normalizedPublisher, integrity)
    await mkdir(outputPath, { recursive: true })
    await writeFile(catalogEntryPath, `${JSON.stringify(catalogEntry, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    created.push(catalogEntryPath)
    await copyFile(sourceTarball, tarballPath, constants.COPYFILE_EXCL)
    created.push(tarballPath)

    return {
      ...validation,
      tarballPath,
      catalogEntryPath,
      integrity,
      catalogEntry,
    }
  }
  catch (error) {
    await Promise.all(created.map(path => rm(path, { force: true })))
    throw error
  }
  finally {
    await rm(staging, { recursive: true, force: true })
  }
}

function marketplacePluginPackageDocument(options: MarketplacePluginInitOptions): Record<string, unknown> & { name: string, craftHub: PluginManifestV1 } {
  const packageName = options.packageName.trim()
  const displayName = options.displayName.trim()
  const license = options.license.trim()
  const version = options.version?.trim() || initialPluginVersion
  const minCraftHubVersion = options.minCraftHubVersion?.trim() || craftHubVersion
  if (!license)
    throw new Error('License must be provided explicitly')
  if (valid(version) === null)
    throw new Error('Initial plugin version must be valid SemVer')

  const shortName = pluginShortName(packageName)
  const commands = options.withCommand
    ? [{ id: 'version-check', name: `${displayName} version check`, description: 'Print the Node.js version in the selected project.', command: 'node', args: ['--version'], requiredEnv: [] }]
    : []
  const manifest = pluginManifestV1Schema.parse({
    schemaVersion: 1,
    id: packageName,
    displayName,
    ...(options.description?.trim() ? { description: options.description.trim() } : {}),
    slug: shortName,
    craftHub: { minVersion: minCraftHubVersion },
    includesPlugins: [],
    requiresPlugins: [],
    projectFiles: [],
    permissions: commands.length ? ['commands'] : [],
    ...(commands.length ? { permissionReasons: { commands: 'Runs the structured commands declared by this package.' } } : {}),
    contributes: {
      commands,
      commandPresets: [],
      commandTemplates: [],
      packageQuickActions: [],
      packageLinks: [],
      packageToolGroups: [],
      navigationPanels: [],
      workbenches: [],
      skills: options.withSkill ? [{ id: shortName, path: `skills/${shortName}/SKILL.md` }] : [],
      projectTemplates: options.withProjectTemplate ? [{ id: `${shortName}-starter`, path: `templates/${shortName}-starter` }] : [],
      integrations: [],
    },
  })

  const packagedPaths = ['README.md']
  if (options.withSkill)
    packagedPaths.push('skills')
  if (options.withProjectTemplate)
    packagedPaths.push('templates')
  return {
    name: packageName,
    version,
    ...(options.description?.trim() ? { description: options.description.trim() } : {}),
    license,
    files: packagedPaths,
    craftHub: manifest,
  }
}

function marketplacePluginFiles(packageDocument: Record<string, unknown> & { name: string, craftHub: PluginManifestV1 }, options: MarketplacePluginInitOptions): Record<string, string> {
  const shortName = pluginShortName(packageDocument.name)
  const files: Record<string, string> = {
    'package.json': `${JSON.stringify(packageDocument, null, 2)}\n`,
    'README.md': `# ${packageDocument.craftHub.displayName}\n\nDeclarative Craft Hub Marketplace Plugin.\n\nValidate before local linking or packing:\n\n\`\`\`bash\ncraft-hub plugin:validate .\n\`\`\`\n`,
  }
  if (options.withSkill) {
    const skillDescription = JSON.stringify(`Help with ${packageDocument.craftHub.displayName} when its contributed workflow applies.`)
    files[`skills/${shortName}/SKILL.md`] = `---\nname: ${shortName}\ndescription: ${skillDescription}\n---\n\n# ${packageDocument.craftHub.displayName}\n\nInspect the selected project and help the user apply this plugin's workflow.\n`
  }
  if (options.withProjectTemplate)
    files[`templates/${shortName}-starter/README.md`] = `# ${packageDocument.craftHub.displayName} starter\n\nReplace this placeholder with the project template files.\n`
  return files
}

function createCatalogEntry(validation: MarketplacePluginValidation, publisher: string, integrity: string): CatalogPluginV1 {
  const manifest = validation.manifest
  return catalogPluginV1Schema.parse({
    package: validation.packageName,
    version: validation.version,
    displayName: manifest.displayName,
    description: manifest.description,
    slug: manifest.slug,
    links: manifest.links,
    icon: manifest.icon,
    maintainers: manifest.maintainers,
    permissionReasons: manifest.permissionReasons,
    localizations: manifest.localizations,
    publisher,
    integrity,
    permissions: manifest.permissions,
    categories: [],
    status: 'active',
    requires: manifest.craftHub.minVersion ? `>=${manifest.craftHub.minVersion}` : undefined,
    includesPlugins: manifest.includesPlugins,
    requiresPlugins: manifest.requiresPlugins,
  })
}

async function inspectNpmPack(rootPath: string, dryRun: boolean, destination?: string): Promise<z.infer<typeof npmPackResultSchema>[number]> {
  const npm = resolveNpmInvocation()
  const args = [...npm.args, 'pack', '--ignore-scripts', '--json']
  if (dryRun)
    args.push('--dry-run')
  if (destination)
    args.push('--pack-destination', destination)
  let stdout: string
  try {
    const result = await execFileAsync(npm.command, args, { cwd: rootPath, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
    stdout = result.stdout
  }
  catch (error) {
    const detail = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr).trim() : ''
    throw new Error(`npm pack failed${detail ? `: ${detail}` : ''}`, { cause: error })
  }
  let document: unknown
  try {
    document = JSON.parse(stdout)
  }
  catch (error) {
    throw new Error('npm pack did not return valid JSON', { cause: error })
  }
  return npmPackResultSchema.parse(document)[0]
}

async function assertEmptyTarget(path: string): Promise<void> {
  try {
    const metadata = await stat(path)
    if (!metadata.isDirectory())
      throw new Error(`Plugin target must be a directory: ${path}`)
    if ((await readdir(path)).length)
      throw new Error(`Plugin target directory must be empty: ${path}`)
  }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return
    throw error
  }
}

async function assertPathAbsent(path: string): Promise<void> {
  try {
    await access(path)
  }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return
    throw error
  }
  throw new Error(`Refusing to overwrite existing plugin artifact: ${path}`)
}

function assertContributionFilesPacked(manifest: PluginManifestV1, packedFiles: string[]): void {
  const files = new Set(packedFiles.map(normalizePackPath))
  for (const skill of manifest.contributes.skills) {
    if (!files.has(skill.path))
      throw new Error(`Contributed Skill is missing from the npm package: ${skill.path}`)
  }
  for (const template of manifest.contributes.projectTemplates) {
    const prefix = `${template.path.replace(/\/$/, '')}/`
    if (![...files].some(path => path === template.path || path.startsWith(prefix)))
      throw new Error(`Contributed project template is missing from the npm package: ${template.path}`)
  }
}

function normalizePackPath(path: string): string {
  return path.replace(/^package\//, '').replaceAll('\\', '/')
}

function pluginShortName(packageName: string): string {
  const baseName = packageName.split('/').at(-1) ?? ''
  const shortName = baseName.replace(/^(?:craft-hub-plugin-|plugin-)/, '')
  if (!shortName)
    throw new Error('Plugin package name must include a name after its plugin prefix')
  return shortName
}

async function readPackageDocument(rootPath: string): Promise<Record<string, unknown>> {
  try {
    const document = JSON.parse(await readFile(join(rootPath, 'package.json'), 'utf8')) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document))
      throw new Error('package.json must contain an object')
    return document as Record<string, unknown>
  }
  catch (error) {
    throw new Error(`Cannot read Marketplace Plugin package.json in ${rootPath}`, { cause: error })
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} must be a non-empty string`)
  return value
}

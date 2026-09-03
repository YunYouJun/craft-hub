#!/usr/bin/env node
import type { MarketplacePluginInitOptions } from './plugin-authoring'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { cac } from 'cac'
import { launchCraftHubApp, launchCraftHubProject } from './app'
import { initializeMarketplacePlugin, packMarketplacePlugin, validateMarketplacePlugin } from './plugin-authoring'
import { CraftHubRuntime } from './runtime'
import { startCraftHubServer } from './server'
import { craftHubVersion } from './version'

const cli = cac('craft-hub')
const runtime = new CraftHubRuntime()

cli.command('project:add <path>', 'Add a local project (untrusted by default)').action(async (path: string) => {
  console.log(JSON.stringify(await runtime.addProject(path), null, 2))
})

cli.command('project:list', 'List registered projects').action(async () => {
  console.log(JSON.stringify(await runtime.projects.list(), null, 2))
})

cli.command('scope:list', 'List Personal and Team owner scopes').action(async () => {
  console.log(JSON.stringify(await runtime.ownerScopes.list(), null, 2))
})

cli.command('team:create <name> <repositoryPath> [directory]', 'Create a Git-backed Team owner scope').action(async (name: string, repositoryPath: string, directory?: string) => {
  console.log(JSON.stringify(await runtime.teams.create({ name, repositoryPath: resolve(repositoryPath), directory }), null, 2))
})

cli.command('team:rename <ownerScopeId> <name>', 'Rename a Team without changing its stable id').action(async (ownerScopeId: string, name: string) => {
  console.log(JSON.stringify(await runtime.teams.rename(ownerScopeId, name), null, 2))
})

cli.command('team:delete <ownerScopeId> <confirmationName>', 'Delete local Team state after confirming its exact name').action(async (ownerScopeId: string, confirmationName: string) => {
  console.log(JSON.stringify(await runtime.teams.delete(ownerScopeId, confirmationName), null, 2))
})

cli.command('team:sync <ownerScopeId>', 'Synchronize one Team with its configured local Git checkout')
  .option('--use-local', 'Resolve divergence by writing local configuration')
  .option('--use-repository', 'Resolve divergence by applying repository configuration')
  .action(async (ownerScopeId: string, options: { useLocal?: boolean, useRepository?: boolean }) => {
    if (options.useLocal && options.useRepository)
      throw new Error('Choose either --use-local or --use-repository')
    const resolution = options.useLocal ? 'use-local' : options.useRepository ? 'use-repository' : 'auto'
    console.log(JSON.stringify(await runtime.teamGitSync.synchronize(ownerScopeId, resolution), null, 2))
  })

cli.command('workspace:list [ownerScopeId]', 'List workspaces in one owner scope').action(async (ownerScopeId = 'personal') => {
  await runtime.ownerScopes.get(ownerScopeId)
  console.log(JSON.stringify(await runtime.workspaces.list(ownerScopeId), null, 2))
})

cli.command('workspace:import-preview <directory>', 'Validate a VS Code workspace import without writing').action(async (directory: string) => {
  console.log(JSON.stringify(await runtime.workspaceImports.previewVscodeDirectory(resolve(directory)), null, 2))
})

cli.command('workspace:import <directory>', 'Validate and import VS Code workspace files into editable Craft Hub workspaces').action(async (directory: string) => {
  const sourceDirectory = resolve(directory)
  const preview = await runtime.workspaceImports.previewVscodeDirectory(sourceDirectory)
  if (!preview.canImport)
    throw new Error([...preview.conflicts, ...preview.diagnostics.map(item => item.message)].join('; '))
  console.log(JSON.stringify(await runtime.workspaceImports.importVscodeDirectory(sourceDirectory, undefined, preview.revision), null, 2))
})

cli.command('workspace-group:list', 'List workspace groups').action(async () => {
  console.log(JSON.stringify(await runtime.workspaces.groups(), null, 2))
})

cli.command('workspace-group:create <name>', 'Create a workspace group').action(async (name: string) => {
  console.log(JSON.stringify(await runtime.workspaces.createGroup(name), null, 2))
})

cli.command('workspace-group:rename <id> <name>', 'Rename a workspace group').action(async (id: string, name: string) => {
  console.log(JSON.stringify(await runtime.workspaces.renameGroup(id, name), null, 2))
})

cli.command('workspace-group:delete <id>', 'Delete a workspace group without deleting its workspaces').action(async (id: string) => {
  await runtime.workspaces.deleteGroup(id)
  console.log(JSON.stringify({ deleted: id }, null, 2))
})

cli.command('workspace-group:assign <workspaceId> [groupId]', 'Assign a workspace to a group, or omit groupId to leave it ungrouped').action(async (workspaceId: string, groupId?: string) => {
  console.log(JSON.stringify(await runtime.workspaces.assignGroup(workspaceId, groupId), null, 2))
})

cli.command('workspace-group:assign-project <projectId> [groupId]', 'Assign a standalone project to a group, or omit groupId to leave it ungrouped').action(async (projectId: string, groupId?: string) => {
  console.log(JSON.stringify(await runtime.workspaces.assignProjectGroup(projectId, groupId), null, 2))
})

cli.command('git-sync:configure <repositoryPath> [directory]', 'Select a local Git checkout for Personal configuration sync').action(async (repositoryPath: string, directory?: string) => {
  console.log(JSON.stringify(await runtime.personalGitSync.configure({ repositoryPath, directory }), null, 2))
})

cli.command('git-sync:status', 'Inspect Personal configuration divergence in the selected Git checkout').action(async () => {
  console.log(JSON.stringify(await runtime.personalGitSync.status(), null, 2))
})

cli.command('git-sync:sync', 'Synchronize Personal configuration with the selected Git checkout')
  .option('--use-local', 'Resolve divergence by writing local configuration')
  .option('--use-repository', 'Resolve divergence by applying repository configuration')
  .action(async (options: { useLocal?: boolean, useRepository?: boolean }) => {
    if (options.useLocal && options.useRepository)
      throw new Error('Choose either --use-local or --use-repository')
    const resolution = options.useLocal ? 'use-local' : options.useRepository ? 'use-repository' : 'auto'
    console.log(JSON.stringify(await runtime.personalGitSync.synchronize(resolution), null, 2))
  })

cli.command('project:trust <id>', 'Trust a registered project').action(async (id: string) => {
  console.log(JSON.stringify(await runtime.projects.setTrust(id, 'trusted'), null, 2))
})

cli.command('list <projectId>', 'List commands and skills for a project').action(async (projectId: string) => {
  console.log(JSON.stringify(await runtime.capabilities(projectId), null, 2))
})

cli.command('plugin:list', 'List installed Craft Hub plugins').action(async () => {
  console.log(JSON.stringify(await runtime.pluginManager.listInstalled(), null, 2))
})

cli.command('plugin:init <path>', 'Create a declarative Marketplace Plugin package')
  .option('--non-interactive', 'Require explicit metadata instead of prompting')
  .option('--package <name>', 'Scoped npm package name')
  .option('--display-name <name>', 'User-facing plugin name')
  .option('--description <text>', 'Plugin description')
  .option('--license <id>', 'Explicit SPDX license identifier or expression')
  .option('--version <version>', 'Initial package version', { default: '0.1.0' })
  .option('--min-version <version>', 'Minimum Craft Hub version', { default: craftHubVersion })
  .option('--with-command', 'Scaffold a structured command contribution')
  .option('--with-skill', 'Scaffold an Agent Skill contribution')
  .option('--with-project-template', 'Scaffold a project template contribution')
  .action(async (path: string, options: PluginInitCliOptions) => {
    const init = options.nonInteractive ? requirePluginInitOptions(options) : await promptForPluginInitOptions(options)
    console.log(JSON.stringify(await initializeMarketplacePlugin(path, init), null, 2))
  })

cli.command('plugin:validate <path>', 'Validate a declarative Marketplace Plugin without changing it').action(async (path: string) => {
  const result = await validateMarketplacePlugin(path)
  console.log(JSON.stringify({
    valid: true,
    rootPath: result.rootPath,
    package: result.packageName,
    version: result.version,
    packedFiles: result.packedFiles,
  }, null, 2))
})

cli.command('plugin:pack <path>', 'Pack a validated Marketplace Plugin and create a Catalog Entry draft')
  .option('--publisher <id>', 'Explicit Catalog publisher identity')
  .option('--output <path>', 'Artifact directory; defaults to the plugin dist directory')
  .action(async (path: string, options: { publisher?: string, output?: string }) => {
    if (!options.publisher)
      throw new Error('--publisher is required')
    const result = await packMarketplacePlugin(path, options.publisher, options.output)
    console.log(JSON.stringify({
      package: result.packageName,
      version: result.version,
      integrity: result.integrity,
      tarballPath: result.tarballPath,
      catalogEntryPath: result.catalogEntryPath,
    }, null, 2))
  })

cli.command('plugin:link <path>', 'Load a declarative plugin directly from a local package directory').action(async (path: string) => {
  console.log(JSON.stringify(await runtime.pluginManager.linkLocal(path), null, 2))
})

cli.command('plugin:refresh <packageName>', 'Reload a linked local plugin manifest from disk').action(async (packageName: string) => {
  console.log(JSON.stringify(await runtime.pluginManager.refreshLocal(packageName), null, 2))
})

cli.command('plugin:unlink <packageName>', 'Stop loading a linked local plugin').action(async (packageName: string) => {
  await runtime.pluginManager.unlinkLocal(packageName)
  console.log(JSON.stringify({ unlinked: true, package: packageName }))
})

cli.command('plugin:search [query]', 'Search enabled marketplace catalogs').action(async (query = '') => {
  const normalized = query.toLowerCase()
  const plugins = (await runtime.pluginManager.catalog()).filter(plugin => !normalized
    || plugin.package.toLowerCase().includes(normalized)
    || plugin.displayName.toLowerCase().includes(normalized)
    || plugin.description?.toLowerCase().includes(normalized))
  console.log(JSON.stringify(plugins, null, 2))
})

cli.command('plugin:install <sourceId> <packageName> [version]', 'Install and enable a catalog plugin')
  .option('--yes', 'Confirm package source, version, and declared permissions')
  .action(async (sourceId: string, packageName: string, version: string | undefined, options: { yes?: boolean }) => {
    const plugin = (await runtime.pluginManager.catalog()).find(item => item.sourceId === sourceId && item.package === packageName && (!version || item.version === version))
    if (!plugin)
      throw new Error(`Plugin is not listed by source ${sourceId}: ${packageName}`)
    const plan = await runtime.pluginManager.planInstall({ sourceId, package: packageName, version })
    console.log(`source: ${plugin.sourceName} (${plugin.sourceKind})`)
    console.log(`package: ${plugin.package}@${plugin.version} (${plan.items.length} plugin${plan.items.length === 1 ? '' : 's'})`)
    for (const item of plan.items)
      console.log(`- ${item.action}: ${item.package}@${item.version}${item.root ? ' (root)' : ''}`)
    console.log(`permissions: ${plan.permissions.join(', ') || '(none)'}`)
    if (!options.yes)
      throw new Error('Preview only. Re-run with --yes to install.')
    console.log(JSON.stringify(await runtime.pluginManager.install({ sourceId, package: packageName, version }), null, 2))
  })

cli.command('plugin:enable <packageName>', 'Enable an installed plugin').action(async (packageName: string) => {
  console.log(JSON.stringify(await runtime.pluginManager.setEnabled(packageName, true), null, 2))
})

cli.command('plugin:disable <packageName>', 'Disable an installed plugin').action(async (packageName: string) => {
  console.log(JSON.stringify(await runtime.pluginManager.setEnabled(packageName, false), null, 2))
})

cli.command('plugin:rollback <packageName>', 'Switch to the previous installed plugin version').action(async (packageName: string) => {
  console.log(JSON.stringify(await runtime.pluginManager.rollback(packageName), null, 2))
})

cli.command('plugin:remove <packageName>', 'Uninstall a plugin while preserving its user data')
  .option('--delete-data', 'Also delete non-credential plugin data')
  .option('--yes', 'Confirm removal')
  .action(async (packageName: string, options: { deleteData?: boolean, yes?: boolean }) => {
    if (!options.yes)
      throw new Error('Preview only. Re-run with --yes to remove the plugin.')
    await runtime.pluginManager.remove(packageName, options.deleteData)
    console.log(JSON.stringify({ deleted: true, package: packageName, dataDeleted: options.deleteData === true }))
  })

cli.command('marketplace:list', 'List configured marketplace sources').action(async () => {
  console.log(JSON.stringify(await runtime.pluginManager.listSources(), null, 2))
})

cli.command('marketplace:add <name> <catalogUrl>', 'Add an unverified HTTPS marketplace source')
  .option('--registry <url>', 'npm registry used by this source')
  .action(async (name: string, catalogUrl: string, options: { registry?: string }) => {
    console.log(JSON.stringify(await runtime.pluginManager.addSource({ name, catalogUrl, registry: options.registry }), null, 2))
  })

cli.command('marketplace:refresh <sourceId>', 'Refresh one marketplace catalog').action(async (sourceId: string) => {
  console.log(JSON.stringify(await runtime.pluginManager.refreshSource(sourceId), null, 2))
})

cli.command('marketplace:remove <sourceId>', 'Remove a user marketplace source').action(async (sourceId: string) => {
  await runtime.pluginManager.removeSource(sourceId)
  console.log(JSON.stringify({ deleted: true, sourceId }))
})

cli.command('settings:get [key]', 'Read global user settings')
  .option('--json', 'Print machine-readable JSON')
  .action(async (key: string | undefined) => {
    const snapshot = await runtime.settings.get()
    if (!key)
      return console.log(JSON.stringify(snapshot, null, 2))
    if (!(key in snapshot.settings))
      throw new Error(`Unknown setting: ${key}`)
    console.log(JSON.stringify(snapshot.settings[key as keyof typeof snapshot.settings]))
  })

cli.command('settings:set <key> <value>', 'Set a global user setting; use null to reset it')
  .option('--json', 'Print machine-readable JSON')
  .action(async (key: string, value: string) => {
    const snapshot = await runtime.settings.get()
    let parsed: unknown = value
    try {
      parsed = JSON.parse(value) as unknown
    }
    catch {
      // Bare strings are convenient for enum-like settings such as locales.
    }
    console.log(JSON.stringify(await runtime.settings.update({ [key]: parsed }, snapshot.revision), null, 2))
  })

cli.command('settings:export [path]', 'Export portable global settings JSON')
  .option('--mode <mode>', 'minimal or full', { default: 'minimal' })
  .action(async (path: string | undefined, options: { mode: string }) => {
    if (options.mode !== 'minimal' && options.mode !== 'full')
      throw new Error('mode must be minimal or full')
    const output = `${JSON.stringify(await runtime.settings.export(options.mode), null, 2)}\n`
    if (path)
      await writeFile(resolve(path), output, 'utf8')
    else
      process.stdout.write(output)
  })

cli.command('settings:import <path>', 'Preview or import portable global settings JSON')
  .option('--replace', 'Reset settings before importing')
  .option('--dry-run', 'Validate and print changes without writing')
  .option('--json', 'Print machine-readable JSON')
  .action(async (path: string, options: { dryRun?: boolean, replace?: boolean }) => {
    const document = JSON.parse(await readFile(resolve(path), 'utf8')) as unknown
    const strategy = options.replace ? 'replace' : 'merge'
    const preview = await runtime.settings.previewImport(document, strategy)
    if (options.dryRun)
      return console.log(JSON.stringify(preview, null, 2))
    const snapshot = await runtime.settings.get()
    console.log(JSON.stringify({ preview, result: await runtime.settings.import(document, strategy, snapshot.revision) }, null, 2))
  })

cli.command('run <projectId> <capabilityId>', 'Run a trusted project command')
  .option('--yes', 'Confirm the displayed command preview')
  .action(async (projectId: string, capabilityId: string, options: { yes?: boolean }) => {
    const project = await runtime.projects.get(projectId)
    const capability = (await runtime.capabilities(projectId)).find(item => item.id === capabilityId)
    if (!capability || capability.kind !== 'command')
      throw new Error(`Command capability not found: ${capabilityId}`)
    console.log(`cwd: ${capability.invocation.cwd}`)
    console.log(`command: ${[capability.invocation.command, ...capability.invocation.args].join(' ')}`)
    console.log(`required env: ${capability.invocation.requiredEnv.join(', ') || '(none)'}`)
    if (!options.yes)
      throw new Error('Preview only. Re-run with --yes to execute.')
    const handle = await runtime.run(project.id, capability.id, (event) => {
      const output = event.stream === 'stdout' ? process.stdout : process.stderr
      output.write(event.chunk)
    })
    const run = await handle.completion
    process.exitCode = run.exitCode ?? 1
  })

cli.command('app [path]', 'Start Craft Hub for a project directory')
  .option('--browser', 'Open a standalone browser workbench instead of the desktop client')
  .option('--no-open', 'Do not open the system browser')
  .option('--port <port>', 'HTTP port (random by default)')
  .action(async (path: string | undefined, options: { browser?: boolean, open?: boolean, port?: number | string }) => {
    const launchOptions = {
      open: options.open !== false,
      port: options.port === undefined ? 0 : Number(options.port),
      runtime,
    }
    const app = options.browser || options.open === false || options.port !== undefined
      ? { kind: 'browser' as const, ...await launchCraftHubApp(path ?? '.', launchOptions) }
      : await launchCraftHubProject(path ?? '.', launchOptions)
    console.log(app.kind === 'desktop' ? `Opened Craft Hub Desktop at ${app.url}` : `Craft Hub is ready at ${app.url}`)
  })

cli.command('ui', 'Start the local Craft Hub workbench').option('--port <port>', 'HTTP port', { default: 4318 }).action(async (options: { port: number }) => {
  const staticDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../apps/web/dist')
  const app = await startCraftHubServer({ port: Number(options.port), staticDir, runtime })
  console.log(`Craft Hub is ready at ${app.url}`)
})

cli.help()
cli.version(craftHubVersion)
cli.parse()

process.on('unhandledRejection', (error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

interface PluginInitCliOptions {
  nonInteractive?: boolean
  package?: string
  displayName?: string
  description?: string
  license?: string
  version?: string
  minVersion?: string
  withCommand?: boolean
  withSkill?: boolean
  withProjectTemplate?: boolean
}

function requirePluginInitOptions(options: PluginInitCliOptions): MarketplacePluginInitOptions {
  if (!options.package)
    throw new Error('--package is required with --non-interactive')
  if (!options.displayName)
    throw new Error('--display-name is required with --non-interactive')
  if (!options.license)
    throw new Error('--license is required with --non-interactive')
  return {
    packageName: options.package,
    displayName: options.displayName,
    description: options.description,
    license: options.license,
    version: options.version,
    minCraftHubVersion: options.minVersion,
    withCommand: options.withCommand,
    withSkill: options.withSkill,
    withProjectTemplate: options.withProjectTemplate,
  }
}

async function promptForPluginInitOptions(options: PluginInitCliOptions): Promise<MarketplacePluginInitOptions> {
  const prompts = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const packageName = options.package ?? await requiredAnswer(prompts, 'Scoped package name: ')
    const displayName = options.displayName ?? await requiredAnswer(prompts, 'Display name: ')
    const license = options.license ?? await requiredAnswer(prompts, 'License: ')
    const description = options.description ?? await prompts.question('Description (optional): ')
    const withCommand = options.withCommand || await confirmAnswer(prompts, 'Add a command contribution? [y/N] ')
    const withSkill = options.withSkill || await confirmAnswer(prompts, 'Add an Agent Skill contribution? [y/N] ')
    const withProjectTemplate = options.withProjectTemplate || await confirmAnswer(prompts, 'Add a project template contribution? [y/N] ')
    return {
      packageName,
      displayName,
      license,
      description: description || undefined,
      version: options.version,
      minCraftHubVersion: options.minVersion,
      withCommand,
      withSkill,
      withProjectTemplate,
    }
  }
  finally {
    prompts.close()
  }
}

async function requiredAnswer(prompts: ReturnType<typeof createInterface>, question: string): Promise<string> {
  const answer = (await prompts.question(question)).trim()
  if (!answer)
    throw new Error(`${question.trim().replace(/:$/, '')} is required`)
  return answer
}

async function confirmAnswer(prompts: ReturnType<typeof createInterface>, question: string): Promise<boolean> {
  return /^(?:y|yes)$/i.test((await prompts.question(question)).trim())
}

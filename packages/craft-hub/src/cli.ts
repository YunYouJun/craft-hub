#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { cac } from 'cac'
import { launchCraftHubApp } from './app'
import { CraftHubRuntime } from './runtime'
import { startCraftHubServer } from './server'

const cli = cac('craft-hub')
const runtime = new CraftHubRuntime()

cli.command('project:add <path>', 'Add a local project (untrusted by default)').action(async (path: string) => {
  console.log(JSON.stringify(await runtime.addProject(path), null, 2))
})

cli.command('project:list', 'List registered projects').action(async () => {
  console.log(JSON.stringify(await runtime.projects.list(), null, 2))
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
    console.log(`source: ${plugin.sourceName} (${plugin.sourceKind})`)
    console.log(`package: ${plugin.package}@${plugin.version}`)
    console.log(`permissions: ${plugin.permissions.join(', ') || '(none)'}`)
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
  .option('--no-open', 'Do not open the system browser')
  .option('--port <port>', 'HTTP port (random by default)')
  .action(async (path: string | undefined, options: { open?: boolean, port?: number | string }) => {
    const app = await launchCraftHubApp(path ?? '.', {
      open: options.open !== false,
      port: options.port === undefined ? 0 : Number(options.port),
      runtime,
    })
    console.log(`Craft Hub is ready at ${app.url}`)
  })

cli.command('ui', 'Start the local Craft Hub workbench').option('--port <port>', 'HTTP port', { default: 4318 }).action(async (options: { port: number }) => {
  const staticDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../apps/web/dist')
  const app = await startCraftHubServer({ port: Number(options.port), staticDir, runtime })
  console.log(`Craft Hub is ready at ${app.url}`)
})

cli.help()
cli.version('0.0.1-alpha.0')
cli.parse()

process.on('unhandledRejection', (error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

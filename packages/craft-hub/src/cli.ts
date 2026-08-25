#!/usr/bin/env node
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { cac } from 'cac'
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

cli.command('project:trust <id>', 'Trust a registered project').action(async (id: string) => {
  console.log(JSON.stringify(await runtime.projects.setTrust(id, 'trusted'), null, 2))
})

cli.command('list <projectId>', 'List commands and skills for a project').action(async (projectId: string) => {
  console.log(JSON.stringify(await runtime.capabilities(projectId), null, 2))
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

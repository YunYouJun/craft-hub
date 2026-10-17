import type { CraftHubPlugin } from 'craft-hub'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { createWorkstationPlugin, resolveLocalExecutable, workstationTransport } from '@craft-hub/craft-hub-plugin-workstation'

/** Application-owned backend metadata, distinct from user-installed Marketplace declarations. */
export interface BundledWorkstation { schemaVersion: 1, version: string, revision: string }

/** Validate only the fixed app resource; a manifest cannot select an executable path. */
export function readBundledWorkstation(directory: string): BundledWorkstation | undefined {
  const file = join(directory, 'runtime.json')
  if (!existsSync(file))
    return
  const value = JSON.parse(readFileSync(file, 'utf8')) as BundledWorkstation
  const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name?: string, version?: string }
  if (value.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(value.version) || !/^[a-f0-9]{40}$/.test(value.revision)
    || metadata.name !== '@yunyoujun/workstation' || metadata.version !== value.version || !existsSync(join(directory, 'dist/cli.js'))) {
    throw new Error('Invalid bundled Workstation backend')
  }
  return value
}

/** Prefer an explicitly configured or installed CLI; fresh desktops use their prebuilt app backend. */
export function desktopWorkstation(options: {
  directory: string
  executable?: string
  homeDirectory?: string
  env?: NodeJS.ProcessEnv
}): { plugin: CraftHubPlugin, bundled?: BundledWorkstation } {
  const env = options.env ?? process.env
  const home = options.homeDirectory ?? homedir()
  if (env.CRAFT_HUB_WORKSTATION_COMMAND)
    return { plugin: createWorkstationPlugin() }
  try {
    resolveLocalExecutable('workstation', { homeDirectory: home, env })
    return { plugin: createWorkstationPlugin() }
  }
  catch { /* A fresh machine can use the signed application's own backend. */ }
  const bundled = readBundledWorkstation(options.directory)
  if (!bundled)
    return { plugin: createWorkstationPlugin() }
  const command = options.executable ?? process.execPath
  const args = [join(options.directory, 'dist/cli.js')]
  // Configuration sources stay in the user's checkout, so reviewed writes never modify the application bundle.
  const environment = { ELECTRON_RUN_AS_NODE: '1', DOTFILES_REPO_ROOT: env.DOTFILES_REPO_ROOT ?? join(home, 'repos/github.com/YunYouJun/workstation') }
  return {
    bundled,
    plugin: createWorkstationPlugin(
      workstationTransport(command, args, 'configuration', environment),
      workstationTransport(command, args, 'software-json', environment),
      workstationTransport(command, args, 'host-json', environment),
      { homeDirectory: home, sourceDirectory: environment.DOTFILES_REPO_ROOT, managed: true, invocation: { command, args, environment } },
    ),
  }
}

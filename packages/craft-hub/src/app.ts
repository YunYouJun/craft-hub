import type { ChildProcess } from 'node:child_process'
import type { ProjectRecord } from './types'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { CraftHubRuntime } from './runtime'
import { startCraftHubServer } from './server'

export type BrowserOpener = (url: string) => Promise<void>

export interface LaunchCraftHubAppOptions {
  open?: boolean
  openBrowser?: BrowserOpener
  port?: number
  runtime?: CraftHubRuntime
  staticDir?: string
}

export interface CraftHubAppLaunch {
  close: () => Promise<void>
  project: ProjectRecord
  url: string
}

function browserProcess(url: string): ChildProcess {
  if (process.platform === 'darwin')
    return spawn('open', [url], { detached: true, shell: false, stdio: 'ignore' })
  if (process.platform === 'win32')
    return spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', url], { detached: true, shell: false, stdio: 'ignore' })
  return spawn('xdg-open', [url], { detached: true, shell: false, stdio: 'ignore' })
}

/** Open a URL in the operating system's default browser. */
export async function openSystemBrowser(url: string): Promise<void> {
  const child = browserProcess(url)
  await Promise.race([
    once(child, 'spawn'),
    once(child, 'error').then(([error]) => Promise.reject(error)),
  ])
  child.unref()
}

/** Register a project, start its local workbench, and optionally open it. */
export async function launchCraftHubApp(projectPath: string, options: LaunchCraftHubAppOptions = {}): Promise<CraftHubAppLaunch> {
  const runtime = options.runtime ?? new CraftHubRuntime()
  const project = await runtime.addProject(resolve(projectPath))
  const staticDir = options.staticDir ?? resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../apps/web/dist')
  const workbench = await startCraftHubServer({ port: options.port ?? 0, runtime, staticDir })
  const url = new URL(workbench.url)
  url.searchParams.set('project', project.id)
  const launch: CraftHubAppLaunch = { close: workbench.close, project, url: url.toString() }

  try {
    if (options.open !== false)
      await (options.openBrowser ?? openSystemBrowser)(launch.url)
    return launch
  }
  catch (error) {
    await workbench.close()
    throw error
  }
}

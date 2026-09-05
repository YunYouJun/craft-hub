import type { ChildProcess } from 'node:child_process'
import type { ProjectRecord, ProjectReference } from './types'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { identifyProjectReference, normalizeProjectReference } from './project-reference'
import { CraftHubRuntime } from './runtime'
import { startCraftHubServer } from './server'

const execFileAsync = promisify(execFile)

/** Function that opens one HTTP Workbench URL in a browser. */
export type BrowserOpener = (url: string) => Promise<void>

/** Function that sends one navigation-only Desktop Link to the installed client. */
export type DesktopOpener = (url: string) => Promise<void>

/** Dependencies and launch settings for a standalone browser Workbench. */
export interface LaunchCraftHubAppOptions {
  open?: boolean
  openBrowser?: BrowserOpener
  port?: number
  runtime?: CraftHubRuntime
  staticDir?: string
}

/** Browser launch settings plus an optional desktop opener adapter. */
export interface LaunchCraftHubProjectOptions extends LaunchCraftHubAppOptions {
  openDesktop?: DesktopOpener
}

/** Running standalone browser Workbench and its selected Project. */
export interface CraftHubAppLaunch {
  close: () => Promise<void>
  project: ProjectRecord
  url: string
}

/** Result of opening a Project in either the desktop client or browser Workbench. */
export type CraftHubProjectLaunch
  = | { kind: 'desktop', url: string }
    | ({ kind: 'browser' } & CraftHubAppLaunch)

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

/** Ask the operating system to open one Craft Hub Desktop Link. */
export async function openCraftHubDesktop(url: string): Promise<void> {
  const invocation = process.platform === 'darwin'
    ? { command: 'open', args: [url] }
    : process.platform === 'win32'
      ? { command: 'explorer.exe', args: [url] }
      : { command: 'xdg-open', args: [url] }
  await execFileAsync(invocation.command, invocation.args, { windowsHide: true })
}

/** Build one Desktop Link that requests a single in-app celebration. */
export function craftHubCelebrationDesktopUrl(): string {
  const url = new URL('craft-hub://celebrate')
  url.searchParams.set('v', '1')
  return url.href
}

/** Build one normalized, navigation-only Desktop Link for a Project Reference. */
export function craftHubProjectDesktopUrl(reference: ProjectReference, capabilityId?: string): string {
  const normalized = normalizeProjectReference(reference)
  const url = new URL('craft-hub://project')
  url.searchParams.set('v', '1')
  url.searchParams.set('repo', normalized.repository)
  if (normalized.subdir)
    url.searchParams.set('subdir', normalized.subdir)
  if (capabilityId)
    url.searchParams.set('capability', capabilityId)
  return url.href
}

/** Prefer the installed desktop client, falling back to a standalone browser workbench. */
export async function launchCraftHubProject(projectPath: string, options: LaunchCraftHubProjectOptions = {}): Promise<CraftHubProjectLaunch> {
  if (options.open !== false) {
    try {
      const url = craftHubProjectDesktopUrl(await identifyProjectReference(projectPath))
      await (options.openDesktop ?? openCraftHubDesktop)(url)
      return { kind: 'desktop', url }
    }
    catch {
      // A non-Git Project or unavailable protocol handler still works in the browser.
    }
  }

  const launch = await launchCraftHubApp(projectPath, options)
  return { kind: 'browser', ...launch }
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

import type { CraftHubRuntime, HostExtensionStatus } from 'craft-hub'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NativeNavigationService } from './native-navigation.ts'
import type { ProjectLaunchService } from './project-launch.ts'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import { openPersonalWorkbenchTool } from './open-targets.ts'
import { invokeProjectLaunch, projectLaunchActions } from './project-launch.ts'

const cookieName = 'craft-hub-host-session'
const hostPrefix = '/__craft_hub_host/'

/** Restricts the sidecar to its owning native client and the web view it bootstraps. */
export interface SidecarSessionGuard {
  setOrigin: (value: string) => void
  authorize: (request: IncomingMessage) => boolean
  bootstrap: (response: ServerResponse) => void
}

function sameSecret(value: string | null | undefined, secret: string): boolean {
  const candidate = Buffer.from(value ?? '')
  const expected = Buffer.from(secret)
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

/**
 * Accept one bootstrap request carrying the secret, then only requests on the loopback origin that present the
 * HttpOnly session cookie it set. The native client receives a separate API-only bearer token over the parent pipe;
 * it never enters a URL, web content, persistent storage, or a cookie. Both credentials expire with this process.
 */
export function createSessionGuard(secret: string, nativeApiToken?: string): SidecarSessionGuard {
  let origin: string | undefined
  let bootstrapped = false
  return {
    setOrigin(value: string): void {
      const parsed = new URL(value)
      if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1')
        throw new Error('The runtime sidecar must use IPv4 loopback')
      origin = parsed.origin
    },
    authorize(request: IncomingMessage): boolean {
      if (!origin || request.headers.host !== new URL(origin).host)
        return false
      if (request.headers.origin && request.headers.origin !== origin)
        return false
      if (request.headers.authorization !== undefined) {
        // A native token cannot bootstrap a browser session or reach host actions/static assets.
        const pathname = new URL(request.url ?? '/', origin).pathname
        return pathname.startsWith('/api/') && !!nativeApiToken
          && sameSecret(request.headers.authorization, `Bearer ${nativeApiToken}`)
      }
      const cookie = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))
      if (sameSecret(cookie?.slice(cookieName.length + 1), secret))
        return true
      if (!bootstrapped && request.method === 'GET' && request.url?.startsWith(`${hostPrefix}bootstrap?`)) {
        const url = new URL(request.url, origin)
        return url.pathname === `${hostPrefix}bootstrap` && sameSecret(url.searchParams.get('token'), secret)
      }
      return false
    },
    bootstrap(response: ServerResponse): void {
      bootstrapped = true
      response.writeHead(303, {
        'cache-control': 'no-store',
        'location': '/overview',
        'referrer-policy': 'no-referrer',
        'set-cookie': `${cookieName}=${secret}; HttpOnly; SameSite=Strict; Path=/`,
      })
      response.end()
    },
  }
}

/** Validate a browser destination before handing it to the operating system. */
export function externalUrl(value: unknown): string {
  if (typeof value !== 'string' || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    throw new Error('An HTTPS URL is required')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('An HTTPS URL without credentials is required')
  return url.href
}

/** Open a validated HTTPS URL in the default browser with a fixed executable and no shell. */
export function openInBrowser(url: string): Promise<void> {
  return openSystemTarget(externalUrl(url))
}

/** OS delivery for targets already resolved by the project launch service; never accepts a raw renderer path. */
export function openSystemTarget(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/open', ['--', target], { shell: false, stdio: 'ignore', timeout: 10_000 })
    child.once('error', () => reject(new Error('The requested application is unavailable')))
    child.once('close', code => code === 0 ? resolve() : reject(new Error('The requested application did not open the target')))
  })
}

/** Read a bounded JSON host request without accepting arrays or primitive values. */
export async function inputBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.byteLength
    if (size > 256 * 1024)
      throw new Error('Host action input is too large')
    chunks.push(buffer)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Host action input must be an object')
  return value as Record<string, unknown>
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

/** Native host management is limited to optional code already shipped in the application bundle. */
export interface SidecarBundledExtensions {
  status: () => Promise<HostExtensionStatus>
  setEnabled: (id: string, enabled: boolean) => Promise<HostExtensionStatus>
}

/**
 * Serve the bootstrap and the host actions that need runtime state. Operating-system actions such as dialogs and
 * the clipboard belong to the native host; these routes cover only what it cannot do without the runtime.
 */
export function createSidecarRequestHandler(
  guard: SidecarSessionGuard,
  getRuntime: () => Pick<CraftHubRuntime, 'settings'>,
  openTool: typeof openPersonalWorkbenchTool = openPersonalWorkbenchTool,
  openUrl: (url: string) => Promise<void> = openInBrowser,
  bundledExtensions?: SidecarBundledExtensions,
  projectLaunch?: ProjectLaunchService,
  navigation?: NativeNavigationService,
): (request: IncomingMessage, response: ServerResponse) => Promise<boolean> {
  return async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const pathname = url.pathname
    if (pathname === '/api/native-host/open-workbench-tool') {
      if (!request.headers.authorization || !guard.authorize(request)) {
        send(response, 403, { error: 'Native authorization is required' })
        return true
      }
      if (request.method !== 'POST' || request.headers['content-type']?.split(';')[0] !== 'application/json') {
        send(response, 405, { error: 'Use a JSON POST request' })
        return true
      }
      try {
        if (url.search)
          throw new Error('Query parameters are not accepted')
        const input = await inputBody(request)
        if (Object.keys(input).length !== 1 || typeof input.toolId !== 'string' || !input.toolId || input.toolId.length > 128)
          throw new Error('Only a saved tool identifier is accepted')
        const tool = (await getRuntime().settings.get()).settings['workbench.home'].tools.find(tool => tool.id === input.toolId)
        if (!tool)
          throw new Error('Unknown workbench tool')
        send(response, 200, await openTool(tool, openUrl))
      }
      catch (error) { send(response, 400, { error: error instanceof Error ? error.message : 'Tool could not be opened' }) }
      return true
    }
    if (pathname === '/api/native-host/extensions') {
      // This narrow native capability must never inherit the browser's cookie credential.
      if (!request.headers.authorization || !guard.authorize(request)) {
        send(response, 403, { error: 'Native authorization is required' })
        return true
      }
      try {
        if (!bundledExtensions)
          throw new Error('Bundled extension management is unavailable')
        if (request.method === 'GET') {
          send(response, 200, await bundledExtensions.status())
        }
        else if (request.method === 'PUT' && request.headers['content-type'] === 'application/json') {
          const input = await inputBody(request)
          if (typeof input.id !== 'string' || typeof input.enabled !== 'boolean')
            throw new Error('A bundled extension identifier and boolean state are required')
          send(response, 200, await bundledExtensions.setEnabled(input.id, input.enabled))
        }
        else {
          send(response, 405, { error: 'Only reading status and changing bundled choices are supported' })
        }
      }
      catch (error) {
        send(response, 400, { error: error instanceof Error ? error.message : 'Extension operation failed' })
      }
      return true
    }
    if (!pathname.startsWith(hostPrefix))
      return false
    if (pathname === `${hostPrefix}bootstrap` && request.method === 'GET') {
      guard.bootstrap(response)
      return true
    }
    // The custom header forces a CORS preflight, so only the bootstrapped page itself can call these actions.
    if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json' || request.headers['x-craft-hub-host'] !== '1') {
      send(response, 403, { error: 'Host actions require a same-origin JSON request' })
      return true
    }
    try {
      const input = await inputBody(request)
      const action = pathname.slice(hostPrefix.length)
      if (projectLaunch && projectLaunchActions.has(action)) {
        send(response, 200, { value: await invokeProjectLaunch(projectLaunch, action, input) })
        return true
      }
      switch (action) {
        case 'resolve-desktop-link': {
          if (!navigation)
            throw new Error('Desktop navigation is unavailable')
          send(response, 200, { value: await navigation.resolve(input.url) })
          return true
        }
        case 'verify-project-reference': {
          if (!navigation)
            throw new Error('Desktop navigation is unavailable')
          send(response, 200, { value: await navigation.verify(input.reference, input.path) })
          return true
        }
        case 'host-extensions': {
          if (!bundledExtensions)
            throw new Error('Bundled extension management is unavailable')
          send(response, 200, { value: await bundledExtensions.status() })
          return true
        }
        case 'set-host-extension-enabled': {
          if (!bundledExtensions || typeof input.id !== 'string' || typeof input.enabled !== 'boolean')
            throw new Error('A bundled extension identifier and boolean state are required')
          send(response, 200, { value: await bundledExtensions.setEnabled(input.id, input.enabled) })
          return true
        }
        case 'open-workbench-tool': {
          if (typeof input.toolId !== 'string')
            throw new Error('Workbench tool identifier is required')
          const home = (await getRuntime().settings.get()).settings['workbench.home']
          const tool = home.tools.find(tool => tool.id === input.toolId)
          if (!tool)
            throw new Error('Unknown workbench tool')
          send(response, 200, { value: await openTool(tool, openUrl) })
          return true
        }
        default:
          send(response, 404, { error: 'Unknown host action' })
          return true
      }
    }
    catch (error) {
      send(response, 400, { error: error instanceof Error ? error.message : 'Host action failed' })
      return true
    }
  }
}

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WorkbenchToolOpenResult } from '../../../packages/craft-hub/src/personal-workbench'
import type { CraftHubRuntime } from '../../../packages/craft-hub/src/runtime'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import process from 'node:process'

const cookieName = 'craft-hub-tauri-trial'
const hostPrefix = '/__craft_hub_host/'
const nativeChildren = new Set<ReturnType<typeof spawn>>()

/** Close owned native helpers before the backend drains pending HTTP actions. */
export function stopNativeActions(): void {
  for (const child of nativeChildren)
    child.kill()
}
process.once('exit', stopNativeActions)

function sameSecret(value: string | null | undefined, secret: string): boolean {
  const candidate = Buffer.from(value ?? '')
  const expected = Buffer.from(secret)
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

/** Restrict the entire trial API and static assets to one bootstrapped local session. */
export interface TrialSessionGuard {
  setOrigin: (value: string) => void
  authorize: (request: IncomingMessage) => boolean
  bootstrap: (response: ServerResponse) => void
}

export function createSessionGuard(secret: string): TrialSessionGuard {
  let origin: string | undefined
  let bootstrapped = false
  return {
    setOrigin(value: string): void {
      const parsed = new URL(value)
      if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1')
        throw new Error('The trial backend must use IPv4 loopback')
      origin = parsed.origin
    },
    authorize(request: IncomingMessage): boolean {
      if (!origin || request.headers.host !== new URL(origin).host)
        return false
      if (request.headers.origin && request.headers.origin !== origin)
        return false
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

/** Launch only a fixed executable and explicit arguments without a shell. */
export function runNative(command: string, args: string[], input?: string, launch: typeof spawn = spawn): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = launch(command, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    nativeChildren.add(child)
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', value => output += value)
    // Native diagnostics can contain user paths. Return only a fixed error to the UI.
    child.stderr.resume()
    child.once('error', () => reject(new Error('Native action is unavailable')))
    child.once('close', (code) => {
      nativeChildren.delete(child)
      if (code === 0)
        resolve(output.trim())
      else
        reject(new Error('Native action was cancelled or unavailable'))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

/** Validate external browser destinations before handing them to the OS. */
export function externalUrl(value: unknown): string {
  if (typeof value !== 'string' || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    throw new Error('An HTTPS URL is required')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('An HTTPS URL without credentials is required')
  return url.href
}

/** The browser receives a small capability object, without general Tauri IPC access. */
export const bridgeScript = `(() => {
  const invoke = async (action, input = {}) => {
    const response = await fetch('/__craft_hub_host/' + action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-craft-hub-host': '1' },
      body: JSON.stringify(input),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Native action failed')
    return result.value
  }
  Object.defineProperty(window, 'craftHubDesktop', { value: Object.freeze({
    platform: 'darwin',
    hostKind: 'tauri-trial',
    selectProjectDirectory: defaultPath => invoke('select-project-directory', { defaultPath }),
    selectProjectDirectories: defaultPath => invoke('select-project-directories', { defaultPath }),
    openProjectDirectory: projectId => invoke('open-project-directory', { projectId }),
    openExternalUrl: url => invoke('open-external-url', { url }),
    openWorkbenchTool: toolId => invoke('open-workbench-tool', { toolId }),
    copyText: text => invoke('copy-text', { text }),
  }) })
  // Bubble after Vue's known application handlers have had a chance to prevent navigation.
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0) return
    const link = event.target instanceof Element ? event.target.closest('a[target="_blank"]') : null
    if (!link) return
    const url = new URL(link.href, location.href)
    if (url.protocol !== 'https:' || url.username || url.password) return
    event.preventDefault()
    void invoke('open-external-url', { url: url.href }).catch(() => {
      let message = document.querySelector('[data-craft-hub-host-error]')
      if (!message) {
        message = document.createElement('p')
        message.dataset.craftHubHostError = 'true'
        message.setAttribute('role', 'alert')
        message.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:12px;background:#fff;color:#b42318;border:1px solid #b42318;z-index:99999'
        document.body.append(message)
      }
      message.textContent = 'Could not open the external link. Check your default browser.'
    })
  })
})()`

async function inputBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.byteLength
    if (size > 256 * 1024)
      throw new Error('Native action input is too large')
    chunks.push(buffer)
  }
  const input = Buffer.concat(chunks).toString('utf8')
  const value = JSON.parse(input || '{}')
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Native action input must be an object')
  return value as Record<string, unknown>
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

/** Dispatch a constrained native bridge after the shared server's session authorization. */
export function createHostRequestHandler(
  guard: ReturnType<typeof createSessionGuard>,
  getRuntime: () => CraftHubRuntime,
  openTool: (tool: unknown, openWebsite: (url: string) => Promise<void>) => Promise<WorkbenchToolOpenResult>,
  native: typeof runNative = runNative,
  folderPickerPath?: string,
): (request: IncomingMessage, response: ServerResponse) => Promise<boolean> {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (!pathname.startsWith(hostPrefix))
      return false
    if (pathname === `${hostPrefix}bootstrap` && request.method === 'GET') {
      guard.bootstrap(response)
      return true
    }
    if (pathname === `${hostPrefix}bridge.js` && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      response.end(bridgeScript)
      return true
    }
    if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json' || request.headers['x-craft-hub-host'] !== '1') {
      send(response, 403, { error: 'Native actions require a same-origin JSON request' })
      return true
    }
    try {
      const input = await inputBody(request)
      let value: unknown
      switch (pathname.slice(hostPrefix.length)) {
        case 'copy-text':
          if (typeof input.text !== 'string')
            throw new Error('Clipboard text must be a string')
          await native('/usr/bin/pbcopy', [], input.text)
          break
        case 'select-project-directory':
        case 'select-project-directories': {
          const multiple = pathname.endsWith('directories')
          if (!folderPickerPath)
            throw new Error('Native folder selection is unavailable')
          const args = multiple ? ['--multiple'] : []
          if (typeof input.defaultPath === 'string')
            args.push('--directory', input.defaultPath)
          const result: unknown = JSON.parse(await native(folderPickerPath, args))
          if (!Array.isArray(result) || !result.every(path => typeof path === 'string'))
            throw new Error('Native folder selection returned an invalid response')
          value = result.length ? (multiple ? result : result[0]) : undefined
          break
        }
        case 'open-project-directory': {
          if (typeof input.projectId !== 'string')
            throw new Error('Project identifier is required')
          const project = await getRuntime().projects.get(input.projectId)
          await native('/usr/bin/open', ['--', project.path])
          break
        }
        case 'open-external-url':
          await native('/usr/bin/open', ['--', externalUrl(input.url)])
          break
        case 'open-workbench-tool': {
          if (typeof input.toolId !== 'string')
            throw new Error('Workbench tool identifier is required')
          const home = (await getRuntime().settings.get()).settings['workbench.home']
          const tool = home.tools.find(tool => tool.id === input.toolId)
          if (!tool)
            throw new Error('Unknown workbench tool')
          value = await openTool(tool, async (url) => {
            await native('/usr/bin/open', ['--', externalUrl(url)])
          })
          break
        }
        default:
          send(response, 404, { error: 'Unknown native action' })
          return true
      }
      send(response, 200, { value })
    }
    catch (error) {
      send(response, 400, { error: error instanceof Error ? error.message : 'Native action failed' })
    }
    return true
  }
}

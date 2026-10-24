import type { HostExtension, HostExtensionManager, HostExtensionStatus } from 'craft-hub'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SidecarSessionGuard } from './sidecar-host.ts'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { HostExtensionChangedError } from 'craft-hub'
import { readDesktopHostExtension } from './host-extension-review.ts'
import { inputBody } from './sidecar-host.ts'

export interface NativeExtensionReview {
  id: string
  extension: HostExtension
  previous?: HostExtension
}
interface PendingReview { review: NativeExtensionReview, revision: string, expires: number }

/** Native-only installation reviews; a preview never imports code or persists a registration. */
export class NativeExtensionControls {
  private readonly reviews = new Map<string, PendingReview>()
  private preparing = 0
  private readonly manager: HostExtensionManager
  private readonly status: () => Promise<HostExtensionStatus>
  private readonly reservedIds: ReadonlySet<string>
  private readonly now: () => number

  constructor(
    manager: HostExtensionManager,
    status: () => Promise<HostExtensionStatus>,
    reservedIds: ReadonlySet<string>,
    now = Date.now,
  ) {
    this.manager = manager
    this.status = status
    this.reservedIds = reservedIds
    this.now = now
  }

  async preview(manifestPath: string): Promise<NativeExtensionReview> {
    if (!isAbsolute(manifestPath) || manifestPath.length > 4096 || manifestPath.includes('\0'))
      throw new Error('Select an absolute local distribution JSON path')
    for (const [id, pending] of this.reviews) {
      if (pending.expires <= this.now())
        this.reviews.delete(id)
    }
    if (this.reviews.size + this.preparing >= 8)
      throw new Error('Close an existing extension review before opening another')
    this.preparing += 1
    try {
      const { extension, revision } = await this.read(manifestPath)
      const previous = (await this.manager.status()).extensions.find(item => item.id === extension.id)
      const review = { id: randomUUID(), extension, ...(previous ? { previous } : {}) }
      if (Buffer.byteLength(JSON.stringify(review)) > 128 * 1024)
        throw new Error('This extension review is too large')
      this.reviews.set(review.id, { review, revision, expires: this.now() + 5 * 60_000 })
      return structuredClone(review)
    }
    finally { this.preparing -= 1 }
  }

  cancel(id: string): void { this.reviews.delete(id) }

  async install(reviewed: unknown): Promise<HostExtensionStatus> {
    const id = reviewed && typeof reviewed === 'object' && 'id' in reviewed ? reviewed.id : undefined
    const pending = typeof id === 'string' ? this.reviews.get(id) : undefined
    if (typeof id === 'string')
      this.reviews.delete(id) // Consume before awaiting; even a failed or ambiguous attempt requires a new review.
    if (!pending || pending.expires <= this.now() || !isDeepStrictEqual(pending.review, reviewed))
      throw new Error('This extension review expired or changed. Read the declaration again.')
    const latest = await this.read(pending.review.extension.manifestPath)
    if (latest.revision !== pending.revision || !isDeepStrictEqual(latest.extension, pending.review.extension))
      throw new HostExtensionChangedError()
    await this.manager.install(latest.extension, pending.review.previous ?? null)
    return this.status()
  }

  async setEnabled(expected: HostExtension, enabled: boolean): Promise<HostExtensionStatus> {
    if (enabled)
      this.assertExternal(expected.id)
    await this.manager.setEnabled(expected.id, enabled, expected)
    return this.status()
  }

  async remove(expected: HostExtension): Promise<HostExtensionStatus> {
    // A legacy conflicting registration can still be removed; this never changes the bundled component.
    await this.manager.remove(expected.id, expected)
    return this.status()
  }

  private assertExternal(id: string): void {
    if (this.reservedIds.has(id))
      throw new Error('This identifier belongs to a component shipped with the application')
  }

  private async read(path: string): Promise<{ extension: HostExtension, revision: string }> {
    const result = await readDesktopHostExtension(this.manager, await realpath(path))
    this.assertExternal(result.extension.id)
    if (result.extension.id.length > 128 || result.extension.name.length > 256)
      throw new Error('The extension identifier or name is too long')
    // Persist the canonical, displayed entry paths. Resolving or reading a module never evaluates it.
    const modules = await Promise.all(result.extension.modules.map(async (path) => {
      const canonical = await realpath(path)
      if (!(await stat(canonical)).isFile())
        throw new Error('Host entry modules must be regular files')
      return canonical
    }))
    if (new Set(modules).size !== modules.length)
      throw new Error('Host entry modules must resolve to distinct files')
    return { ...result, extension: { ...result.extension, modules } }
  }
}

/** Only the owning native app's bearer can review and mutate external registrations; web cookies are rejected. */
export function createNativeExtensionHandler(guard: SidecarSessionGuard, controls: NativeExtensionControls): (request: IncomingMessage, response: ServerResponse) => Promise<boolean> {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const prefix = '/api/native-host/external-extensions/'
    if (!url.pathname.startsWith(prefix))
      return false
    const send = (status: number, body: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify(body))
    }
    if (!request.headers.authorization || !guard.authorize(request)) {
      send(403, { error: 'Native authorization is required' })
      return true
    }
    if (request.method !== 'POST' || request.headers['content-type']?.split(';')[0] !== 'application/json') {
      send(405, { error: 'Use a JSON POST request' })
      return true
    }
    try {
      if (url.search)
        throw new Error('Query parameters are not accepted')
      const input = await inputBody(request)
      const action = url.pathname.slice(prefix.length)
      if (action === 'preview' && exact(input, ['manifestPath']) && typeof input.manifestPath === 'string') {
        send(200, await controls.preview(input.manifestPath))
      }
      else if (action === 'install' && exact(input, ['reviewed'])) {
        send(200, await controls.install(input.reviewed))
      }
      else if (action === 'cancel' && exact(input, ['id']) && typeof input.id === 'string') {
        controls.cancel(input.id)
        send(200, { cancelled: true })
      }
      else if ((action === 'enable' || action === 'remove') && exact(input, action === 'enable' ? ['expected', 'enabled'] : ['expected'])
        && input.expected && typeof input.expected === 'object' && 'id' in input.expected && typeof input.expected.id === 'string'
        && (action !== 'enable' || typeof input.enabled === 'boolean')) {
        const expected = input.expected as HostExtension // The manager validates and compares the complete saved registration.
        send(200, action === 'enable' ? await controls.setEnabled(expected, input.enabled as boolean) : await controls.remove(expected))
      }
      else { throw new Error('Invalid external extension action') }
    }
    catch (error) {
      send(error instanceof HostExtensionChangedError ? 409 : 400, { error: error instanceof Error ? error.message : 'Extension operation failed' })
    }
    return true
  }
}

function exact(input: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(input).length === keys.length && keys.every(key => Object.hasOwn(input, key))
}

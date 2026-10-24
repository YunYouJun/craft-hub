/** Fixed public diagnostics: upstream bodies, callbacks and key material must never enter host errors. */
export class PersonalCloudError extends Error {
  readonly code: 'configuration' | 'network' | 'response' | 'cancelled' | 'storage' | 'busy' | 'callback' | 'revocation'

  constructor(code: PersonalCloudError['code']) {
    const messages = {
      configuration: 'Personal cloud requires HTTPS API and web origins (HTTP is allowed only on loopback)',
      network: 'Personal cloud request failed or timed out',
      response: 'Personal cloud returned an invalid response',
      cancelled: 'Personal cloud operation was cancelled',
      storage: 'Personal cloud secure storage is unavailable; read its state again before continuing',
      busy: 'A personal cloud account operation is already in progress',
      callback: 'Unexpected personal cloud callback or expired challenge',
      revocation: 'Local device was disconnected, but cloud revocation could not be confirmed',
    }
    super(messages[code])
    this.code = code
  }
}

/** Canonicalize configuration before constructing any signed request or connection URL. */
export function personalCloudOrigin(value: string): string {
  try {
    if (hasCloudURLControl(value) || value.includes('\\') || !/^[a-z][a-z\d+.-]*:\/\/[^/?#]+\/?$/i.test(value))
      throw new PersonalCloudError('configuration')
    const url = new URL(value)
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.port === '0') {
      throw new PersonalCloudError('configuration')
    }
    return url.origin
  }
  catch { throw new PersonalCloudError('configuration') }
}

/** URL/configuration input must not contain raw whitespace or control characters. */
export function hasCloudURLControl(value: string): boolean {
  return [...value].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
}

/** Bounded JSON exchange; signed headers and adoption codes must never follow redirects. */
export async function personalCloudJSON<T>(url: URL, init: RequestInit, fetcher: typeof globalThis.fetch = globalThis.fetch, signal?: AbortSignal): Promise<T> {
  const deadline = AbortSignal.timeout(15_000)
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
  try {
    const response = await fetcher(url, { ...init, redirect: 'error', signal: combined })
    if (!response.ok || response.redirected) {
      await response.body?.cancel().catch(() => {})
      throw new PersonalCloudError('network')
    }
    const reader = response.body?.getReader()
    if (!reader)
      throw new PersonalCloudError('response')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        combined.throwIfAborted()
        const { done, value } = await reader.read()
        if (done)
          break
        length += value.byteLength
        if (length > 8 * 1024 * 1024)
          throw new PersonalCloudError('response')
        chunks.push(value)
      }
    }
    finally { await reader.cancel().catch(() => {}) }
    const data = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      data.set(chunk, offset)
      offset += chunk.byteLength
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)) as T
    }
    catch { throw new PersonalCloudError('response') }
  }
  catch (error) {
    if (signal?.aborted)
      throw new PersonalCloudError('cancelled')
    throw error instanceof PersonalCloudError ? error : new PersonalCloudError('network')
  }
}

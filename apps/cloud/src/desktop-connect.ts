/** Exact desktop callbacks supported by the cloud connection page, including the isolated native candidate. */
const callbacks = new Set(['craft-hub://cloud/connect', 'craft-hub-dev://cloud/connect', 'craft-hub-native://cloud/connect'])

export interface DesktopConnectInput { publicKey: string, challenge: string, callback: string }

function validated(value: unknown): DesktopConnectInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const input = value as Record<string, unknown>
  if (typeof input.publicKey !== 'string' || !input.publicKey || input.publicKey.length > 4096
    || typeof input.challenge !== 'string' || !/^[\w-]{1,128}$/.test(input.challenge)
    || typeof input.callback !== 'string' || !callbacks.has(input.callback)) {
    return undefined
  }
  return { publicKey: input.publicKey, challenge: input.challenge, callback: input.callback }
}

/** Read public connection parameters without accepting an arbitrary return URL. */
export function desktopConnectFromURL(url: URL): DesktopConnectInput | undefined {
  if (url.pathname !== '/connect' || ['public_key', 'challenge', 'callback'].some(key => url.searchParams.getAll(key).length !== 1))
    return undefined
  return validated({ publicKey: url.searchParams.get('public_key'), challenge: url.searchParams.get('challenge'), callback: url.searchParams.get('callback') })
}

/** Revalidate the stored callback after the authentication redirect before issuing a bootstrap or navigating. */
export function storedDesktopConnect(raw: string): DesktopConnectInput | undefined {
  if (raw.length > 8192)
    return undefined
  try {
    return validated(JSON.parse(raw))
  }
  catch { return undefined }
}

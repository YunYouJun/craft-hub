import type { IncomingMessage, ServerResponse } from 'node:http'

/** Public identity only; credentials must stay inside the trusted provider. */
export interface AccountIdentity {
  id: string
  name: string
  expiresAt: string
  /** Optional HTTPS profile image supplied by the trusted account provider. */
  avatarUrl?: string
}

/** A host-installed account adapter, independent of Marketplace permissions. */
export interface AccountProvider {
  id: string
  displayName: string
  mode: 'gateway' | 'local'
  required: boolean
  /** Canonical HTTPS origin for a reverse-proxied host. */
  publicOrigin?: string
  status: (request: IncomingMessage) => Promise<AccountIdentity | undefined>
  signIn?: () => Promise<{ authorizationUrl: string }>
  complete?: () => Promise<void>
  signOut?: () => Promise<void>
}

/** Handle account routes and enforce a configured host authentication boundary. */
export async function handleAccountRequest(provider: AccountProvider | undefined, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  const accountRoute = path.startsWith('/api/account')
  const json = (status: number, value: unknown): true => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify(value))
    return true
  }
  if (!provider)
    return accountRoute ? json(200, { enabled: false }) : false

  if (provider.mode === 'local' && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? ''))
    return json(403, { error: 'Local account access requires loopback' })

  // Reject cross-origin reads and writes before reaching provider state.
  const origin = provider.publicOrigin ?? `http://${request.headers.host}`
  const address = request.socket.localAddress
  if (!provider.publicOrigin && request.headers.host !== `${address?.includes(':') ? `[${address}]` : address}:${request.socket.localPort}`
    && request.headers.host !== `localhost:${request.socket.localPort}`) {
    return json(403, { error: 'Invalid request host' })
  }
  if ((request.headers.origin && request.headers.origin !== origin)
    || request.headers['sec-fetch-site'] === 'cross-site') {
    return json(403, { error: 'Cross-origin request rejected' })
  }
  if (accountRoute && request.method !== 'GET' && request.headers.origin !== origin)
    return json(403, { error: 'Account actions require a same-origin request' })

  try {
    if (accountRoute) {
      if (path === '/api/account' && request.method === 'GET') {
        const identity = await provider.status(request)
        return json(200, { enabled: true, provider: provider.displayName, mode: provider.mode, required: provider.required, identity, canSignIn: !!provider.signIn, canSignOut: !!provider.signOut })
      }
      if (request.method !== 'POST')
        return json(405, { error: 'Method not allowed' })
      if (path === '/api/account/sign-in' && provider.signIn)
        return json(200, await provider.signIn())
      if (path === '/api/account/complete' && provider.complete) {
        await provider.complete()
        return json(200, { ok: true })
      }
      if (path === '/api/account/sign-out' && provider.signOut) {
        await provider.signOut()
        return json(200, { ok: true })
      }
      return json(404, { error: 'Account action unavailable' })
    }
    if (provider.required && path.startsWith('/api/')) {
      const identity = await provider.status(request)
      if (!identity || !Number.isFinite(Date.parse(identity.expiresAt)) || Date.parse(identity.expiresAt) <= Date.now())
        return json(401, { error: 'Sign in with an authorized account to access this workbench' })
      // Streaming responses must not outlive the identity used to open them.
      const timer = setTimeout(() => response.end(), Math.min(Date.parse(identity.expiresAt) - Date.now(), 2147483647))
      timer.unref()
      response.once('close', () => clearTimeout(timer))
    }
    return false
  }
  catch {
    return json(401, { error: 'Account authentication failed' })
  }
}

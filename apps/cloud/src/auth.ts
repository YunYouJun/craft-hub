import { consumeSsoRedirect, startSsoRedirect } from '@yunlefun/sso'
import { CloudApiError, cloudRequest } from './api'

interface SessionResponse {
  csrf: string
  user: { userId: string }
}

export async function restoreSession(): Promise<SessionResponse | undefined> {
  const authorization = consumeSsoRedirect()
  if (authorization?.ok) {
    const [
      { default: cloudbase },
      { adoptSsoIdentityProof },
    ] = await Promise.all([
      import('@cloudbase/js-sdk/app'),
      import('@yunlefun/sso/browser'),
      import('@cloudbase/js-sdk/auth'),
    ])
    const app = cloudbase.init({
      env: import.meta.env.VITE_CLOUDBASE_ENV_ID,
      region: import.meta.env.VITE_CLOUDBASE_REGION,
      accessKey: import.meta.env.VITE_CLOUDBASE_PUBLISHABLE_KEY,
      persistence: 'none',
    })
    const auth = app.auth
    try {
      const proof = await adoptSsoIdentityProof({
        signInWithCustomTicket: getTicket => auth.signInWithCustomTicket(getTicket),
        async getSession() {
          const { data, error } = await auth.getSession()
          // The SDK now returns null for a missing session; the SSO adapter expects undefined.
          const session = data?.session
          return { error, data: { session: session ? { access_token: session.access_token, user: session.user ?? undefined } : undefined } }
        },
      }, authorization, { exchangeUrl: import.meta.env.VITE_YUNLEFUN_SSO_EXCHANGE_URL })
      return await cloudRequest<SessionResponse>('/v1/session/login', { method: 'POST', body: JSON.stringify(proof) })
    }
    finally {
      await auth.signOut()
    }
  }
  try {
    return await cloudRequest<SessionResponse>('/v1/session')
  }
  catch (error) {
    if (error instanceof CloudApiError && error.status === 401)
      return undefined
    throw error
  }
}

export async function login(): Promise<void> {
  await startSsoRedirect({
    clientId: import.meta.env.VITE_YUNLEFUN_SSO_CLIENT_ID,
    scope: ['identity:bootstrap'],
    redirectUri: import.meta.env.VITE_YUNLEFUN_REDIRECT_URI,
    prompt: 'consent',
  })
}

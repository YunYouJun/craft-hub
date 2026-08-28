import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  adoptSsoIdentityProof: vi.fn(),
  authModuleLoads: 0,
  cloudRequest: vi.fn(),
  consumeSsoRedirect: vi.fn(),
  init: vi.fn(),
  appModuleLoads: 0,
  signOut: vi.fn(),
}))

vi.mock('@cloudbase/js-sdk/app', () => {
  mocks.appModuleLoads += 1
  return { default: { init: mocks.init } }
})

vi.mock('@cloudbase/js-sdk/auth', () => {
  mocks.authModuleLoads += 1
  return {}
})

vi.mock('@yunlefun/sso', () => ({
  consumeSsoRedirect: mocks.consumeSsoRedirect,
  startSsoRedirect: vi.fn(),
}))

vi.mock('@yunlefun/sso/browser', () => ({
  adoptSsoIdentityProof: mocks.adoptSsoIdentityProof,
}))

vi.mock('./api', () => ({
  CloudApiError: class CloudApiError extends Error {
    constructor(message: string, readonly status: number) {
      super(message)
    }
  },
  cloudRequest: mocks.cloudRequest,
}))

describe('personal cloud authentication', () => {
  beforeEach(() => {
    mocks.adoptSsoIdentityProof.mockReset()
    mocks.cloudRequest.mockReset()
    mocks.consumeSsoRedirect.mockReset()
    mocks.init.mockReset()
    mocks.signOut.mockReset()
  })

  it('restores an existing session without loading the CloudBase authentication SDK', async () => {
    const { restoreSession } = await import('./auth')
    const session = { csrf: 'csrf-token', user: { userId: 'user-1' } }
    mocks.consumeSsoRedirect.mockReturnValue(undefined)
    mocks.cloudRequest.mockResolvedValue(session)

    await expect(restoreSession()).resolves.toEqual(session)
    expect(mocks.appModuleLoads).toBe(0)
    expect(mocks.authModuleLoads).toBe(0)
  })

  it('loads CloudBase only for an SSO callback and signs out the temporary identity', async () => {
    const { restoreSession } = await import('./auth')
    const authorization = { ok: true }
    const proof = { accessToken: 'access-token', identityAssertion: 'assertion', nonce: 'nonce' }
    const session = { csrf: 'csrf-token', user: { userId: 'user-1' } }
    mocks.consumeSsoRedirect.mockReturnValue(authorization)
    mocks.init.mockReturnValue({ auth: { signOut: mocks.signOut } })
    mocks.adoptSsoIdentityProof.mockResolvedValue(proof)
    mocks.cloudRequest.mockResolvedValue(session)

    await expect(restoreSession()).resolves.toEqual(session)
    expect(mocks.appModuleLoads).toBe(1)
    expect(mocks.authModuleLoads).toBe(1)
    expect(mocks.adoptSsoIdentityProof).toHaveBeenCalledWith(expect.anything(), authorization, expect.any(Object))
    expect(mocks.signOut).toHaveBeenCalledOnce()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createXiaomiCredentialStore } from '../src/storage'
import { cloudSession } from '../src/transport'

const vault = vi.hoisted(() => ({ getPassword: vi.fn(), setPassword: vi.fn(), deletePassword: vi.fn() }))
vi.mock('keytar', () => ({ default: vault }))
beforeEach(() => vi.resetAllMocks())

describe('xiaomi cloud system credentials', () => {
  it('separates host profiles and persists only scoped cloud credentials', async () => {
    const first = createXiaomiCredentialStore('/tmp/profile-one')
    const second = createXiaomiCredentialStore('/tmp/profile-two')
    const session = cloudSession('userId=1001; serviceToken=fixture; passToken=discard', 'https://i.mi.com')
    await first.save(session)
    await second.save(session)
    expect(vault.setPassword.mock.calls[0]?.[0]).not.toBe(vault.setPassword.mock.calls[1]?.[0])
    expect(vault.setPassword.mock.calls[0]?.[2]).not.toContain('passToken')
    vault.getPassword.mockResolvedValueOnce(vault.setPassword.mock.calls[0]?.[2])
    expect(await first.read()).toEqual(session)
    await first.clear()
    expect(vault.deletePassword).toHaveBeenCalledExactlyOnceWith(vault.setPassword.mock.calls[0]?.[0], 'connection')
  })

  it('fails closed on unavailable vaults or corrupted identities with safe errors', async () => {
    const store = createXiaomiCredentialStore('/tmp/profile-three')
    vault.getPassword.mockResolvedValueOnce(null)
    expect(await store.read()).toBeNull()
    vault.getPassword.mockResolvedValueOnce('{"accountId":"2002","origin":"https://i.mi.com","cookie":"userId=1001; serviceToken=fixture"}')
    await expect(store.read()).rejects.toMatchObject({ kind: 'credentials' })
    vault.getPassword.mockRejectedValueOnce(new Error('secret-in-keychain-error'))
    await expect(store.read()).rejects.toMatchObject({ kind: 'credentials', message: expect.not.stringContaining('secret-in-keychain-error') })
    vault.setPassword.mockRejectedValueOnce(new Error('access denied'))
    await expect(store.save(cloudSession('userId=1001; serviceToken=fixture', 'https://i.mi.com'))).rejects.toMatchObject({ kind: 'credentials' })
  })
})

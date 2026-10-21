import type { IntegrationConnectionStatus } from 'craft-hub'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiRequestError } from './api'
import { emitIntegrationChange, subscribeIntegrationChanges } from './integration-action-events'

const subscriptions: Array<() => void> = []

afterEach(() => {
  for (const unsubscribe of subscriptions.splice(0))
    unsubscribe()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function subscribe() {
  const listener = vi.fn()
  const unsubscribe = subscribeIntegrationChanges(listener)
  subscriptions.push(unsubscribe)
  return { listener, unsubscribe }
}

describe('integration action changes', () => {
  it('invalidates before a confirmed request starts and reports when its result is ready', async () => {
    const { listener } = subscribe()
    let finishRequest!: (response: Response) => void
    const fetch = vi.fn(() => new Promise<Response>((resolve) => {
      finishRequest = resolve
      expect(listener.mock.calls).toEqual([[{ integrationId: 'issues', phase: 'start' }]])
    }))
    vi.stubGlobal('fetch', fetch)

    const pending = api.invokeIntegrationAction<IntegrationConnectionStatus>('issues', 'connect', { account: 'second' }, 'project/one', true)
    expect(listener).toHaveBeenCalledTimes(1)
    const result: IntegrationConnectionStatus = { connected: true }
    finishRequest(Response.json(result))

    await expect(pending).resolves.toEqual(result)
    expect(fetch).toHaveBeenCalledWith('/api/projects/project%2Fone/integrations/issues/actions/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { account: 'second' }, confirmed: true }),
    })
    expect(listener.mock.calls).toEqual([
      [{ integrationId: 'issues', phase: 'start' }],
      [{ integrationId: 'issues', phase: 'settled' }],
    ])
  })

  it('does not invalidate cached data for unconfirmed reads', async () => {
    const { listener } = subscribe()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: true })))

    await api.invokeIntegrationAction('issues', 'connection.status')
    await api.invokeIntegrationAction('issues', 'work-items.list', {}, undefined, false)

    expect(listener).not.toHaveBeenCalled()
  })

  it('reports settlement after a rejected confirmed request and preserves the original error', async () => {
    const { listener } = subscribe()
    const failure = new Error('Connection interrupted')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure))

    await expect(api.invokeIntegrationAction('issues', 'connect', {}, undefined, true)).rejects.toBe(failure)

    expect(listener.mock.calls).toEqual([
      [{ integrationId: 'issues', phase: 'start' }],
      [{ integrationId: 'issues', phase: 'settled' }],
    ])
  })

  it('reports settlement for failed HTTP responses without hiding the API error', async () => {
    const { listener } = subscribe()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Account unavailable' }, { status: 409 })))

    await expect(api.invokeIntegrationAction('issues', 'connect', {}, undefined, true)).rejects.toEqual(new ApiRequestError('Account unavailable', 409))

    expect(listener.mock.calls).toEqual([
      [{ integrationId: 'issues', phase: 'start' }],
      [{ integrationId: 'issues', phase: 'settled' }],
    ])
  })

  it('releases subscriptions without affecting other listeners', () => {
    const first = subscribe()
    const second = subscribe()
    first.unsubscribe()
    first.unsubscribe()

    emitIntegrationChange({ integrationId: 'issues', phase: 'start' })

    expect(first.listener).not.toHaveBeenCalled()
    expect(second.listener).toHaveBeenCalledWith({ integrationId: 'issues', phase: 'start' })
  })

  it('keeps observer errors from suppressing requests or subsequent observers', async () => {
    const failure = new Error('Cache observer failed')
    subscriptions.push(subscribeIntegrationChanges(() => {
      throw failure
    }))
    const { listener } = subscribe()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetch = vi.fn().mockResolvedValue(Response.json({ connected: true }))
    vi.stubGlobal('fetch', fetch)

    await expect(api.invokeIntegrationAction('issues', 'connect', {}, undefined, true)).resolves.toEqual({ connected: true })

    expect(fetch).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith('Integration change listener failed', failure)
  })
})

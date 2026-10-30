// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api } from './api'
import { integrationMutationPending } from './integration-mutations'
import { createWorkbenchRouter } from './router'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  delete window.craftHubDesktop
  vi.unstubAllGlobals()
})

it('acknowledges native protection before submitting and blocks browser navigation until the outcome arrives', async () => {
  const router = createWorkbenchRouter(createMemoryHistory())
  await router.push('/workbenches')
  const acknowledgement = deferred<void>()
  const response = deferred<Response>()
  const report = vi.fn().mockImplementationOnce(() => acknowledgement.promise).mockResolvedValue(undefined)
  window.craftHubDesktop = { setWorkbenchOperationPending: report }
  const fetcher = vi.fn(() => response.promise)
  vi.stubGlobal('fetch', fetcher)
  const saving = api.invokeIntegrationAction('fixture', 'save', { value: 'draft' }, 'project', true)
  await flushPromises()
  expect(report).toHaveBeenCalledWith(true)
  expect(fetcher).not.toHaveBeenCalled()
  await router.push('/integrations/fixture/items')
  expect(router.currentRoute.value.path).toBe('/workbenches')
  acknowledgement.resolve()
  await flushPromises()
  expect(fetcher).toHaveBeenCalledWith('/api/projects/project/integrations/fixture/actions/save', expect.objectContaining({ body: JSON.stringify({ input: { value: 'draft' }, confirmed: true }) }))
  response.resolve(new Response(JSON.stringify({ items: [] })))
  await saving
  expect(integrationMutationPending()).toBe(false)
  expect(report).toHaveBeenLastCalledWith(false)
  await router.push('/integrations/fixture/items')
  expect(router.currentRoute.value.path).toBe('/integrations/fixture/items')
})

it('keeps the host protected until every concurrent write settles, including writes without cache broadcasts', async () => {
  const first = deferred<Response>()
  const second = deferred<Response>()
  const report = vi.fn().mockResolvedValue(undefined)
  window.craftHubDesktop = { setWorkbenchOperationPending: report }
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise))
  const a = api.invokeIntegrationAction('fixture', 'save', {}, undefined, true)
  const b = api.invokeIntegrationAction('fixture', 'save', {}, undefined, true, { broadcast: false })
  await flushPromises()
  first.resolve(new Response(JSON.stringify({ items: [] })))
  await a
  expect(integrationMutationPending()).toBe(true)
  expect(report).toHaveBeenLastCalledWith(true)
  second.resolve(new Response(JSON.stringify({ items: [] })))
  await b
  expect(report).toHaveBeenLastCalledWith(false)
  expect(integrationMutationPending()).toBe(false)
})

it('does not submit after a native protection failure and releases navigation after a failed request', async () => {
  const report = vi.fn().mockRejectedValueOnce(new Error('host unavailable')).mockResolvedValue(undefined)
  window.craftHubDesktop = { setWorkbenchOperationPending: report }
  const fetcher = vi.fn().mockRejectedValue(new Error('connection lost'))
  vi.stubGlobal('fetch', fetcher)
  await expect(api.invokeIntegrationAction('fixture', 'save', {}, undefined, true)).rejects.toThrow('host unavailable')
  expect(fetcher).not.toHaveBeenCalled()
  expect(integrationMutationPending()).toBe(false)
  await expect(api.invokeIntegrationAction('fixture', 'save', {}, undefined, true)).rejects.toThrow('connection lost')
  expect(report).toHaveBeenLastCalledWith(false)
  expect(integrationMutationPending()).toBe(false)
})

it('keeps ordinary reads available in browsers without claiming a native mutation', async () => {
  const report = vi.fn()
  window.craftHubDesktop = { setWorkbenchOperationPending: report }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }))))
  await api.invokeIntegrationAction('fixture', 'read')
  expect(report).not.toHaveBeenCalled()
  expect(integrationMutationPending()).toBe(false)
})

import type { IntegrationBrowserAuthorization, IntegrationConnectionStatus } from '../src/integrations'
import { expect, it, vi } from 'vitest'
import { IntegrationRegistry } from '../src/integrations'

const browser: IntegrationBrowserAuthorization = { title: 'Sign in', url: 'https://cloud.example.com/notes', allowedOrigins: ['https://cloud.example.com', 'https://login.example.com'], cookieOrigin: 'https://cloud.example.com', cookieNames: ['userId', 'session'], requiredCookieGroups: [['userId'], ['session']], cookieField: 'cookie', originField: 'origin' }

it('validates inert browser authorization without opening a browser or executing connection writes', async () => {
  let policy = browser
  const update = vi.fn(async (): Promise<IntegrationConnectionStatus> => ({ connected: true }))
  const registry = new IntegrationRegistry([{ id: 'fixture', apiVersion: '1.0.0', connection: { update }, connectionStatus: async () => ({ connected: false, forms: [{ id: 'cookie', title: 'Connect', submitLabel: 'Save', browserAuthorization: policy, fields: [{ id: 'cookie', type: 'password', label: 'Cookie' }, { id: 'origin', type: 'text', label: 'Origin', value: 'https://cloud.example.com' }] }] }) }])
  const contribution = registry.resolve([{ id: 'fixture', pluginId: 'fixture', source: 'host:fixture', provider: { id: 'fixture', requires: '^1.0.0' }, views: [], actions: [
    { id: 'status', title: 'Status', operation: 'connection.status', effect: 'remote-read', confirmation: 'never' },
    { id: 'connect', title: 'Connect', operation: 'connection.update', effect: 'local-write', confirmation: 'always' },
  ] }]).integrations[0]!
  expect(await registry.invoke({ contribution, actionId: 'status' })).toMatchObject({ forms: [{ browserAuthorization: browser }] })
  expect(update).not.toHaveBeenCalled()
  await expect(registry.invoke({ contribution, actionId: 'connect' })).rejects.toThrow(/confirmation/i)
  for (const patch of [
    { url: 'http://cloud.example.com/notes' },
    { url: 'https://user:pass@cloud.example.com/notes' },
    { cookieOrigin: 'https://other.example.com' },
    { allowedOrigins: ['https://cloud.example.com/path'] },
    { requiredCookieGroups: [['unlisted-secret']] },
    { cookieField: 'origin' },
  ]) {
    policy = { ...browser, ...patch }
    await expect(registry.invoke({ contribution, actionId: 'status' })).rejects.toThrow()
  }
  expect(update).not.toHaveBeenCalled()
})

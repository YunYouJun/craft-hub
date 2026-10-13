import type { HostDiagnosticProvider, HostDiagnosticReport } from '../src/diagnostics'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { readHostDiagnosticProviders } from '../src/diagnostics'
import { defineCraftHubPlugin, loadCraftHubPlugins } from '../src/plugins'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

const checkedAt = '2026-10-13T06:00:00.000Z'

function report(): HostDiagnosticReport {
  return {
    version: 1,
    checkedAt,
    metadata: { version: '1.2.3', platform: 'linux' },
    checks: [
      { code: 'runtime.ready', severity: 'info', message: 'Runtime is available' },
      { code: 'config.missing', severity: 'warning', message: 'Choose a configuration repository', path: '/config', target: { type: 'integration', integrationId: 'environment' } },
    ],
  }
}

function provider(value: unknown, id = 'environment'): HostDiagnosticProvider {
  // Simulate JSON returned by an external executable, including invalid typed data.
  return { id, title: 'Environment', read: async () => JSON.parse(JSON.stringify(value)) }
}

describe('host diagnostic provider boundary', () => {
  it('validates and strips reports, computing counts from checks instead of claimed summaries', async () => {
    const value = Object.assign(report(), {
      summary: { errors: 0, warnings: 0, passed: 200 },
      token: 'private-token',
      metadata: { version: '1.2.3', platform: 'linux', secret: 'private-cookie' },
    })
    const result = await readHostDiagnosticProviders([{ pluginId: 'host', provider: provider(value) }], true)

    expect(result).toEqual([{
      provider: { id: 'host:environment', pluginId: 'host', title: 'Environment', state: 'ready', checkedAt, summary: { errors: 0, warnings: 1, passed: 1 }, metadata: { version: '1.2.3', platform: 'linux' } },
      checks: report().checks,
    }])
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it.each([
    ['wrong version', { ...report(), version: 2 }],
    ['invalid timestamp', { ...report(), checkedAt: 'today' }],
    ['too many checks', { ...report(), checks: Array.from({ length: 201 }, () => report().checks[0]) }],
    ['oversized message', { ...report(), checks: [{ ...report().checks[0], message: 'x'.repeat(2001) }] }],
    ['control characters', { ...report(), checks: [{ ...report().checks[0], message: 'warning\u001B[2J' }] }],
    ['oversized path', { ...report(), checks: [{ ...report().checks[0], path: '/'.repeat(4097) }] }],
    ['unknown severity', { ...report(), checks: [{ ...report().checks[0], severity: 'debug' }] }],
    ['invalid target', { ...report(), checks: [{ ...report().checks[0], target: { type: 'url', url: 'javascript:alert(1)' } }] }],
    ['missing integration id', { ...report(), checks: [{ ...report().checks[0], target: { type: 'integration' } }] }],
    ['invalid count', { ...report(), summary: { errors: -1, warnings: 0, passed: 1 } }],
    ['oversized version', { ...report(), metadata: { version: 'x'.repeat(129) } }],
  ])('isolates %s without returning the raw report', async (_description, value) => {
    const result = await readHostDiagnosticProviders([{ pluginId: 'host', provider: provider(value) }], true)
    expect(result).toEqual([{
      provider: { id: 'host:environment', pluginId: 'host', title: 'Environment', state: 'error', message: 'Diagnostic provider could not complete. Refresh to retry.' },
      checks: [],
    }])
  })

  it('reports empty results without claiming readiness, even if the source claims success', async () => {
    const [result] = await readHostDiagnosticProviders([{ pluginId: 'host', provider: provider({ ...report(), checks: [], summary: { errors: 0, warnings: 0, passed: 100 } }) }], true)
    expect(result.provider).toMatchObject({ state: 'empty', summary: { errors: 0, warnings: 0, passed: 0 } })
  })

  it('bounds an unresponsive provider and discards its timeout details', async () => {
    vi.useFakeTimers()
    try {
      const result = readHostDiagnosticProviders([{ pluginId: 'host', provider: { id: 'slow', title: 'Slow', read: () => new Promise(() => {}) } }], true)
      await vi.advanceTimersByTimeAsync(15_000)
      await expect(result).resolves.toMatchObject([{ provider: { state: 'error', message: 'Diagnostic provider could not complete. Refresh to retry.' }, checks: [] }])
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('validates declarations during host plugin loading', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-diagnostic-loader-'))
    const invalid = join(root, 'invalid.mjs')
    const valid = join(root, 'valid.mjs')
    await writeFile(invalid, 'export default { id: "invalid", diagnosticProviders: [{ id: "unsafe", title: "Unsafe", read: "not-a-function" }] }')
    await writeFile(valid, 'export default { id: "valid", diagnosticProviders: [{ id: "doctor", title: "Doctor", localOnly: true, read: async () => ({ version: 1, checkedAt: "2026-10-13T06:00:00.000Z", checks: [] }) }] }')
    const result = await loadCraftHubPlugins([invalid, valid])
    expect(result.plugins.map(plugin => plugin.id)).toEqual(['valid'])
    expect(result.diagnostics).toMatchObject([{ pluginId: invalid, phase: 'load', message: expect.stringContaining('invalid diagnostic provider') }])
  })
})

describe('host diagnostics runtime and HTTP API', () => {
  it('isolates provider failures and preserves other host diagnostics and owning targets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-host-diagnostics-'))
    const runtime = new CraftHubRuntime({
      dataDir: join(root, 'data'),
      configDir: join(root, 'config'),
      pluginDiagnostics: [{ pluginId: './other.mjs', phase: 'load', message: 'Other host failed' }],
      plugins: [defineCraftHubPlugin({
        id: 'host',
        diagnosticProviders: [provider(report()), { id: 'broken', title: 'Broken', read: async () => { throw new Error('secret-token-in-error') } }],
      })],
    })
    const app = await startCraftHubServer({ port: 0, runtime })
    try {
      const response = await fetch(`${app.url}/api/diagnostics`)
      expect(response.status).toBe(200)
      const snapshot = await response.json()
      expect(snapshot.summary).toEqual({ errors: 2, warnings: 1 })
      expect(snapshot.providers).toMatchObject([
        { id: 'host:environment', state: 'ready', metadata: { version: '1.2.3', platform: 'linux' }, summary: { errors: 0, warnings: 1, passed: 1 } },
        { id: 'host:broken', state: 'error' },
      ])
      expect(snapshot.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'host-provider', subject: 'Environment', providerId: 'host:environment', code: 'config.missing', severity: 'warning', path: '/config', target: { type: 'integration', integrationId: 'environment' } }),
        expect.objectContaining({ kind: 'host-plugin', message: 'Other host failed' }),
        expect.objectContaining({ kind: 'host-provider', subject: 'Broken', severity: 'error', message: 'Diagnostic provider could not complete. Refresh to retry.' }),
      ]))
      expect(JSON.stringify(snapshot)).not.toContain('secret-token')
    }
    finally {
      await app.close()
    }
  })

  it('never invokes local diagnostics on a hosted server while retaining remote checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-hosted-diagnostics-'))
    const localRead = vi.fn(async () => report())
    const remoteRead = vi.fn(async () => report())
    const runtime = new CraftHubRuntime({
      dataDir: join(root, 'data'),
      configDir: join(root, 'config'),
      hostEnvironment: 'hosted',
      plugins: [{ id: 'host', diagnosticProviders: [
        { id: 'local', title: 'Local', localOnly: true, read: localRead },
        { id: 'remote', title: 'Remote', read: remoteRead },
      ] }],
    })
    const snapshot = await runtime.diagnosticSnapshot()
    expect(localRead).not.toHaveBeenCalled()
    expect(remoteRead).toHaveBeenCalledOnce()
    expect(snapshot.providers).toMatchObject([{ id: 'host:local', state: 'skipped' }, { id: 'host:remote', state: 'ready' }])
    expect(snapshot.diagnostics).toHaveLength(1)
  })
})

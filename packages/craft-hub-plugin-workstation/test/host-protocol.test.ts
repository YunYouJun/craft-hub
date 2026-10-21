import type { WorkstationTransport } from '../src/index'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { CraftHubRuntime } from 'craft-hub'
import { describe, expect, it, vi } from 'vitest'
import { configurationOperations, softwareOperations, WorkstationHostError } from '../src/host-support'
import { createWorkstationPlugin, workstationTransport } from '../src/index'

function capabilities(platform = 'darwin') {
  return {
    version: 1,
    cliVersion: '0.1.0',
    platform,
    protocols: { host: 1, configuration: 1, software: 1 },
    operations: {
      configuration: Object.fromEntries(configurationOperations.map(operation => [operation, { supported: platform !== 'win32' || ['inspect', 'history', 'git-status'].includes(operation), ...(platform === 'win32' && !['inspect', 'history', 'git-status'].includes(operation) ? { reason: 'unsupported-platform' } : {}) }])),
      software: Object.fromEntries(softwareOperations.map(operation => [operation, { supported: platform === 'darwin' || !['install', 'open', 'cancel'].includes(operation), ...(platform !== 'darwin' && ['install', 'open', 'cancel'].includes(operation) ? { reason: 'unsupported-platform' } : {}) }])),
      doctor: { supported: true },
    },
  }
}
const doctor = { version: 1, checkedAt: '2026-10-13T00:00:00.000Z', checks: [
  { code: 'git-available', severity: 'info', message: 'Git is available.' },
  { code: 'apm-missing', severity: 'warning', message: 'APM is unavailable.', path: '/fixture/apm.yml' },
], summary: { errors: 0, warnings: 1, passed: 1 } }
const catalog = { version: 1, source: { id: 'workstation', title: 'Workstation', url: 'https://github.com/YunYouJun/workstation' }, items: [
  { id: 'magpie', title: { en: 'Magpie' }, group: { id: 'agents', title: { en: 'Agents' } }, url: 'https://usemagpie.ai/', installation: { kind: 'brew-cask', packageId: 'magpie' }, status: 'detected', canInstall: true, canOpen: true },
] }
function transports(hostResult: Record<string, unknown> = capabilities()) {
  const configuration = vi.fn<WorkstationTransport>(async request => ({ version: 1, ...(request.operation === 'inspect' ? { items: [] } : request.operation === 'history' ? { plans: [{ planId: 'previous-plan', state: 'applied' }] } : { repositories: [] }) }))
  const software = vi.fn<WorkstationTransport>(async () => catalog)
  const host = vi.fn<WorkstationTransport>(async request => request.operation === 'doctor' ? doctor : hostResult)
  return { configuration, software, host, plugin: createWorkstationPlugin(configuration, software, host) }
}

describe('workstation host protocol integration', () => {
  it('negotiates real connection identity and copies doctor observations into the diagnostic center', async () => {
    const { host, plugin } = transports()
    const status = await plugin.integrationProviders![0].connectionStatus({})
    expect(status).toEqual({ connected: true, accountLabel: 'Workstation 0.1.0 · darwin' })
    const directory = await mkdtemp(join(tmpdir(), 'craft-host-doctor-'))
    try {
      const runtime = new CraftHubRuntime({ dataDir: directory, configDir: join(directory, 'config'), plugins: [plugin] })
      const snapshot = await runtime.diagnosticSnapshot()
      expect(snapshot.providers).toContainEqual(expect.objectContaining({ title: 'Workstation', state: 'ready', metadata: { version: '0.1.0', platform: 'darwin' }, summary: { errors: 0, warnings: 1, passed: 1 } }))
      expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({ kind: 'host-provider', code: 'apm-missing', path: '/fixture/apm.yml', target: { type: 'integration', integrationId: 'workstation' } }))
      expect(host.mock.calls.map(([request]) => request.operation)).toEqual(['capabilities', 'capabilities', 'doctor'])
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('keeps legacy inventories and recovery readable but refuses every management request without negotiation', async () => {
    const { configuration, software, host, plugin } = transports()
    host.mockRejectedValue(new WorkstationHostError('unsupported'))
    const management = plugin.integrationProviders![0].configurationManagement!
    const page = await management.read({}, {})
    expect(page.operationSupport).toMatchObject({ state: 'unsupported', message: expect.stringContaining('Update the local CLI') })
    expect(page.history).toEqual([{ planId: 'previous-plan', state: 'applied' }])
    configuration.mockClear()
    await expect(management.update({ confirmed: true }, { operation: 'preview', decisions: [] })).rejects.toThrow('unavailable on this platform or CLI version')
    await expect(management.update({ confirmed: true }, { operation: 'apply', planId: 'plan' })).rejects.toThrow('unavailable on this platform or CLI version')
    await expect(management.update({ confirmed: true }, { operation: 'restore', planId: 'plan' })).rejects.toThrow('unavailable on this platform or CLI version')
    await expect(management.execute({ confirmed: true }, { operation: 'git-action', action: 'publish' })).rejects.toThrow('unavailable on this platform or CLI version')
    await expect(plugin.softwareCatalogProviders![0].management!.open('magpie')).rejects.toMatchObject({ status: 403 })
    await expect(plugin.softwareCatalogProviders![0].management!.install('plan', true)).rejects.toMatchObject({ status: 403 })
    expect(configuration).not.toHaveBeenCalled()
    expect(software).not.toHaveBeenCalled()
    expect(await plugin.integrationProviders![0].connectionStatus({})).toMatchObject({ connected: false })
  })

  it.each(['linux', 'win32'])('intersects catalog flags with %s operations and blocks forged launch/install calls', async (platform) => {
    const { software, plugin } = transports(capabilities(platform))
    const provider = plugin.softwareCatalogProviders![0]
    expect(await provider.read()).toMatchObject({ operationSupport: { state: 'available', platform }, items: [{ canInstall: false, canOpen: false }] })
    software.mockClear()
    await expect(provider.management!.open('magpie')).rejects.toMatchObject({ status: 403 })
    await expect(provider.management!.install('plan', true)).rejects.toMatchObject({ status: 403 })
    expect(software).not.toHaveBeenCalled()
    if (platform === 'win32') {
      await expect(plugin.integrationProviders![0].configurationManagement!.execute({ confirmed: true }, { operation: 'git-action', action: 'fetch' })).rejects.toThrow('unavailable on this platform or CLI version')
    }
  })

  it('rechecks current CLI capabilities before using a previously reviewed plan', async () => {
    const { configuration, host, plugin } = transports()
    const management = plugin.integrationProviders![0].configurationManagement!
    expect((await management.read({}, {})).operationSupport?.operations.apply?.supported).toBe(true)
    configuration.mockClear()
    host.mockResolvedValue(capabilities('win32'))
    await expect(management.update({ confirmed: true }, { operation: 'apply', planId: 'previous-plan' })).rejects.toThrow('unavailable on this platform or CLI version')
    expect(configuration).not.toHaveBeenCalled()
  })

  it('negotiates protocol versions separately and does not invoke an incompatible configuration protocol', async () => {
    const result = capabilities()
    result.protocols.configuration = 2
    result.operations.configuration = {}
    const { configuration, plugin } = transports(result)
    const page = await plugin.integrationProviders![0].configurationManagement!.read({}, {})
    expect(page.items).toEqual([])
    expect(page.operationSupport?.operations.inspect).toEqual({ supported: false, reason: 'unsupported-version' })
    expect(page.operationSupport?.operations['software-open']?.supported).toBe(true)
    expect(configuration).not.toHaveBeenCalled()
  })

  it.each(['incompatible protocol', 'unsupported catalog'])('uses the bundled fallback without dispatching a catalog read for %s', async (reason) => {
    const result = capabilities()
    if (reason === 'incompatible protocol') {
      result.protocols.software = 2
      result.operations.software = {}
    }
    else {
      result.operations.software.catalog = { supported: false, reason: 'unsupported-platform' }
    }
    const { software, plugin } = transports(result)
    await expect(plugin.softwareCatalogProviders![0].read()).rejects.toMatchObject({ status: 403 })
    const directory = await mkdtemp(join(tmpdir(), 'craft-host-catalog-fallback-'))
    try {
      const runtime = new CraftHubRuntime({ dataDir: directory, configDir: join(directory, 'config'), plugins: [plugin] })
      const source = (await runtime.softwareCatalogSnapshot()).sources.find(source => source.id === 'workstation')!
      expect(source.bundled).toBe(true)
      expect(source.canManage).not.toBe(true)
      expect(source.items.length).toBeGreaterThan(0)
      expect(source.items.every(item => item.canInstall === false && item.canOpen === false)).toBe(true)
      expect(software).not.toHaveBeenCalled()
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })

  it.each(['unsupported', 'unavailable'] as const)('preserves read-only catalog access when negotiation is %s', async (code) => {
    const { software, host, plugin } = transports()
    host.mockRejectedValue(new WorkstationHostError(code))
    expect(await plugin.softwareCatalogProviders![0].read()).toMatchObject({
      operationSupport: { state: code },
      items: [{ canInstall: false, canOpen: false }],
    })
    expect(software).toHaveBeenCalledExactlyOnceWith({ operation: 'catalog' })
  })

  it('coalesces only concurrent capability reads and refreshes on subsequent requests', async () => {
    const { configuration, software } = transports()
    let resolve!: (value: Record<string, unknown>) => void
    const host = vi.fn<WorkstationTransport>(() => new Promise((done) => {
      resolve = done
    }))
    const plugin = createWorkstationPlugin(configuration, software, host)
    const reads = [plugin.integrationProviders![0].configurationManagement!.read({}, {}), plugin.softwareCatalogProviders![0].read()]
    expect(host).toHaveBeenCalledOnce()
    resolve(capabilities())
    await Promise.all(reads)
    host.mockResolvedValue(capabilities())
    await plugin.softwareCatalogProviders![0].read()
    expect(host).toHaveBeenCalledTimes(2)
  })

  it('isolates malformed capability or doctor results without exposing raw diagnostics', async () => {
    const { host, plugin } = transports()
    host.mockResolvedValue({ version: 1, cliVersion: 'private fixture diagnostic' })
    const page = await plugin.integrationProviders![0].configurationManagement!.read({}, {})
    expect(page.operationSupport?.state).toBe('unavailable')
    expect(JSON.stringify(page)).not.toContain('private fixture diagnostic')
    host.mockImplementation(async request => request.operation === 'capabilities' ? capabilities() : { ...doctor, checks: [{ code: 'parser', severity: 'fatal', message: 'private fixture diagnostic' }] })
    await expect(plugin.diagnosticProviders![0].read()).rejects.toThrow('doctor response is invalid')
  })

  it('never probes the local CLI from hosted diagnostics or connection status', async () => {
    const { configuration, software, host, plugin } = transports()
    const directory = await mkdtemp(join(tmpdir(), 'craft-hosted-doctor-'))
    try {
      const runtime = new CraftHubRuntime({ dataDir: directory, configDir: join(directory, 'config'), hostEnvironment: 'hosted', plugins: [plugin] })
      const snapshot = await runtime.diagnosticSnapshot()
      expect(snapshot.providers).toContainEqual(expect.objectContaining({ title: 'Workstation', state: 'skipped' }))
      expect(await plugin.integrationProviders![0].connectionStatus({ hostEnvironment: 'hosted' })).toMatchObject({ connected: false })
      expect(host).not.toHaveBeenCalled()
      expect(configuration).not.toHaveBeenCalled()
      expect(software).not.toHaveBeenCalled()
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })

  it.each([
    { body: { ok: false, code: 'UNSUPPORTED_OPERATION', error: 'private fixture diagnostic' }, exit: 1, code: 'unsupported' },
    { body: { ok: false, code: 'UNAVAILABLE', error: 'private fixture diagnostic' }, exit: 1, code: 'unavailable' },
    { body: { ok: true, result: capabilities() }, exit: 1, code: 'unavailable' },
  ])('maps actual process envelopes to fixed host errors', async ({ body, exit, code }) => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-host-envelope-'))
    try {
      const script = join(directory, 'host.cjs')
      await writeFile(script, `process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write(${JSON.stringify(JSON.stringify(body))}); process.exitCode = ${exit} })`)
      const call = workstationTransport(process.execPath, [script], 'host-json')
      await expect(call({ operation: 'capabilities' })).rejects.toMatchObject({ code, message: expect.not.stringContaining('private fixture diagnostic') })
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
})

it('keeps older v1 hosts usable while disabling additive multi-repository operations', async () => {
  const fixture = capabilities('darwin')
  for (const key of ['repositories', 'repositories-update', 'backup-preview']) delete fixture.operations.configuration[key]
  const { plugin, configuration } = transports(fixture)
  const management = plugin.integrationProviders![0].configurationManagement!
  const page = await management.read({}, {})
  expect(page.operationSupport?.state).toBe('available')
  expect(page.operationSupport?.operations['repositories-update']).toEqual({ supported: false, reason: 'unsupported-version' })
  configuration.mockClear()
  await expect(management.update({ confirmed: true }, { operation: 'repositories-update', registry: {} })).rejects.toThrow('unavailable')
  expect(configuration).not.toHaveBeenCalled()
})

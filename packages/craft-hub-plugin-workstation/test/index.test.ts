import type { WorkstationTransport } from '../src/index'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { CraftHubRuntime } from 'craft-hub'
import { describe, expect, it, vi } from 'vitest'
import { configurationOperations, softwareOperations } from '../src/host-support'
import { createWorkstationPlugin as createPlugin, workstationTransport } from '../src/index'

function createWorkstationPlugin(configuration?: WorkstationTransport, software?: WorkstationTransport) {
  const host = vi.fn(async () => ({ version: 1, cliVersion: '0.1.0', platform: 'darwin', protocols: { host: 1, configuration: 1, software: 1 }, operations: {
    configuration: Object.fromEntries(configurationOperations.map(operation => [operation, { supported: true }])),
    software: Object.fromEntries(softwareOperations.map(operation => [operation, { supported: true }])),
    doctor: { supported: true },
  } }))
  return createPlugin(configuration, software, host)
}

const transport = () => vi.fn(async (request: Record<string, unknown>) => ({ version: 1, ...(request.operation === 'inspect' ? { items: [] } : request.operation === 'history' ? { plans: [] } : { repositories: [] }) }))
const configurationItem = {
  id: 'shared-skill',
  title: 'Shared skill',
  kind: 'skill',
  owner: 'external-installer',
  origin: 'local',
  localPath: '/fixture/agents/skills/shared',
  status: 'external-managed',
  revision: 'revision-1',
  local: '[managed by external installer]',
  source: '',
  fields: [],
  management: 'installer-owned',
}
const audit = {
  state: 'available',
  checkedAt: '2026-10-13T00:00:00.000Z',
  summary: { skillFileCount: 3, implicitSkillCount: 2, explicitOnlySkillCount: 1, warningCount: 1, errorCount: 0 },
  findings: [{ code: 'duplicate-skill-name', severity: 'warning', message: 'The skill name has multiple observed locations.', paths: ['/fixture/agents/skills/shared', '/fixture/project/.agents/skills/shared'] }],
}

function configurationTransport(items: unknown[] = [configurationItem], skillsAudit?: unknown) {
  return vi.fn(async (request: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (request.operation === 'inspect')
      return { version: 1, items, ...(skillsAudit === undefined ? {} : { skillsAudit }) }
    if (request.operation === 'history')
      return { version: 1, plans: [{ planId: 'previous-plan', state: 'applied' }] }
    if (request.operation === 'preview')
      return { version: 1, planId: 'reviewed-plan', changes: [] }
    if (request.operation === 'apply' || request.operation === 'restore')
      return { version: 1, state: request.operation === 'apply' ? 'applied' : 'restored' }
    return { version: 1, repositories: [] }
  })
}

describe('workstation host adapter', () => {
  it('keeps older CLI configuration inventories usable with explicit unsupported audit and original tool entries', async () => {
    const call = configurationTransport()
    const software = vi.fn()
    const page = await createWorkstationPlugin(call, software).integrationProviders![0].configurationManagement!.read({}, {})
    expect(page.items).toEqual([configurationItem])
    expect(page.skillsAudit).toMatchObject({ state: 'unsupported', findings: [], message: expect.stringContaining('Update the local CLI') })
    expect(page.managementTools?.map(tool => tool.id)).toEqual(['workstation', 'apm', 'skills-cli', 'native-plugin', 'project', 'magpie'])
    expect(page.managementTools?.find(tool => tool.id === 'magpie')).toEqual({ id: 'magpie', title: 'Magpie', url: 'https://usemagpie.ai/', software: { sourceId: 'workstation', softwareId: 'magpie' } })
    expect(call.mock.calls.map(([request]) => request.operation).sort()).toEqual(['git-status', 'history', 'inspect'])
    expect(software).not.toHaveBeenCalled()
  })

  it('forwards client, scope and proven ownership while discarding raw audit and provenance fields', async () => {
    const item = { ...configurationItem, client: 'shared', scope: 'global', manager: 'apm', provenance: { label: 'APM lock', path: '/fixture/apm.lock.yaml', token: 'private token' } }
    const call = configurationTransport([item], { ...audit, token: 'private token', summary: { ...audit.summary, rawManifest: 'private manifest' }, findings: [{ ...audit.findings[0], metadata: { token: 'private token' } }] })
    const page = await createWorkstationPlugin(call).integrationProviders![0].configurationManagement!.read({ projectPath: '/fixture/project' }, {})
    expect(page.items).toEqual([{ ...configurationItem, client: 'shared', scope: 'global', manager: 'apm', provenance: { label: 'APM lock', path: '/fixture/apm.lock.yaml' } }])
    expect(page.skillsAudit).toEqual(audit)
    expect(page.history).toEqual([{ planId: 'previous-plan', state: 'applied' }])
    expect(call).toHaveBeenCalledWith({ operation: 'inspect', projectPath: '/fixture/project' })
    expect(JSON.stringify(page)).not.toContain('private token')
    expect(JSON.stringify(page)).not.toContain('private manifest')
  })

  it('does not infer tool ownership or preserve invalid display metadata', async () => {
    const item = { ...configurationItem, client: 'x'.repeat(129), scope: 'machine', manager: 'unverified-tool', provenance: { label: 'External link', path: 123, token: 'private token' } }
    const call = configurationTransport([item], audit)
    const page = await createWorkstationPlugin(call).integrationProviders![0].configurationManagement!.read({}, {})
    expect(page.items).toEqual([{ ...configurationItem, manager: 'unknown', provenance: { label: 'External link' } }])
  })

  it.each([
    { state: 'unknown', findings: [], token: 'private token' },
    { ...audit, findings: [{ ...audit.findings[0], severity: 'fatal' }] },
    { ...audit, findings: Array.from({ length: 1001 }).fill(audit.findings[0]) },
    { ...audit, findings: [{ ...audit.findings[0], paths: Array.from({ length: 21 }).fill('/fixture/path') }] },
    { ...audit, findings: [{ ...audit.findings[0], message: 'x'.repeat(2001) }] },
    { ...audit, summary: { ...audit.summary, warningCount: -1 } },
    { ...audit, summary: { ...audit.summary, skillFileCount: 1000001 } },
    { ...audit, checkedAt: 'invalid date' },
  ])('isolates invalid audit data from inventory, history and recovery', async (invalidAudit) => {
    const call = configurationTransport([configurationItem], invalidAudit)
    const page = await createWorkstationPlugin(call).integrationProviders![0].configurationManagement!.read({}, {})
    expect(page.items).toEqual([configurationItem])
    expect(page.history).toEqual([{ planId: 'previous-plan', state: 'applied' }])
    expect(page.skillsAudit).toEqual({ state: 'error', findings: [], message: 'Workstation Skills audit response is invalid. Update the local CLI and refresh.' })
    expect(JSON.stringify(page)).not.toContain('private token')
  })

  it('uses a fixed failure message instead of forwarding external audit failure details', async () => {
    const call = configurationTransport([configurationItem], { state: 'error', findings: [{ ...audit.findings[0], message: 'private token diagnostic' }], message: 'private token diagnostic' })
    const page = await createWorkstationPlugin(call).integrationProviders![0].configurationManagement!.read({}, {})
    expect(page.skillsAudit).toEqual({ state: 'error', findings: [], message: 'Workstation could not complete Skills audit. Refresh and check the local CLI.' })
    expect(JSON.stringify(page)).not.toContain('private token')
  })

  it('refreshes diagnostics through existing confirmed preview, apply and restore operations', async () => {
    const call = configurationTransport([configurationItem], audit)
    const management = createWorkstationPlugin(call).integrationProviders![0].configurationManagement!
    await expect(management.update({}, { operation: 'preview', decisions: [] })).rejects.toThrow('confirm')
    expect(call).not.toHaveBeenCalled()
    const preview = await management.update({ confirmed: true }, { operation: 'preview', decisions: [] })
    expect(preview).toMatchObject({ preview: { version: 1, planId: 'reviewed-plan', changes: [] }, skillsAudit: audit })
    const applied = await management.update({ confirmed: true }, { operation: 'apply', planId: 'reviewed-plan' })
    expect(applied).toMatchObject({ message: 'applied', skillsAudit: audit })
    const restored = await management.update({ confirmed: true }, { operation: 'restore', planId: 'previous-plan' })
    expect(restored).toMatchObject({ message: 'restored', skillsAudit: audit })
    expect(call.mock.calls.map(([request]) => request.operation)).toEqual([
      'preview',
      'inspect',
      'history',
      'git-status',
      'apply',
      'inspect',
      'history',
      'git-status',
      'restore',
      'inspect',
      'history',
      'git-status',
    ])
    expect(call).toHaveBeenCalledWith({ operation: 'restore', planId: 'previous-plan' })
  })

  it('preserves download observations through the CLI transport and runtime validation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-download-progress-'))
    const observation = {
      version: 1,
      id: 'download-run',
      sourceId: 'workstation',
      planId: 'reviewed-plan',
      createdAt: '2026-10-13T00:00:00.000Z',
      updatedAt: '2026-10-13T00:00:01.000Z',
      state: 'running',
      items: [{ softwareId: 'editor', title: { en: 'Editor' }, state: 'running', log: '', progress: { phase: 'downloading', percent: 37, resource: 'Cask editor' } }],
    }
    try {
      const script = join(directory, 'fixture.cjs')
      await writeFile(script, `process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(${JSON.stringify(JSON.stringify({ ok: true, result: { version: 1, runs: [observation] } }))}))`)
      const software = workstationTransport(process.execPath, [script], 'software-json')
      const management = createWorkstationPlugin(transport(), software).softwareCatalogProviders![0].management!
      expect(await management.runs()).toEqual({ version: 1, runs: [observation] })
      const runtime = new CraftHubRuntime({ dataDir: join(directory, 'state'), plugins: [createWorkstationPlugin(transport(), software)] })
      expect(await runtime.softwareInstallationRuns('workstation')).toEqual({ version: 1, runs: [observation] })
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('reads software from its independent versioned API without requesting configuration writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-software-adapter-'))
    const call = transport()
    const catalog = { version: 1 as const, source: { id: 'workstation', title: 'Workstation', url: 'https://github.com/YunYouJun/workstation' }, items: [] }
    const software = vi.fn(async () => catalog)
    try {
      const runtime = new CraftHubRuntime({ dataDir: directory, plugins: [createWorkstationPlugin(call, software)] })
      const snapshot = await runtime.softwareCatalogSnapshot()
      expect(snapshot).toMatchObject({ version: 1, sources: [{ ...catalog.source, canManage: true }] })
      expect(snapshot.sources).toHaveLength(1)
      expect(snapshot.sources[0]!.items.length).toBeGreaterThan(0)
      expect(software).toHaveBeenCalledExactlyOnceWith({ operation: 'catalog' })
      expect(call).not.toHaveBeenCalled()
      const hosted = new CraftHubRuntime({ dataDir: join(directory, 'hosted'), hostEnvironment: 'hosted', plugins: [createWorkstationPlugin(call, software)] })
      expect(await hosted.softwareCatalogSnapshot()).toMatchObject({ sources: [{ id: 'workstation', bundled: true }] })
      expect(software).toHaveBeenCalledOnce()
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('forwards only fixed software operations and requires confirmation at the adapter seam', async () => {
    const call = transport()
    const software = vi.fn(async (_request: Record<string, unknown>) => ({ version: 1 }))
    const management = createWorkstationPlugin(call, software).softwareCatalogProviders![0].management!
    await management.preview(['editor'])
    await management.install('reviewed-plan', true)
    await management.runs()
    await management.cancel('run-1')
    await management.open('editor')
    expect(software.mock.calls.map(args => args[0])).toEqual([
      { operation: 'preview', softwareIds: ['editor'] },
      { operation: 'install', planId: 'reviewed-plan', confirmed: true },
      { operation: 'runs' },
      { operation: 'cancel', runId: 'run-1' },
      { operation: 'open', softwareId: 'editor' },
    ])
    await expect(management.install('reviewed-plan', false as true)).rejects.toThrow('confirm')
    expect(software).toHaveBeenCalledTimes(5)
    expect(call).not.toHaveBeenCalled()
  })

  it('maps software CLI error codes without exposing external diagnostics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-software-transport-'))
    const script = join(directory, 'fixture.cjs')
    try {
      await writeFile(script, 'process.stdin.resume(); process.stdin.on(\'end\', () => process.stdout.write(JSON.stringify({ ok: false, code: \'PLAN_STALE\', error: \'private token diagnostic\' })))')
      const request = workstationTransport(process.execPath, [script], 'software-json')
      await expect(request({ operation: 'install', planId: 'plan-1', confirmed: true })).rejects.toMatchObject({ status: 409, message: 'Software plan has changed or expired. Review a new plan.' })
      await writeFile(script, 'process.stdin.resume(); process.stdin.on(\'end\', () => process.stdout.write(JSON.stringify({ ok: false, error: \'private token diagnostic\' })))')
      await expect(request({ operation: 'runs' })).rejects.toMatchObject({ status: 503, message: 'Software operation is unavailable. Check the local Workstation CLI and refresh its history.' })
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('resolves its own declaration and keeps discovery read only', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-config-'))
    try {
      const call = transport()
      const runtime = new CraftHubRuntime({ dataDir: directory, plugins: [createWorkstationPlugin(call)] })
      const result = await runtime.integrationContributions()
      expect(result.diagnostics).toEqual([])
      expect(result.integrations[0].views[0].title).toBe('环境配置')
      await runtime.invokeIntegrationAction({ integrationId: 'workstation', actionId: 'inspect' })
      expect(call.mock.calls.map(([request]) => request.operation).sort()).toEqual(['git-status', 'history', 'inspect'])
      await expect(runtime.invokeIntegrationAction({ integrationId: 'workstation', actionId: 'update', input: { operation: 'apply', planId: 'unreviewed' } })).rejects.toThrow('confirmation')
      expect(call).toHaveBeenCalledTimes(3)
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('does not allow browser operation selectors to turn a read into a write', async () => {
    const call = transport()
    const plugin = createWorkstationPlugin(call)
    await expect(plugin.integrationProviders![0].configurationManagement!.read({}, { operation: 'apply' })).rejects.toThrow('Unsupported read')
    await expect(plugin.integrationProviders![0].configurationManagement!.update({ confirmed: true }, { operation: 'git-action', action: 'publish' })).rejects.toThrow('Unsupported configuration')
    expect(call).not.toHaveBeenCalled()
  })

  it('denies device configuration access in a hosted runtime', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-config-'))
    try {
      const call = transport()
      const runtime = new CraftHubRuntime({ dataDir: directory, hostEnvironment: 'hosted', plugins: [createWorkstationPlugin(call)] })
      await expect(runtime.invokeIntegrationAction({ integrationId: 'workstation', actionId: 'inspect' })).rejects.toThrow('local service')
      await expect(runtime.invokeIntegrationAction({ integrationId: 'workstation', actionId: 'git', confirmed: true, input: { operation: 'git-action', action: 'publish' } })).rejects.toThrow('local service')
      expect(call).not.toHaveBeenCalled()
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('keeps project-scoped configuration mutations behind explicit project trust', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-config-'))
    try {
      const call = transport()
      const runtime = new CraftHubRuntime({ dataDir: join(directory, 'state'), plugins: [createWorkstationPlugin(call)] })
      const project = await runtime.addProject(directory)
      await expect(runtime.invokeIntegrationAction({ integrationId: 'workstation', actionId: 'update', projectId: project.id, confirmed: true, input: { operation: 'preview', decisions: [] } })).rejects.toThrow('Trust the project')
      expect(call).not.toHaveBeenCalled()
      await runtime.projects.setTrust(project.id, 'trusted')
      await runtime.invokeIntegrationAction({ integrationId: 'workstation', actionId: 'update', projectId: project.id, confirmed: true, input: { operation: 'preview', decisions: [] } })
      expect(call.mock.calls.some(([request]) => request.operation === 'preview')).toBe(true)
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('reads audit for an untrusted registered project using only the host project path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-audit-project-'))
    try {
      const call = configurationTransport([], audit)
      const runtime = new CraftHubRuntime({ dataDir: join(directory, 'state'), plugins: [createWorkstationPlugin(call)] })
      const project = await runtime.addProject(directory)
      expect(project.trust).toBe('untrusted')
      const result = await runtime.invokeIntegrationAction({ integrationId: 'workstation', actionId: 'inspect', projectId: project.id, input: { operation: 'inspect', projectPath: '/browser-supplied-path' } })
      expect(result).toMatchObject({ skillsAudit: { state: 'available' } })
      expect(call.mock.calls.map(([input]) => input.operation).sort()).toEqual(['git-status', 'history', 'inspect'])
      expect(call).toHaveBeenCalledWith({ operation: 'inspect', projectPath: project.path })
      expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
})

import type { WorkstationTransport } from '../src/index'
import { describe, expect, it, vi } from 'vitest'
import { configurationOperations, softwareOperations } from '../src/host-support'
import { createWorkstationPlugin } from '../src/index'

function capabilities(repositoryValidation: number | undefined = 1, platform = 'linux') {
  return {
    version: 1,
    cliVersion: '0.1.0',
    platform,
    protocols: { host: 1, configuration: 1, software: 1, ...(repositoryValidation === undefined ? {} : { repositoryValidation }) },
    operations: {
      configuration: Object.fromEntries(configurationOperations.map(operation => [operation, { supported: true }])),
      software: Object.fromEntries(softwareOperations.map(operation => [operation, { supported: true }])),
      doctor: { supported: true },
      repositoryValidation: { supported: true },
    },
  }
}

describe('workstation repository validation adapter', () => {
  it.each(['darwin', 'linux', 'win32'])('negotiates pure validation on %s and sends only content', async (platform) => {
    const configuration = vi.fn<WorkstationTransport>()
    const software = vi.fn<WorkstationTransport>()
    const host = vi.fn<WorkstationTransport>(async request => request.operation === 'capabilities' ? capabilities(1, platform) : { version: 1, valid: true, issues: [], private: 'not-forwarded' })
    const provider = createWorkstationPlugin(configuration, software, host).repositoryValidationProviders![0]!
    expect(provider.files).toEqual(['projects.yaml', 'projects.yml', 'projects.example.yaml'])
    expect(await provider.validate('repositories: []')).toEqual({ status: 'valid', issues: [] })
    expect(host.mock.calls).toEqual([[{ operation: 'capabilities' }], [{ operation: 'validate-projects', content: 'repositories: []' }]])
    expect(configuration).not.toHaveBeenCalled()
    expect(software).not.toHaveBeenCalled()
  })

  it.each([undefined, 2])('reports an absent or incompatible validation protocol as unsupported', async (version) => {
    const host = vi.fn<WorkstationTransport>(async () => capabilities(version))
    // Avoid the helper default when testing the absence of this additive protocol.
    if (version === undefined) {
      const legacy = capabilities()
      delete (legacy.protocols as Record<string, unknown>).repositoryValidation
      host.mockResolvedValue(legacy)
    }
    const provider = createWorkstationPlugin(vi.fn(), vi.fn(), host).repositoryValidationProviders![0]!
    expect(await provider.validate('repositories: []')).toMatchObject({ status: 'unsupported', issues: [{ code: 'unsupported-version' }] })
    expect(host).toHaveBeenCalledTimes(1)
  })

  it('strips unknown report fields, preserves field errors, and rejects inconsistent success', async () => {
    let report: Record<string, unknown> = { version: 1, valid: false, issues: [{ code: 'invalid-field', path: 'repositories[0].url', message: 'Invalid repository URL.', content: 'private-value' }], source: 'private-config' }
    const host = vi.fn<WorkstationTransport>(async request => request.operation === 'capabilities' ? capabilities() : report)
    const provider = createWorkstationPlugin(vi.fn(), vi.fn(), host).repositoryValidationProviders![0]!
    expect(await provider.validate('repositories: [invalid]')).toEqual({ status: 'invalid', issues: [{ code: 'invalid-field', path: 'repositories[0].url', message: 'Invalid repository URL.' }] })
    report = { version: 1, valid: true, issues: [{ code: 'failure', path: '/', message: 'Failure.' }] }
    await expect(provider.validate('repositories: []')).rejects.toThrow()
    report = { version: 2, valid: true, issues: [] }
    await expect(provider.validate('repositories: []')).rejects.toThrow()
  })
})

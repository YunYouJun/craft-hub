import type { RepositoryValidationProvider } from '../src/repository-validation'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadCraftHubPlugins } from '../src/plugins'
import { validateRepository } from '../src/repository-validation'

const execute = promisify(execFile)
const directories: string[] = []
const source = { schemaVersion: 1, id: 'example', name: 'Example', workspaces: [{ schemaVersion: 1, id: 'development', name: 'Development', members: [{ project: 'https://github.com/example/project' }] }] }
const software = 'export const softwareGroups = [{ id: "tools", label: { en: "Tools" }, items: [{ id: "tool", name: { en: "Tool" }, url: "https://example.com/tool" }] }] as const'

async function fixture(files: Record<string, string> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'craft-repo-validation-'))
  directories.push(directory)
  for (const [file, content] of Object.entries(files)) {
    const parts = file.split('/')
    await mkdir(join(directory, ...parts.slice(0, -1)), { recursive: true })
    await writeFile(join(directory, file), content)
  }
  return directory
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('read-only repository validation', () => {
  it('reuses parsers without executing TypeScript, fetching schema hints, or modifying declarations', async () => {
    const content = {
      '.craft-hub/project.jsonc': '// preserve this comment\n{"$schema":"https://unavailable.example/schema.json","version":1,"project":{"name":"Example"}}',
      '.craft-hub/source.jsonc': JSON.stringify(source),
      'software.config.ts': `import './execute.mjs'\n${software}\nprocess.exit(9)`,
      'execute.mjs': 'throw new Error("Repository module must never run")',
    }
    const root = await fixture(content)
    const fetch = vi.spyOn(globalThis, 'fetch')
    expect(await validateRepository(root)).toMatchObject({
      version: 1,
      valid: true,
      files: [
        { file: '.craft-hub/project.jsonc', status: 'valid' },
        { file: '.craft-hub/source.jsonc', status: 'valid' },
        { file: 'software.config.ts', status: 'valid' },
      ],
      issues: [],
      summary: { checked: 3, errors: 0, unsupported: 0 },
    })
    expect(fetch).not.toHaveBeenCalled()
    for (const [file, expected] of Object.entries(content))
      expect(await readFile(join(root, file), 'utf8')).toBe(expected)
    expect((await readdir(root)).sort()).toEqual(['.craft-hub', 'execute.mjs', 'software.config.ts'])
  })

  it('isolates invalid declarations and reports semantic field locations without source values', async () => {
    const root = await fixture({
      '.craft-hub/project.jsonc': '{\n  "version": 1,\n  "project": { "color": "private-value" }\n}',
      '.craft-hub/source.jsonc': JSON.stringify({ ...source, workspaces: [source.workspaces[0], source.workspaces[0]] }),
      'software.config.ts': 'export const softwareGroups = steal("private-token")',
    })
    const report = await validateRepository(root)
    expect(report.valid).toBe(false)
    expect(report.files).toMatchObject([
      { format: 'project', status: 'invalid', issues: [{ path: '/project/color', line: 3 }] },
      { format: 'workspace-source', status: 'invalid', issues: [{ message: 'Duplicate workspace ids' }] },
      { format: 'software', status: 'invalid', issues: [{ message: expect.stringContaining('literal data') }] },
    ])
    expect(report.summary).toEqual({ checked: 3, errors: 3, unsupported: 0 })
    expect(JSON.stringify(report)).not.toContain('private-value')
    expect(JSON.stringify(report)).not.toContain('private-token')
  })

  it('reports missing project-manifest validators as unsupported without losing other results', async () => {
    const root = await fixture({ '.craft-hub/project.jsonc': '{"version":1}', 'projects.yaml': 'repositories: []' })
    expect(await validateRepository(root)).toMatchObject({
      valid: false,
      files: [{ status: 'valid' }, { file: 'projects.yaml', status: 'unsupported' }],
      summary: { checked: 2, errors: 0, unsupported: 1 },
    })
  })

  it('validates individual workspace files together and respects bundle authority', async () => {
    const root = await fixture({
      '.craft-hub/project.jsonc': '{"version":1}',
      '.craft-hub/workspaces/development.jsonc': JSON.stringify(source.workspaces[0]),
      '.craft-hub/workspaces/other.json': JSON.stringify(source.workspaces[0]),
    })
    expect(await validateRepository(root)).toMatchObject({ valid: false, files: [
      { status: 'valid' },
      { file: '.craft-hub/workspaces/development.jsonc', status: 'invalid', issues: [{ message: 'Duplicate workspace ids' }] },
      { file: '.craft-hub/workspaces/other.json', status: 'invalid' },
    ] })
    await writeFile(join(root, '.craft-hub/source.jsonc'), JSON.stringify(source))
    expect(await validateRepository(root)).toMatchObject({ valid: true, summary: { checked: 2 } })
    await writeFile(join(root, '.craft-hub/source.json'), JSON.stringify(source))
    expect(await validateRepository(root)).toMatchObject({ valid: false, files: [
      { status: 'valid' },
      { status: 'invalid', issues: [{ message: 'Publish either source.jsonc or source.json in this directory.' }] },
      { status: 'invalid' },
    ] })
    await writeFile(join(root, '.craft-hub/source.json'), '')
    expect(await validateRepository(root)).toMatchObject({ valid: false, files: [
      { status: 'valid' },
      { status: 'invalid', issues: [{ message: 'Publish either source.jsonc or source.json in this directory.' }] },
      { status: 'invalid' },
    ] })
  })

  it('attributes individual workspace errors to the exact file and document field', async () => {
    const root = await fixture({
      '.craft-hub/workspaces/healthy.json': JSON.stringify({ ...source.workspaces[0], id: 'healthy' }),
      '.craft-hub/workspaces/invalid.json': JSON.stringify({ ...source.workspaces[0], id: 'invalid', name: '' }),
      '.craft-hub/workspaces/members.json': JSON.stringify({ ...source.workspaces[0], id: 'members', members: [{ project: 'file:///tmp/private' }] }),
      '.craft-hub/workspaces/primary.json': JSON.stringify({ ...source.workspaces[0], id: 'primary', primaryProject: 'https://github.com/example/other' }),
    })
    expect(await validateRepository(root)).toMatchObject({
      valid: false,
      files: [
        { file: '.craft-hub/workspaces/healthy.json', status: 'valid', issues: [] },
        { file: '.craft-hub/workspaces/invalid.json', status: 'invalid', issues: [{ path: '/name' }] },
        { file: '.craft-hub/workspaces/members.json', status: 'invalid', issues: [{ path: '/members/0/project' }] },
        { file: '.craft-hub/workspaces/primary.json', status: 'invalid', issues: [{ path: '/', message: 'Primary project must be a member' }] },
      ],
      summary: { checked: 4, errors: 3, unsupported: 0 },
    })
  })

  it('marks only participating workspace files invalid for duplicate source identities', async () => {
    const root = await fixture({
      '.craft-hub/workspaces/first.json': JSON.stringify(source.workspaces[0]),
      '.craft-hub/workspaces/healthy.json': JSON.stringify({ ...source.workspaces[0], id: 'healthy' }),
      '.craft-hub/workspaces/second.json': JSON.stringify(source.workspaces[0]),
    })
    expect(await validateRepository(root)).toMatchObject({
      valid: false,
      files: [
        { file: '.craft-hub/workspaces/first.json', status: 'invalid', issues: [{ path: '/', message: 'Duplicate workspace ids' }] },
        { file: '.craft-hub/workspaces/healthy.json', status: 'valid', issues: [] },
        { file: '.craft-hub/workspaces/second.json', status: 'invalid', issues: [{ path: '/', message: 'Duplicate workspace ids' }] },
      ],
      summary: { checked: 3, errors: 2, unsupported: 0 },
    })
  })

  it('retains unsafe repository field paths in source bundles', async () => {
    const root = await fixture({
      '.craft-hub/source.jsonc': JSON.stringify({ ...source, workspaces: [{ ...source.workspaces[0], primaryProject: 'file:///tmp/private', members: [{ project: 'http://git.example.com/team/project' }] }] }),
    })
    expect(await validateRepository(root)).toMatchObject({
      valid: false,
      files: [{
        file: '.craft-hub/source.jsonc',
        status: 'invalid',
        issues: [{ path: '/workspaces/0/primaryProject' }, { path: '/workspaces/0/members/0/project' }],
      }],
      summary: { checked: 1, errors: 2 },
    })
  })

  it('excludes known metadata from source fallback without reserving child workspace names', async () => {
    const root = await fixture({
      '.craft-hub/project.jsonc': '{"version":1}',
      '.craft-hub/dotfiles.jsonc': '{"version":1,"files":[]}',
      '.craft-hub/config.jsonc': '{"version":1}',
      '.craft-hub/owner-scopes.jsonc': '{"version":1,"scopes":[]}',
      '.craft-hub/settings.json': '{}',
      '.craft-hub/workspaces/dotfiles.jsonc': JSON.stringify(source.workspaces[0]),
      'craft-hub/dotfiles.jsonc': '{"version":1,"files":[]}',
      'software.config.ts': software,
    })
    expect(await validateRepository(root)).toMatchObject({
      valid: true,
      files: [
        { file: '.craft-hub/project.jsonc', status: 'valid' },
        { file: '.craft-hub/workspaces/dotfiles.jsonc', status: 'valid' },
        { file: 'software.config.ts', status: 'valid' },
      ],
      summary: { checked: 3, errors: 0, unsupported: 0 },
    })
  })

  it('rejects symlinked configuration files and directories before reading their contents', async () => {
    const external = await fixture({ 'project.jsonc': '{"version":1,"secret":"unread-secret"}' })
    const root = await fixture({ 'software.config.ts': software })
    await mkdir(join(root, '.craft-hub'))
    await symlink(join(external, 'project.jsonc'), join(root, '.craft-hub/project.jsonc'))
    let report = await validateRepository(root)
    expect(report.files.find(file => file.format === 'project')).toMatchObject({ status: 'invalid', issues: [{ code: 'non-regular-file' }] })
    expect(JSON.stringify(report)).not.toContain('unread-secret')
    await rm(join(root, '.craft-hub'), { recursive: true })
    await symlink(external, join(root, '.craft-hub'), 'dir')
    report = await validateRepository(root)
    expect(report.valid).toBe(false)
    expect(report.files.find(file => file.format === 'software')).toMatchObject({ status: 'valid' })
    expect(JSON.stringify(report)).not.toContain('unread-secret')
  })

  it('bounds files before parsing and distinguishes empty directories from validation success', async () => {
    const root = await fixture({ '.craft-hub/project.jsonc': ' '.repeat(256 * 1024 + 1) })
    expect(await validateRepository(root)).toMatchObject({ valid: false, files: [{ issues: [{ code: 'file-too-large' }] }] })
    expect(await validateRepository(await fixture())).toMatchObject({ valid: false, files: [], issues: [{ code: 'no-configurations' }], summary: { checked: 0, errors: 1 } })
    expect(await validateRepository(join(root, 'missing'))).toMatchObject({ valid: false, issues: [{ code: 'invalid-input' }] })
  })

  it('passes only content to trusted validators, strips unknown response data and isolates failure', async () => {
    const root = await fixture({ 'projects.yaml': 'repositories: []', 'projects.yml': 'invalid', 'projects.example.yaml': 'legacy' })
    const validate = vi.fn<RepositoryValidationProvider['validate']>(async (content) => {
      if (content === 'invalid')
        throw new Error('private-token-in-subprocess-error')
      if (content === 'legacy')
        return { status: 'unsupported', issues: [{ code: 'unsupported-version', path: '/', message: 'Update the CLI.' }] }
      return JSON.parse('{"status":"valid","issues":[],"secret":"private-response-value"}')
    })
    const report = await validateRepository(root, [{ id: 'host', format: 'projects', files: ['projects.yaml', 'projects.yml', 'projects.example.yaml'], validate }])
    expect(report).toMatchObject({ valid: false, files: [{ status: 'valid' }, { status: 'invalid', issues: [{ code: 'validator-failed' }] }, { status: 'unsupported' }], summary: { checked: 3, errors: 1, unsupported: 1 } })
    expect(validate.mock.calls).toEqual([['repositories: []'], ['invalid'], ['legacy']])
    expect(JSON.stringify(report)).not.toContain('private')
    validate.mockResolvedValue({ status: 'valid', issues: [{ code: 'failure', path: '/', message: 'Failure.' }] })
    const inconsistent = await validateRepository(root, [{ id: 'host', format: 'projects', files: ['projects.yaml'], validate }])
    expect(inconsistent.valid).toBe(false)
    expect(inconsistent.files[0]).toMatchObject({ status: 'invalid', issues: [{ code: 'validator-failed' }] })
  })

  it('bounds an unresponsive host validator', async () => {
    const root = await fixture({ 'projects.yaml': 'repositories: []' })
    vi.useFakeTimers()
    try {
      const validate = vi.fn<RepositoryValidationProvider['validate']>(() => new Promise(() => {}))
      const pending = validateRepository(root, [{ id: 'host', format: 'projects', files: ['projects.yaml'], validate }])
      await vi.waitFor(() => expect(validate).toHaveBeenCalled())
      await vi.advanceTimersByTimeAsync(15000)
      expect(await pending).toMatchObject({ valid: false, files: [{ status: 'invalid', issues: [{ code: 'validator-failed' }] }] })
    }
    finally { vi.useRealTimers() }
  })

  it('rejects unsafe and duplicate host validator declarations during plugin loading', async () => {
    const root = await fixture({
      'invalid.mjs': 'export default { id: "host", repositoryValidationProviders: [{ id: "projects", format: "projects", files: ["../private.yaml"], validate: async () => ({status:"valid",issues:[]}) }] }',
      'valid.mjs': 'export default { id: "host", repositoryValidationProviders: [{ id: "projects", format: "projects", files: ["projects.yaml"], validate: async () => ({status:"valid",issues:[]}) }] }',
    })
    expect(await loadCraftHubPlugins([join(root, 'invalid.mjs'), join(root, 'valid.mjs')])).toMatchObject({ plugins: [{ id: 'host' }], diagnostics: [{ message: expect.stringContaining('validation file') }] })
  })
})

describe('repository validation CLI', () => {
  it('returns structured results and CI exit codes without creating machine state', async () => {
    const root = await fixture({ '.craft-hub/project.jsonc': '{"version":1}' })
    const data = join(root, 'machine-data')
    const config = join(root, 'machine-config')
    const args = ['--import', 'tsx', resolve('packages/craft-hub/src/cli.ts'), 'repo:validate', root, '--json']
    const options = { env: { ...process.env, CRAFT_HUB_DATA_DIR: data, CRAFT_HUB_CONFIG_DIR: config } }
    const successful = await execute(process.execPath, args, options)
    expect(JSON.parse(successful.stdout)).toMatchObject({ version: 1, valid: true, summary: { checked: 1 } })
    await expect(access(data)).rejects.toThrow()
    await expect(access(config)).rejects.toThrow()
    await writeFile(join(root, 'projects.yaml'), 'repositories: []')
    await expect(execute(process.execPath, args, options)).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('"status": "unsupported"') })
    await expect(execute(process.execPath, [...args, '--host-plugin', join(root, 'missing.mjs')], options)).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('host-plugin-unavailable') })
    await expect(access(data)).rejects.toThrow()
    await expect(access(config)).rejects.toThrow()
  }, 15000)
})

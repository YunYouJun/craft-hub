import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyProjectDescriptionChanges, CraftHubRuntime, createCraftHub, defineCapabilityProvider, defineCraftHubPlugin, discoverCapabilities, discoverCapabilitiesWithDiagnostics, loadCraftHubPlugins, projectConfigRevision, resolveSkillInputSelections } from '../src/index'

async function writeProjectConfig(root: string, config: Record<string, unknown>): Promise<void> {
  await mkdir(join(root, '.craft-hub'), { recursive: true })
  await writeFile(join(root, '.craft-hub', 'project.jsonc'), `${JSON.stringify(config, null, 2)}\n`)
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    packageManager: 'npm@11.0.0',
    scripts: { hello: 'node -e "console.log(\'hello\')"', hidden: 'node -e "console.log(\'hidden\')"' },
  }))
  await writeProjectConfig(root, {
    version: 1,
    project: { name: 'Test Project' },
    capabilities: {
      hidden: ['package.json:hidden'],
      descriptions: { 'package.json:hello': 'Print a friendly greeting.' },
    },
  })
  await mkdir(join(root, '.agents', 'skills', 'release'), { recursive: true })
  await writeFile(join(root, '.agents', 'skills', 'release', 'SKILL.md'), [
    '---',
    'name: release',
    'description: Prepare a safe release.',
    '---',
    '# Release',
  ].join('\n'))
  return root
}

async function downstreamFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-downstream-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { check: 'node --version' } }))
  await writeProjectConfig(root, {
    version: 1,
    project: { name: 'Downstream Project' },
    extensions: { 'example.workflow': { defaultAgent: 'internal-agent' } },
  })
  return root
}

describe('capability discovery', () => {
  it('localizes package descriptions from version 1 project metadata and preserves comments when applying changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-package-description-'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'root', scripts: { dev: 'vite' } }))
    await mkdir(join(root, '.craft-hub'), { recursive: true })
    await writeFile(join(root, '.craft-hub', 'project.jsonc'), [
      '{',
      '  // keep this comment',
      '  "version": 1,',
      '  "packages": {',
      '    ".": {',
      '      "description": {',
      '        // preserve the reviewed default description',
      '        "default": "Existing root package."',
      '      }',
      '    }',
      '  },',
      '  "extensions": { "example.field": "retained" },',
      '}',
      '',
    ].join('\n'))

    await applyProjectDescriptionChanges(root, [{
      id: 'package:.',
      target: 'package',
      key: '.',
      description: { 'default': 'Root package.', 'zh-CN': '根包。' },
    }], await projectConfigRevision(root))

    const content = await readFile(join(root, '.craft-hub', 'project.jsonc'), 'utf8')
    expect(content).toContain('// keep this comment')
    expect(content).toContain('// preserve the reviewed default description')
    expect(content).toContain('"default": "Existing root package."')
    expect(content).toContain('"zh-CN": "根包。"')
    expect(content).toContain('"example.field": "retained"')
    await expect(discoverCapabilitiesWithDiagnostics(root, 'zh-CN')).resolves.toMatchObject({
      packages: [expect.objectContaining({ relativePath: '.', description: '根包。' })],
      capabilities: [expect.objectContaining({ package: expect.objectContaining({ description: '根包。' }) })],
    })
  })

  it('discovers, classifies, and scopes pnpm workspace package scripts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-monorepo-'))
    const widget = join(root, 'apps', 'widget')
    const broken = join(root, 'packages', 'broken')
    const empty = join(root, 'packages', 'empty')
    const ignored = join(root, 'packages', 'ignored')
    await Promise.all([
      mkdir(widget, { recursive: true }),
      mkdir(broken, { recursive: true }),
      mkdir(empty, { recursive: true }),
      mkdir(ignored, { recursive: true }),
      mkdir(join(root, '.craft-hub'), { recursive: true }),
    ])
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'root', description: 'Root workspace', packageManager: 'pnpm@10.0.0', scripts: { dev: 'vite' } }))
    await writeFile(join(root, 'pnpm-workspace.yaml'), ['packages:', '  - apps/*', '  - packages/*', '  - "!packages/ignored"'].join('\n'))
    await writeFile(join(widget, 'package.json'), JSON.stringify({ name: '@scope/widget', description: 'Widget package', private: true, scripts: { 'build:widget': 'widget compile', 'deploy': 'widget deploy', 'prepublishOnly': 'echo prepare' } }))
    await writeFile(join(broken, 'package.json'), '{ broken json')
    await writeFile(join(empty, 'package.json'), JSON.stringify({ name: '@scope/empty', description: '_description_', private: true }))
    await writeFile(join(ignored, 'package.json'), JSON.stringify({ scripts: { hidden: 'echo hidden' } }))
    await writeProjectConfig(root, {
      version: 1,
      capabilities: { descriptions: { 'apps/widget/package.json:deploy': 'Deploy the Widget package.' } },
    })

    const discovery = await discoverCapabilitiesWithDiagnostics(root)
    const commands = discovery.capabilities.filter(item => item.kind === 'command')
    expect(commands.map(command => [command.package?.relativePath, command.name])).toEqual([
      ['.', 'dev'],
      ['apps/widget', 'build:widget'],
      ['apps/widget', 'deploy'],
      ['apps/widget', 'prepublishOnly'],
    ])
    expect(commands.find(command => command.name === 'deploy')).toMatchObject({
      category: 'deploy',
      description: 'Deploy the Widget package.',
      source: 'apps/widget/package.json',
      package: { name: '@scope/widget', description: 'Widget package', relativePath: 'apps/widget', root: false },
      invocation: { command: 'pnpm', args: ['run', 'deploy'], cwd: await realpath(widget) },
    })
    expect(commands.find(command => command.name === 'build:widget')?.category).toBe('build')
    expect(commands.find(command => command.name === 'prepublishOnly')?.category).toBe('deploy')
    expect(discovery.packages).toEqual([
      { name: 'root', description: 'Root workspace', relativePath: '.', root: true },
      { name: '@scope/widget', description: 'Widget package', relativePath: 'apps/widget', root: false },
      { name: '@scope/empty', description: undefined, relativePath: 'packages/empty', root: false },
    ])
    expect(discovery.diagnostics).toEqual([
      expect.objectContaining({ source: 'pnpm-workspace', path: 'packages/broken/package.json' }),
    ])
  })

  it('fails clearly when pnpm workspace package globs are invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-invalid-workspace-'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: apps/*\n')

    await expect(discoverCapabilitiesWithDiagnostics(root)).rejects.toThrow('packages as an array')
  })

  it('treats pnpm-workspace.yaml without packages as a root-only workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-root-only-workspace-'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
    await writeFile(join(root, 'pnpm-workspace.yaml'), [
      'ignoredBuiltDependencies:',
      '  - esbuild',
    ].join('\n'))

    await expect(discoverCapabilitiesWithDiagnostics(root)).resolves.toMatchObject({
      capabilities: [expect.objectContaining({ name: 'dev', source: 'package.json' })],
      diagnostics: [],
    })
  })

  it('discovers package scripts and project skills', async () => {
    const root = await fixture()
    const capabilities = await discoverCapabilities(root)
    expect(capabilities.map(item => [item.kind, item.name])).toEqual([
      ['command', 'hello'],
      ['skill', 'release'],
    ])
    expect(capabilities.find(item => item.name === 'hello')?.description).toBe('Print a friendly greeting.')
    expect(capabilities.find(item => item.name === 'hello')).toMatchObject({
      source: 'package.json',
      sourcePath: join(root, 'package.json'),
      sourceLine: 1,
    })
  })

  it('records declaration lines for package, Makefile, and Taskfile commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-lines-'))
    await writeFile(join(root, 'package.json'), [
      '{',
      '  "scripts": {',
      '    "package-build": "vite build"',
      '  }',
      '}',
    ].join('\n'))
    await writeFile(join(root, 'Makefile'), [
      '.PHONY: make-build',
      'make-build:',
      '\t@echo build',
    ].join('\n'))
    await writeFile(join(root, 'Taskfile.yml'), [
      'version: "3"',
      'tasks:',
      '  task-build:',
      '    desc: Build with Task',
      '    cmds:',
      '      - echo build',
    ].join('\n'))

    const capabilities = await discoverCapabilities(root)
    expect(capabilities.find(item => item.name === 'package-build')).toMatchObject({ sourceLine: 3 })
    expect(capabilities.find(item => item.name === 'make-build')).toMatchObject({ sourceLine: 2 })
    expect(capabilities.find(item => item.name === 'task-build')).toMatchObject({ sourceLine: 3 })
  })

  it('resolves localized descriptions with locale, parent, default, and legacy fallbacks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-localized-'))
    await writeFile(join(root, 'package.json'), JSON.stringify({
      scripts: {
        exact: 'echo exact',
        parent: 'echo parent',
        fallback: 'echo fallback',
        legacy: 'echo legacy',
      },
    }))
    await writeProjectConfig(root, {
      version: 1,
      capabilities: {
        descriptions: {
          'package.json:exact': { 'zh-Hans-CN': '精确描述', 'default': 'Exact description' },
          'package.json:parent': { 'zh-Hans': '上级语言描述', 'default': 'Parent description' },
          'package.json:fallback': { default: 'Default description' },
          'package.json:legacy': 'Legacy description',
        },
      },
    })

    const descriptions = Object.fromEntries((await discoverCapabilities(root, 'zh-Hans-CN'))
      .map(capability => [capability.name, capability.description]))

    expect(descriptions).toMatchObject({
      exact: '精确描述',
      parent: '上级语言描述',
      fallback: 'Default description',
      legacy: 'Legacy description',
    })
  })

  it('discovers project-owned command inputs and localizes their form labels', async () => {
    const root = await fixture()
    await writeProjectConfig(root, {
      version: 1,
      capabilities: {
        inputs: {
          'package.json:hello': {
            environment: {
              type: 'select',
              label: { 'default': 'Environment', 'zh-CN': '环境' },
              options: ['dev', { value: 'staging', label: 'Random test' }],
              default: 'dev',
              flag: '--env',
            },
            account: {
              type: 'text',
              label: 'Account',
              pattern: '^\\d+$',
              flag: '--account',
              visibleWhen: { input: 'environment', equals: 'dev' },
              requiredWhen: { input: 'environment', equals: 'dev' },
            },
          },
        },
      },
    })

    const command = (await discoverCapabilities(root, 'zh-CN')).find(item => item.kind === 'command')!
    expect(command.inputs).toEqual([
      expect.objectContaining({ id: 'environment', type: 'select', label: '环境', default: 'dev', flag: '--env' }),
      expect.objectContaining({ id: 'account', type: 'text', label: 'Account', pattern: '^\\d+$', flag: '--account' }),
    ])
  })

  it('discovers project-owned skill inputs and validates selected agent context', async () => {
    const root = await fixture()
    await writeProjectConfig(root, {
      version: 1,
      capabilities: {
        skillInputs: {
          'agent-skill:release': {
            app: {
              type: 'select',
              label: { 'default': 'Application', 'zh-CN': '应用' },
              options: [
                { value: 'task-center', label: { 'default': 'Task Center', 'zh-CN': '小微任务中心' } },
                'todo',
              ],
              default: 'task-center',
              required: true,
            },
            version: {
              type: 'select',
              label: 'Version type',
              options: ['patch', 'minor'],
              default: 'patch',
            },
          },
        },
      },
    })

    const skill = (await discoverCapabilities(root, 'zh-CN')).find(item => item.kind === 'skill')!
    expect(skill.inputs).toEqual([
      expect.objectContaining({ id: 'app', type: 'select', label: '应用', default: 'task-center', required: true }),
      expect.objectContaining({ id: 'version', type: 'select', label: 'Version type', default: 'patch' }),
    ])
    expect(resolveSkillInputSelections(skill)).toEqual([
      { id: 'app', label: '应用', value: 'task-center' },
      { id: 'version', label: 'Version type', value: 'patch' },
    ])
    expect(() => resolveSkillInputSelections(skill, { app: 'unknown' })).toThrow('must be one of')
    expect(() => resolveSkillInputSelections(skill, { extra: 'value' })).toThrow('Unknown input')
  })

  it('follows the global locale when listing runtime capabilities', async () => {
    const root = await fixture()
    await writeProjectConfig(root, {
      version: 1,
      capabilities: {
        descriptions: {
          'package.json:hello': { 'default': 'Print a friendly greeting.', 'zh-CN': '打印一条友好的问候。' },
        },
      },
    })
    const runtime = new CraftHubRuntime(join(root, '.localized-data'))
    const project = await runtime.addProject(root)

    expect((await runtime.capabilities(project.id)).find(item => item.name === 'hello')?.description)
      .toBe('Print a friendly greeting.')

    const settings = await runtime.settings.get()
    await runtime.settings.update({ 'workbench.locale': 'zh-CN' }, settings.revision)

    expect((await runtime.capabilities(project.id)).find(item => item.name === 'hello')?.description)
      .toBe('打印一条友好的问候。')
  })

  it('refreshes persisted project metadata from local config', async () => {
    const root = await fixture()
    await writeFile(join(root, 'renamed.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    const runtime = new CraftHubRuntime(join(root, '.data'))
    await runtime.addProject(root)
    await writeProjectConfig(root, {
      version: 1,
      project: { name: 'Renamed Project', icon: './renamed.svg', color: 'purple' },
    })

    await expect(runtime.projects.list()).resolves.toEqual([
      expect.objectContaining({ name: 'Renamed Project', icon: './renamed.svg', color: 'purple' }),
    ])
  })

  it('updates project visual metadata through the registry', async () => {
    const root = await fixture()
    const runtime = new CraftHubRuntime(join(root, '.visual-update-data'))
    const project = await runtime.addProject(root)

    await expect(runtime.projects.setVisual(project.id, { icon: 'emoji:🚀', color: 'cyan' }))
      .resolves
      .toMatchObject({ icon: 'emoji:🚀', color: 'cyan' })

    const config = await readFile(join(root, '.craft-hub', 'project.jsonc'), 'utf8')
    expect(config).toContain('"icon": "emoji:🚀"')
    expect(config).toContain('"color": "cyan"')
    expect(config).toContain('"capabilities"')
  })

  it('persists an explicit project order', async () => {
    const root = await fixture()
    const second = await mkdtemp(join(tmpdir(), 'craft-hub-second-'))
    await writeFile(join(second, 'package.json'), JSON.stringify({ scripts: {} }))
    const runtime = new CraftHubRuntime(join(root, '.project-order-data'))
    const firstProject = await runtime.addProject(root)
    const secondProject = await runtime.addProject(second)

    await expect(runtime.projects.reorder([secondProject.id, firstProject.id]))
      .resolves
      .toEqual([expect.objectContaining({ id: secondProject.id }), expect.objectContaining({ id: firstProject.id })])
    expect((await runtime.projects.list()).map(project => project.id)).toEqual([secondProject.id, firstProject.id])
  })

  it('falls back from invalid visual metadata without blocking project discovery', async () => {
    const root = await fixture()
    await writeProjectConfig(root, {
      version: 1,
      project: { icon: '/tmp/outside.svg' },
    })
    const runtime = new CraftHubRuntime(join(root, '.visual-data'))

    const project = await runtime.addProject(root)
    expect(project).toMatchObject({
      iconWarning: expect.stringContaining('repository-relative path'),
    })
    expect(project).not.toHaveProperty('icon')
    expect(project).not.toHaveProperty('color')
  })

  it('persists a mixed capability pin order and follows a skill across content changes', async () => {
    const root = await fixture()
    const runtime = new CraftHubRuntime(join(root, '.pin-data'))
    const project = await runtime.addProject(root)
    const initial = await runtime.capabilities(project.id)
    const command = initial.find(item => item.kind === 'command')!
    const skill = initial.find(item => item.kind === 'skill')!

    await expect(runtime.updateCapabilityPins(project.id, [skill.id, command.id])).resolves.toEqual({
      projectId: project.id,
      capabilityIds: [skill.id, command.id],
    })
    await writeFile(join(root, '.agents', 'skills', 'release', 'SKILL.md'), [
      '---',
      'name: release',
      'description: Prepare an updated safe release.',
      '---',
      '# Updated release',
    ].join('\n'))
    const updatedSkill = (await runtime.capabilities(project.id)).find(item => item.kind === 'skill')!

    expect(updatedSkill.id).not.toBe(skill.id)
    await expect(runtime.capabilityPins(project.id)).resolves.toEqual({
      projectId: project.id,
      capabilityIds: [updatedSkill.id, command.id],
    })
    await expect(runtime
      .updateCapabilityPins(project.id, [command.id, command.id]))
      .rejects
      .toThrow('must be unique')
  })
})

describe('trusted execution', () => {
  it('previews validated command inputs as structured arguments', async () => {
    const root = await fixture()
    await writeProjectConfig(root, {
      version: 1,
      capabilities: {
        inputs: {
          'package.json:hello': {
            environment: { type: 'select', options: ['dev', 'staging'], default: 'dev', flag: '--env' },
            account: {
              type: 'text',
              pattern: '^\\d+$',
              flag: '--account',
              visibleWhen: { input: 'environment', equals: 'dev' },
              requiredWhen: { input: 'environment', equals: 'dev' },
            },
          },
        },
      },
    })
    const runtime = new CraftHubRuntime(join(root, '.input-data'))
    const project = await runtime.addProject(root)
    const command = (await runtime.capabilities(project.id)).find(item => item.kind === 'command')!

    await expect(runtime.previewCommand(project.id, command.id, { environment: 'dev', account: '12345' }))
      .resolves
      .toMatchObject({ args: ['run', 'hello', '--', '--env=dev', '--account=12345'] })
    await expect(runtime.previewCommand(project.id, command.id, { environment: 'staging', account: '12345' }))
      .resolves
      .toMatchObject({ args: ['run', 'hello', '--', '--env=staging'] })
    await expect(runtime.previewCommand(project.id, command.id, { environment: 'release' }))
      .rejects
      .toThrow('must be one of')
    await expect(runtime.previewCommand(project.id, command.id, { environment: 'dev' }))
      .rejects
      .toThrow('account is required')
  })

  it('omits argv for select options configured as display-only choices', async () => {
    const root = await fixture()
    await writeProjectConfig(root, {
      version: 1,
      capabilities: {
        inputs: {
          'package.json:hello': {
            target: {
              type: 'select',
              options: [
                { value: 'current', label: 'Current developer', omitArgument: true },
                { value: '12345', label: 'Named account' },
              ],
              default: 'current',
              flag: '--account',
            },
          },
        },
      },
    })
    const runtime = new CraftHubRuntime(join(root, '.input-data'))
    const project = await runtime.addProject(root)
    const command = (await runtime.capabilities(project.id)).find(item => item.kind === 'command')!

    await expect(runtime.previewCommand(project.id, command.id))
      .resolves
      .toMatchObject({ args: ['run', 'hello'] })
    await expect(runtime.previewCommand(project.id, command.id, { target: '12345' }))
      .resolves
      .toMatchObject({ args: ['run', 'hello', '--', '--account=12345'] })
  })

  it('appends boolean flags without values and supports conjunctive visibility conditions', async () => {
    const root = await fixture()
    await writeProjectConfig(root, {
      version: 1,
      capabilities: {
        inputs: {
          'package.json:hello': {
            environment: { type: 'select', options: ['dev', 'staging'], default: 'dev', flag: '--env' },
            askAccount: { type: 'boolean', default: 'false', flag: '--ask-account' },
            account: {
              type: 'text',
              flag: '--account',
              visibleWhen: [
                { input: 'environment', equals: 'dev' },
                { input: 'askAccount', equals: 'false' },
              ],
            },
            silent: { type: 'boolean', default: 'false', flag: '--silent' },
            confirm: { type: 'boolean', default: 'false', flag: '--confirm', requiredWhen: { input: 'environment', equals: 'staging' } },
          },
        },
      },
    })
    const runtime = new CraftHubRuntime(join(root, '.input-data'))
    const project = await runtime.addProject(root)
    const command = (await runtime.capabilities(project.id)).find(item => item.kind === 'command')!

    await expect(runtime.previewCommand(project.id, command.id, { environment: 'dev', askAccount: 'true', account: '12345', silent: 'true' }))
      .resolves
      .toMatchObject({ args: ['run', 'hello', '--', '--env=dev', '--ask-account', '--silent'] })
    await expect(runtime.previewCommand(project.id, command.id, { environment: 'dev', askAccount: 'false', account: '12345', silent: 'false' }))
      .resolves
      .toMatchObject({ args: ['run', 'hello', '--', '--env=dev', '--account=12345'] })
    await expect(runtime.previewCommand(project.id, command.id, { environment: 'dev', askAccount: 'sometimes' }))
      .rejects
      .toThrow('must be true or false')
    await expect(runtime.previewCommand(project.id, command.id, { environment: 'staging', confirm: 'false' }))
      .rejects
      .toThrow('confirm is required')
  })

  it('blocks untrusted projects and captures output after trust', async () => {
    const root = await fixture()
    const runtime = new CraftHubRuntime(join(root, '.data'))
    const project = await runtime.addProject(root)
    expect(project.name).toBe('Test Project')
    const command = (await runtime.capabilities(project.id)).find(item => item.kind === 'command')!

    await expect(runtime.run(project.id, command.id)).rejects.toThrow('untrusted')

    await runtime.projects.setTrust(project.id, 'trusted')
    const handle = await runtime.run(project.id, command.id)
    const run = await handle.completion
    expect(run.status).toBe('completed')
    expect(run.exitCode).toBe(0)
    expect(run.stdout).toContain('hello')
  })

  it('forwards input and resize events through an active PTY run', async () => {
    const root = await fixture()
    await writeFile(join(root, 'package.json'), JSON.stringify({
      scripts: {
        interactive: `node -e "process.stdin.once('data', data => { console.log('echo:' + data.toString().trim()); process.exit(0) })"`,
      },
    }))
    const runtime = new CraftHubRuntime(join(root, '.interactive-data'))
    const project = await runtime.addProject(root)
    await runtime.projects.setTrust(project.id, 'trusted')
    const command = (await runtime.capabilities(project.id)).find(item => item.name === 'interactive')!

    const handle = await runtime.run(project.id, command.id)
    runtime.resizeRun(handle.run.id, 100, 24)
    runtime.writeRun(handle.run.id, 'hello from pty\r')
    const run = await handle.completion

    expect(run.status).toBe('completed')
    expect(run.stdout).toContain('echo:hello from pty')
  })

  it('cancels an active PTY run', async () => {
    const root = await fixture()
    await writeFile(join(root, 'package.json'), JSON.stringify({
      scripts: { watch: `node -e "setInterval(() => {}, 1000)"` },
    }))
    const runtime = new CraftHubRuntime(join(root, '.cancel-data'))
    const project = await runtime.addProject(root)
    await runtime.projects.setTrust(project.id, 'trusted')
    const command = (await runtime.capabilities(project.id)).find(item => item.name === 'watch')!

    const summaries: Array<{ running: number, lastStatus?: string }> = []
    const stopListening = runtime.onRunsChanged(summary => summaries.push(summary))
    const handle = await runtime.run(project.id, command.id)
    expect(runtime.projectRunSummaries()).toEqual([
      expect.objectContaining({ projectId: project.id, running: 1 }),
    ])
    const run = await runtime.cancelRun(handle.run.id)

    expect(run.status).toBe('cancelled')
    expect(summaries).toEqual([
      expect.objectContaining({ running: 1 }),
      expect.objectContaining({ running: 0, lastStatus: 'cancelled' }),
    ])
    stopListening()
    await expect(runtime.cancelRun(handle.run.id)).rejects.toThrow('Unknown active run')
  })

  it('marks non-zero command exits as failed', async () => {
    const root = await fixture()
    await writeFile(join(root, 'package.json'), JSON.stringify({
      scripts: { fail: `node -e "process.exit(7)"` },
    }))
    const runtime = new CraftHubRuntime(join(root, '.failure-data'))
    const project = await runtime.addProject(root)
    await runtime.projects.setTrust(project.id, 'trusted')
    const command = (await runtime.capabilities(project.id)).find(item => item.name === 'fail')!

    const run = await (await runtime.run(project.id, command.id)).completion

    expect(run).toMatchObject({ status: 'failed', exitCode: 7 })
    expect(runtime.projectRunSummaries()).toEqual([
      expect.objectContaining({ projectId: project.id, running: 0, lastStatus: 'failed' }),
    ])
  })
})

describe('downstream distributions', () => {
  it('reads known metadata and preserves namespaced extension data', async () => {
    const root = await downstreamFixture()
    const runtime = createCraftHub({ dataDir: join(root, '.data') })

    await expect(runtime.addProject(root)).resolves.toMatchObject({ name: 'Downstream Project' })
  })

  it('combines built-in discovery with validated provider capabilities', async () => {
    const root = await fixture()
    const runtime = createCraftHub({
      dataDir: join(root, '.distribution-data'),
      distribution: { id: 'test', name: 'Craft Hub Test' },
      capabilityProviders: [defineCapabilityProvider({
        id: 'test-provider',
        async discover({ project }) {
          return [{
            id: 'test:inspect',
            kind: 'command',
            name: 'inspect-test-project',
            source: 'package.json',
            invocation: { command: 'node', args: ['--version'], cwd: project.path, requiredEnv: [] },
          }]
        },
      })],
    })
    const project = await runtime.addProject(root)
    expect(runtime.distribution.name).toBe('Craft Hub Test')
    expect((await runtime.capabilities(project.id)).map(item => item.name)).toContain('inspect-test-project')
  })

  it('allows command working directories inside a project and rejects paths outside it', async () => {
    const root = await fixture()
    const child = join(root, 'apps', 'web')
    const outside = await mkdtemp(join(tmpdir(), 'craft-hub-outside-'))
    await mkdir(child, { recursive: true })
    const provider = (cwd: string) => defineCapabilityProvider({
      id: `cwd:${cwd}`,
      async discover() {
        return [{
          id: `cwd:${cwd}`,
          kind: 'command' as const,
          name: 'cwd-check',
          source: 'provider',
          invocation: { command: 'node', args: ['--version'], cwd, requiredEnv: [] },
        }]
      },
    })
    const allowed = createCraftHub({ dataDir: join(root, '.child-cwd-data'), capabilityProviders: [provider(child)] })
    const allowedProject = await allowed.addProject(root)
    await expect(allowed.capabilities(allowedProject.id)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'cwd-check', invocation: expect.objectContaining({ cwd: child }) }),
    ]))

    const rejected = createCraftHub({ dataDir: join(root, '.outside-cwd-data'), capabilityProviders: [provider(outside)] })
    const rejectedProject = await rejected.addProject(root)
    await expect(rejected.capabilities(rejectedProject.id)).rejects.toThrow('must stay inside')
  })

  it('isolates a broken plugin while keeping healthy capabilities available', async () => {
    const root = await fixture()
    const runtime = createCraftHub({
      dataDir: join(root, '.plugin-data'),
      plugins: [defineCraftHubPlugin({
        id: 'broken-plugin',
        capabilityProviders: [{
          id: 'broken-provider',
          async discover() {
            throw new Error('plugin unavailable')
          },
        }],
      })],
    })
    const project = await runtime.addProject(root)

    expect((await runtime.capabilities(project.id)).map(item => item.name)).toContain('hello')
    expect(runtime.getPluginDiagnostics()).toEqual([{
      pluginId: 'broken-plugin',
      phase: 'discover',
      message: 'plugin unavailable',
    }])
  })

  it('loads trusted installed modules and reports invalid plugins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-plugins-'))
    await writeFile(join(root, 'valid.mjs'), `export default { id: 'local-plugin', capabilityProviders: [] }`)
    await writeFile(join(root, 'invalid.mjs'), `export default { capabilityProviders: [] }`)

    const result = await loadCraftHubPlugins(['./valid.mjs', './invalid.mjs'], { baseDir: root })

    expect(result.plugins.map(plugin => plugin.id)).toEqual(['local-plugin'])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.pluginId).toBe('./invalid.mjs')
  })
})

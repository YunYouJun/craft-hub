import type { PluginCommandContributions } from '../src/command-contributions'
import type { ProjectCommandInputConfig } from '../src/project-config-schema'
import type { CommandCapability, CommandPackage } from '../src/types'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveCommandContributions } from '../src/command-contributions'
import { resolveCommandInvocation } from '../src/command-inputs'

const widgetPackage: CommandPackage = { name: '@example/widget', relativePath: 'apps/widget', root: false }

function command(root: string, name: string): CommandCapability {
  return {
    id: `command:${name}`,
    kind: 'command',
    name,
    source: 'apps/widget/package.json',
    package: widgetPackage,
    invocation: { command: 'pnpm', args: ['run', name], cwd: join(root, 'apps/widget'), requiredEnv: [] },
  }
}

function plugin(inputs: Record<string, ProjectCommandInputConfig> = { environment: { type: 'select', flag: '--env', options: ['dev', 'release'], default: 'dev' } }): PluginCommandContributions {
  return {
    pluginId: '@acme/craft-hub-plugin-deploy',
    source: 'plugin:@acme/craft-hub-plugin-deploy@1.0.0',
    presets: [{
      id: 'deploy-inputs',
      commands: ['deploy'],
      unlessCommands: [],
      package: { allFiles: ['package.json'], anyFiles: ['widget.config.ts', 'widget.config.js'] },
      inputs,
      optionSources: {},
      applyToCommands: true,
    }],
    templates: [{
      id: 'deploy-command',
      name: 'deploy',
      description: 'Deploy an existing widget build.',
      category: 'deploy',
      package: { allFiles: ['package.json'], anyFiles: ['widget.config.ts', 'widget.config.js'] },
      unlessCommands: ['deploy'],
      command: 'widget-cli',
      args: ['deploy'],
      requiredEnv: [],
      prerequisites: [],
      inputs,
    }],
    packageQuickActions: [],
  }
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-contributions-'))
  await mkdir(join(root, 'apps/widget'), { recursive: true })
  await writeFile(join(root, 'apps/widget/package.json'), '{}')
  await writeFile(join(root, 'apps/widget/widget.config.ts'), 'export default { appId: \'widget/123\' }')
  await mkdir(join(root, 'apps/widget/src'), { recursive: true })
  await writeFile(join(root, 'apps/widget/src/app.json'), JSON.stringify({ pages: [{ page: 'pages/home/index' }, { page: 'pages/detail/index' }] }))
  return root
}

describe('declarative command contributions', () => {
  it('recognizes a root release script as a guarded operation and applies project policy', async () => {
    const root = await fixture()
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { release: 'bumpp -r' } }))
    await mkdir(join(root, '.craft-hub'), { recursive: true })
    await writeFile(join(root, '.craft-hub/project.jsonc'), JSON.stringify({
      version: 1,
      capabilities: { operations: { 'package.json:release': { kind: 'release', requiredBranch: 'main', workflowPath: '.github/workflows/release.yml' } } },
    }))
    const release: CommandCapability = {
      id: 'release',
      kind: 'command',
      name: 'release',
      source: 'package.json',
      package: { relativePath: '.', root: true },
      invocation: { command: 'pnpm', args: ['run', 'release'], cwd: root, requiredEnv: [] },
    }

    const result = await resolveCommandContributions({ projectPath: root, locale: 'en', capabilities: [release], packages: [{ relativePath: '.', root: true }], plugins: [] })
    expect(result.capabilities[0]).toMatchObject({
      operation: { kind: 'release', requiresCleanGit: true, requiredBranch: 'main', workflowPath: '.github/workflows/release.yml' },
    })
  })

  it('enhances an existing package script and keeps that script authoritative', async () => {
    const root = await fixture()
    const existing = command(root, 'deploy')
    const result = await resolveCommandContributions({ projectPath: root, locale: 'en', capabilities: [existing], packages: [{ relativePath: '.', root: true }, widgetPackage], plugins: [plugin()] })

    expect(result.diagnostics).toEqual([])
    expect(result.capabilities).toHaveLength(1)
    expect(result.capabilities[0]).toMatchObject({
      id: existing.id,
      invocation: { command: 'pnpm', args: ['run', 'deploy'] },
      inputArgSeparator: '--',
      inputs: [expect.objectContaining({ id: 'environment', default: 'dev' })],
    })
  })

  it('preserves host-rendered icons on declarative select options', async () => {
    const root = await fixture()
    const existing = command(root, 'deploy')
    const contribution = plugin({
      editor: {
        type: 'select',
        flag: '--editor',
        default: 'default',
        options: [
          { value: 'default', omitArgument: true },
          { value: 'code', label: 'Code', icon: 'vscode' },
        ],
      },
    })

    const result = await resolveCommandContributions({ projectPath: root, locale: 'en', capabilities: [existing], packages: [{ relativePath: '.', root: true }, widgetPackage], plugins: [contribution] })

    expect((result.capabilities[0] as CommandCapability).inputs?.[0]?.options).toEqual([
      { value: 'default', omitArgument: true },
      { value: 'code', label: 'Code', icon: 'vscode' },
    ])
  })

  it('keeps repository scripts untouched when a preset is template-only', async () => {
    const root = await fixture()
    const existing = command(root, 'deploy')
    const contribution = plugin()
    contribution.presets[0]!.applyToCommands = false
    contribution.templates[0]!.unlessCommands = []
    contribution.templates[0]!.name = 'Widget deploy'
    contribution.templates[0]!.command = 'pnpm'
    contribution.templates[0]!.args = ['exec', 'widget-cli', 'deploy']
    contribution.templates[0]!.toolGroup = 'widget'
    contribution.packageToolGroups = [{
      id: 'widget',
      title: { 'default': 'Widget tools', 'zh-CN': '组件工具' },
      package: { allFiles: ['package.json'], anyFiles: ['widget.config.ts'] },
    }]

    const result = await resolveCommandContributions({ projectPath: root, locale: 'zh-CN', capabilities: [existing], packages: [widgetPackage], plugins: [contribution] })

    expect(result.capabilities).toHaveLength(2)
    expect(result.capabilities[0]).toMatchObject({
      id: existing.id,
      invocation: existing.invocation,
    })
    expect(result.capabilities[0]).not.toHaveProperty('inputs')
    expect(result.capabilities[1]).toMatchObject({
      name: 'Widget deploy',
      toolGroupId: '@acme/craft-hub-plugin-deploy:widget',
      invocation: { command: 'pnpm', args: ['exec', 'widget-cli', 'deploy'] },
      inputs: [expect.objectContaining({ id: 'environment' })],
    })
    expect(result.packages[0]).toMatchObject({
      toolGroups: [{ id: '@acme/craft-hub-plugin-deploy:widget', title: '组件工具' }],
    })
  })

  it('instantiates a direct command only when the package script is absent', async () => {
    const root = await fixture()
    const result = await resolveCommandContributions({ projectPath: root, locale: 'en', capabilities: [], packages: [{ relativePath: '.', root: true }, widgetPackage], plugins: [plugin()] })

    expect(result.capabilities).toEqual([
      expect.objectContaining({
        kind: 'command',
        name: 'deploy',
        package: widgetPackage,
        invocation: { command: 'widget-cli', args: ['deploy'], cwd: join(root, 'apps/widget'), requiredEnv: [] },
      }),
    ])
  })

  it('runs structured prerequisite commands before a parameterized template command', async () => {
    const root = await fixture()
    const contribution = plugin()
    contribution.templates[0]!.command = 'pnpm'
    contribution.templates[0]!.args = ['exec', 'widget-cli', 'deploy']
    contribution.templates[0]!.prerequisites = [{
      label: { 'default': 'Compile', 'zh-CN': '编译' },
      command: 'pnpm',
      args: ['exec', 'widget-cli', 'build'],
      requiredEnv: [],
      when: { input: 'compileBeforeDeploy', equals: 'true' },
    }]
    contribution.templates[0]!.inputs = {
      environment: { type: 'select', flag: '--env', options: ['dev', 'release'], default: 'dev' },
      compileBeforeDeploy: { type: 'boolean', omitArgument: true, default: 'true' },
    }

    const result = await resolveCommandContributions({
      projectPath: root,
      locale: 'zh-CN',
      capabilities: [],
      packages: [widgetPackage],
      plugins: [contribution],
    })
    const capability = result.capabilities[0] as CommandCapability

    expect(capability.invocation).toMatchObject({
      command: 'pnpm',
      args: ['exec', 'widget-cli', 'deploy'],
      prerequisites: [{ label: '编译', command: 'pnpm', args: ['exec', 'widget-cli', 'build'] }],
    })
    expect(resolveCommandInvocation(capability, { environment: 'release', compileBeforeDeploy: 'true' })).toMatchObject({
      args: ['exec', 'widget-cli', 'deploy', '--env=release'],
      prerequisites: [{ args: ['exec', 'widget-cli', 'build'] }],
    })
    expect(resolveCommandInvocation(capability, { environment: 'release', compileBeforeDeploy: 'false' })).not.toHaveProperty('prerequisites')
  })

  it('contributes capability selectors to matching package overviews', async () => {
    const root = await fixture()
    const existing = command(root, 'deploy')
    const contribution = {
      ...plugin(),
      presets: [],
      templates: [],
      packageQuickActions: [{
        id: 'widget-actions',
        package: { allFiles: ['package.json'], anyFiles: ['widget.config.ts'] },
        capabilities: ['widget-assistant', 'deploy'],
      }],
    }

    const result = await resolveCommandContributions({
      projectPath: root,
      locale: 'en',
      capabilities: [existing],
      packages: [{ relativePath: '.', root: true }, widgetPackage],
      plugins: [contribution],
    })

    expect(result.packages).toEqual([
      { relativePath: '.', root: true },
      { ...widgetPackage, quickActions: ['widget-assistant', 'deploy'] },
    ])
    expect(result.capabilities[0]).toMatchObject({
      package: { relativePath: 'apps/widget', quickActions: ['widget-assistant', 'deploy'] },
    })
  })

  it('resolves an HTTPS package link from a bounded quoted config literal', async () => {
    const root = await fixture()
    const contribution: PluginCommandContributions = {
      ...plugin(),
      presets: [],
      templates: [],
      packageLinks: [{
        id: 'widget-console',
        title: { 'default': 'Widget console', 'zh-CN': '组件控制台' },
        description: 'Open the widget operations console.',
        package: { allFiles: ['package.json'], anyFiles: ['widget.config.ts'] },
        urlTemplate: 'https://widgets.example.com/console/{value}',
        value: { files: ['widget.config.ts'], key: 'appId' },
        toolGroup: 'widget',
      }],
      packageToolGroups: [{
        id: 'widget',
        title: 'Widget tools',
        package: { allFiles: ['package.json'], anyFiles: ['widget.config.ts'] },
      }],
    }

    const result = await resolveCommandContributions({
      projectPath: root,
      locale: 'zh-CN',
      capabilities: [],
      packages: [{ relativePath: '.', root: true }, widgetPackage],
      plugins: [contribution],
    })

    expect(result.packages[1]).toMatchObject({
      links: [{
        id: '@acme/craft-hub-plugin-deploy:widget-console',
        title: '组件控制台',
        description: 'Open the widget operations console.',
        url: 'https://widgets.example.com/console/widget%2F123',
        source: 'plugin:@acme/craft-hub-plugin-deploy@1.0.0',
        toolGroupId: '@acme/craft-hub-plugin-deploy:widget',
      }],
      toolGroups: [expect.objectContaining({ id: '@acme/craft-hub-plugin-deploy:widget', title: 'Widget tools' })],
    })
  })

  it('extends select inputs from bounded package JSON and user settings', async () => {
    const root = await fixture()
    const contribution = plugin({
      account: { type: 'select', flag: '--account', default: 'default', options: [{ value: 'default', omitArgument: true }] },
      entry: { type: 'select', flag: '--entry', default: 'default', options: [{ value: 'default', omitArgument: true }] },
    })
    contribution.presets[0]!.optionSources = {
      account: { type: 'user-setting', key: 'extensions.example-widget.accounts' },
      entry: { type: 'package-json-array', files: ['src/app.json'], path: ['pages'], valueKey: 'page' },
    }

    const result = await resolveCommandContributions({
      projectPath: root,
      locale: 'en',
      capabilities: [command(root, 'deploy')],
      packages: [widgetPackage],
      plugins: [contribution],
      userSettings: {
        'extensions.example-widget.accounts': [{ value: '10001', label: 'QA account' }, '10002'],
      },
    })

    expect((result.capabilities[0] as CommandCapability).inputs).toEqual([
      expect.objectContaining({ id: 'account', options: [{ value: 'default', omitArgument: true }, { value: '10001', label: 'QA account' }, { value: '10002' }] }),
      expect.objectContaining({ id: 'entry', options: [{ value: 'default', omitArgument: true }, { value: 'pages/home/index' }, { value: 'pages/detail/index' }] }),
    ])
    expect(resolveCommandInvocation(result.capabilities[0] as CommandCapability).args).toEqual(['run', 'deploy'])
    expect(resolveCommandInvocation(result.capabilities[0] as CommandCapability, { account: '10001', entry: 'pages/detail/index' }).args).toEqual(['run', 'deploy', '--', '--account=10001', '--entry=pages/detail/index'])
  })

  it('reports cross-plugin input conflicts without silently choosing a value', async () => {
    const root = await fixture()
    const second = { ...plugin({ environment: { type: 'text' as const, flag: '--target' } }), pluginId: '@acme/craft-hub-plugin-conflict', templates: [] }
    const result = await resolveCommandContributions({ projectPath: root, locale: 'en', capabilities: [command(root, 'deploy')], packages: [widgetPackage], plugins: [plugin(), second] })

    expect(result.capabilities[0]).not.toHaveProperty('inputs')
    expect(result.diagnostics).toEqual([expect.objectContaining({ source: 'plugin', message: expect.stringContaining('conflicting plugin input "environment"') })])
  })

  it('lets project JSONC disable a qualified preset and template', async () => {
    const root = await fixture()
    await mkdir(join(root, '.craft-hub'))
    await writeFile(join(root, '.craft-hub/project.jsonc'), JSON.stringify({ version: 1, capabilities: { disabledPresets: ['@acme/craft-hub-plugin-deploy:deploy-inputs'] } }))
    const result = await resolveCommandContributions({ projectPath: root, locale: 'en', capabilities: [command(root, 'deploy')], packages: [widgetPackage], plugins: [plugin()] })

    expect(result.capabilities).toEqual([command(root, 'deploy')])
  })
})

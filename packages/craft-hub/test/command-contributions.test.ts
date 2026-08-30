import type { PluginCommandContributions } from '../src/command-contributions'
import type { ProjectCommandInputConfig } from '../src/project-config-schema'
import type { CommandCapability, CommandPackage } from '../src/types'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveCommandContributions } from '../src/command-contributions'

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
      inputs,
    }],
  }
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-contributions-'))
  await mkdir(join(root, 'apps/widget'), { recursive: true })
  await writeFile(join(root, 'apps/widget/package.json'), '{}')
  await writeFile(join(root, 'apps/widget/widget.config.ts'), 'export default {}')
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

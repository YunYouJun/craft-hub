import type { CommandCapability } from 'craft-hub'
import { describe, expect, it } from 'vitest'
import { compareOverviewPackages, packageOverviewRows } from './package-overview'

const command: CommandCapability = {
  id: 'dev',
  kind: 'command',
  name: 'dev',
  source: 'apps/web/package.json',
  package: { relativePath: 'apps/web', root: false },
  invocation: { command: 'pnpm', args: ['run', 'dev'], cwd: '/project/apps/web', requiredEnv: [] },
}

describe('package overview helpers', () => {
  it('keeps packages without commands and aggregates discovered package commands', () => {
    expect(packageOverviewRows([
      { relativePath: '.', root: true },
      { relativePath: 'apps/web', root: false },
      { relativePath: 'packages/empty', root: false },
    ], [command])).toMatchObject([
      { relativePath: '.', capabilities: [] },
      { relativePath: 'apps/web', capabilities: [{ id: 'dev' }] },
      { relativePath: 'packages/empty', capabilities: [] },
    ])
  })

  it('uses configured order before stable package groups', () => {
    const packages = [
      { relativePath: 'packages/core', root: false },
      { relativePath: 'apps/web', root: false },
      { relativePath: 'docs', root: false, order: 1 },
    ]
    expect(packages.sort(compareOverviewPackages).map(item => item.relativePath)).toEqual(['docs', 'apps/web', 'packages/core'])
  })
})

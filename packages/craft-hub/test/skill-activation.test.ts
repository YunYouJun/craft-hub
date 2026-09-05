import type { SkillActivationCondition } from '../src/skill-activation'
import type { CommandPackage } from '../src/types'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveSkillActivations, skillActivationConditionSchema } from '../src/skill-activation'

const pluginId = '@example/craft-hub-plugin-vue'

async function fixture(): Promise<{ projectPath: string, pluginPath: string, packages: CommandPackage[] }> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-skill-activation-'))
  const projectPath = join(root, 'project')
  const pluginPath = join(root, 'plugin')
  await mkdir(join(projectPath, 'packages', 'web'), { recursive: true })
  await mkdir(join(projectPath, 'packages', 'api'), { recursive: true })
  await mkdir(join(pluginPath, 'skills', 'review'), { recursive: true })
  await writeFile(join(projectPath, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.0.0' }))
  await writeFile(join(projectPath, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
  await writeFile(join(projectPath, 'packages', 'web', 'package.json'), JSON.stringify({ name: 'web', devDependencies: { vue: '^3.0.0' } }))
  await writeFile(join(projectPath, 'packages', 'api', 'package.json'), JSON.stringify({ name: 'api' }))
  await writeFile(join(pluginPath, 'skills', 'review', 'SKILL.md'), '---\nname: vue-review\ndescription: Review Vue code.\n---\n\n# Review\n')
  return {
    projectPath,
    pluginPath,
    packages: [
      { relativePath: '.', root: true },
      { relativePath: 'packages/web', root: false, name: 'web' },
      { relativePath: 'packages/api', root: false, name: 'api' },
    ],
  }
}

function contribution(pluginPath: string, activation: SkillActivationCondition | undefined = { dependency: 'vue' }) {
  return {
    pluginId,
    version: '1.0.0',
    source: `plugin:${pluginId}@1.0.0`,
    packagePath: pluginPath,
    projectFiles: ['package.json'],
    skill: { id: 'review', path: 'skills/review/SKILL.md', activation },
  }
}

describe('marketplace Skill activation', () => {
  it('keeps activation-capable Skills manual until the project opts into auto discovery', async () => {
    const { projectPath, pluginPath, packages } = await fixture()
    const result = await resolveSkillActivations({ projectPath, packages, contributions: [contribution(pluginPath)] })

    expect(result.mode).toBe('manual')
    expect(result.capabilities).toEqual([])
    expect(result.skills).toEqual([expect.objectContaining({ status: 'manual-only' })])
    expect(result.watchPatterns).toEqual([])
  })

  it('activates only matching packages and returns structured evidence in auto mode', async () => {
    const { projectPath, pluginPath, packages } = await fixture()
    const result = await resolveSkillActivations({ projectPath, packages, contributions: [contribution(pluginPath)], project: { mode: 'auto' } })

    expect(result.capabilities).toEqual([
      expect.objectContaining({
        id: `plugin:${pluginId}:skill:review`,
        name: 'vue-review',
        activation: {
          source: 'automatic',
          scopes: [expect.objectContaining({ relativePath: 'packages/web', packageName: 'web', evidence: expect.arrayContaining([
            expect.objectContaining({ kind: 'dependency', expected: 'vue', matched: true, path: 'packages/web/package.json' }),
          ]) })],
        },
      }),
    ])
    expect(result.skills[0]).toMatchObject({ status: 'enabled', scopes: [{ relativePath: 'packages/web' }] })
    expect(result.watchPatterns).toContain('packages/web/package.json')
  })

  it('applies the root package manager fact to every discovered pnpm package', async () => {
    const { projectPath, pluginPath, packages } = await fixture()
    const managerContribution = contribution(pluginPath, undefined)
    managerContribution.skill.activation = { packageManager: 'pnpm' }
    const result = await resolveSkillActivations({ projectPath, packages, contributions: [managerContribution], project: { mode: 'auto' } })

    expect(result.capabilities[0]?.activation?.scopes.map(scope => scope.relativePath)).toEqual(['.', 'packages/api', 'packages/web'])
    expect(result.watchPatterns).toEqual(expect.arrayContaining(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']))
  })

  it('lets local scoped disables override project plugin enablement', async () => {
    const { projectPath, pluginPath, packages } = await fixture()
    const id = `plugin:${pluginId}:skill:review`
    const result = await resolveSkillActivations({
      projectPath,
      packages,
      contributions: [contribution(pluginPath, undefined)],
      project: { enabledPlugins: [pluginId], enabled: [{ id, scopes: ['packages/web'] }] },
      local: { disabled: [{ id, scopes: ['packages/web'] }] },
    })

    expect(result.capabilities[0]?.activation).toMatchObject({ source: 'local', scopes: [{ relativePath: '.' }] })
    expect(result.skills[0]).toMatchObject({ status: 'enabled' })
  })

  it('lets a local plugin disable override project defaults while a local Skill rule adds an exception', async () => {
    const { projectPath, pluginPath, packages } = await fixture()
    const id = `plugin:${pluginId}:skill:review`
    const result = await resolveSkillActivations({
      projectPath,
      packages,
      contributions: [contribution(pluginPath, undefined)],
      project: { enabledPlugins: [pluginId] },
      local: { disabledPlugins: [pluginId], enabled: [{ id, scopes: ['packages/web'] }] },
    })

    expect(result.capabilities[0]?.activation).toMatchObject({ source: 'local', scopes: [{ relativePath: 'packages/web' }] })
  })

  it('isolates an unreadable Skill as a non-fatal diagnostic', async () => {
    const { projectPath, pluginPath, packages } = await fixture()
    const broken = contribution(pluginPath, undefined)
    broken.skill.path = 'skills/missing/SKILL.md'
    const result = await resolveSkillActivations({ projectPath, packages, contributions: [broken], local: { enabledPlugins: [pluginId] } })

    expect(result.capabilities).toEqual([])
    expect(result.skills).toEqual([expect.objectContaining({ name: 'review', status: 'disabled' })])
    expect(result.diagnostics).toEqual([expect.objectContaining({ source: 'plugin', path: `${pluginId}:skills/missing/SKILL.md` })])
  })

  it('rejects unbounded and deeply nested matcher declarations', () => {
    expect(skillActivationConditionSchema.safeParse({ file: '../secret' }).success).toBe(false)
    let condition: unknown = { file: 'package.json' }
    for (let index = 0; index < 9; index += 1)
      condition = { not: condition }
    expect(skillActivationConditionSchema.safeParse(condition).success).toBe(false)
  })
})

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CraftHubStore } from '../src/index'

describe('skill activation persistence', () => {
  it('atomically preserves pins and Skill settings across concurrent writes', async () => {
    const store = new CraftHubStore(await mkdtemp(join(tmpdir(), 'craft-hub-skill-state-')))

    await Promise.all([
      store.saveCapabilityPins('project', [{ id: 'test', kind: 'command', name: 'test', source: 'package.json' }]),
      store.saveSkillActivation('project', { mode: 'auto', enabledPlugins: ['example-plugin'], selectedScopes: { 'example:skill': 'apps/web' } }),
    ])

    await expect(store.getCapabilityPins('project')).resolves.toEqual([expect.objectContaining({ id: 'test' })])
    await expect(store.getSkillActivation('project')).resolves.toEqual({
      mode: 'auto',
      enabledPlugins: ['example-plugin'],
      selectedScopes: { 'example:skill': 'apps/web' },
    })
  })
})

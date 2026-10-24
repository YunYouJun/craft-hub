import type { ProfileIdentityContext, ProfileIdentityParticipant } from '../../src/profile-migration'
import { readFile, writeFile } from 'node:fs/promises'

/** Public-state fixture for process-crash tests; never represents a production vault or contains a device secret. */
export function fixtureIdentityParticipant(file: string): ProfileIdentityParticipant {
  type State = 'empty' | 'staged' | 'activated' | 'active'
  async function inspect(context: ProfileIdentityContext): Promise<State> {
    const value = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT')
        throw error
    })
    if (!value)
      return 'empty'
    const current = JSON.parse(value) as { state: State, context: ProfileIdentityContext }
    if (current.state !== 'empty' && JSON.stringify(current.context) !== JSON.stringify(context))
      throw new Error('Another fixture identity owns the destination')
    return current.state
  }
  async function save(context: ProfileIdentityContext, state: State): Promise<void> {
    await writeFile(file, JSON.stringify({ context, state }), { mode: 0o600 })
  }
  return {
    inspect,
    async stage(context) {
      if (await inspect(context) !== 'empty')
        throw new Error('Fixture destination is occupied')
      await save(context, 'staged')
    },
    async activate(context) {
      if (!['staged', 'activated'].includes(await inspect(context)))
        throw new Error('Fixture is not staged')
      await save(context, 'activated')
    },
    async finish(context) {
      if (await inspect(context) !== 'activated')
        throw new Error('Fixture is not activated')
      await save(context, 'active')
    },
    async rollback(context) {
      await inspect(context)
      await save(context, 'empty')
    },
  }
}

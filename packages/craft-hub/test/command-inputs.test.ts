import type { CommandCapability } from '../src/types'
import { describe, expect, it } from 'vitest'
import { resolveCommandInvocation, resolvePersistedCommandInvocation } from '../src/command-inputs'

describe('command input history privacy', () => {
  it('keeps private identifiers in the live invocation and redacts persisted args', () => {
    const capability: CommandCapability = {
      id: 'deploy',
      kind: 'command',
      name: 'deploy',
      source: 'package.json',
      invocation: { command: 'deploy-tool', args: ['deploy'], cwd: '/project', requiredEnv: [] },
      inputs: [{ id: 'account', type: 'text', flag: '--account', private: true, redactInHistory: true }],
    }

    expect(resolveCommandInvocation(capability, { account: '123456' }).args).toEqual(['deploy', '--account=123456'])
    expect(resolvePersistedCommandInvocation(capability, { account: '123456' }).args).toEqual(['deploy', '--account=<redacted>'])
  })
})

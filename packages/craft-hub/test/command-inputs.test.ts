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

  it('uses an argument-free boolean input to conditionally include a prerequisite', () => {
    const capability: CommandCapability = {
      id: 'deploy',
      kind: 'command',
      name: 'deploy',
      source: 'plugin:test',
      invocation: {
        command: 'deploy-tool',
        args: ['deploy'],
        cwd: '/project',
        requiredEnv: [],
        prerequisites: [{
          command: 'build-tool',
          args: ['build'],
          cwd: '/project',
          requiredEnv: [],
          when: { input: 'compileBeforeDeploy', equals: 'true' },
        }],
      },
      inputs: [{ id: 'compileBeforeDeploy', type: 'boolean', default: 'true', omitArgument: true }],
    }

    expect(resolveCommandInvocation(capability)).toMatchObject({
      args: ['deploy'],
      prerequisites: [{ command: 'build-tool', args: ['build'] }],
    })
    expect(resolveCommandInvocation(capability, { compileBeforeDeploy: 'false' })).toEqual({
      command: 'deploy-tool',
      args: ['deploy'],
      cwd: '/project',
      requiredEnv: [],
    })
  })

  it('resolves validated positional inputs in declaration order without a shell', () => {
    const capability: CommandCapability = {
      id: 'logs',
      kind: 'command',
      name: 'logs',
      source: 'plugin:test',
      invocation: { command: 'deploy-tool', args: ['logs'], cwd: '/project', requiredEnv: [] },
      inputs: [
        { id: 'pipelineId', type: 'text', required: true, argumentStyle: 'positional', redactInHistory: true },
        { id: 'tail', type: 'text', flag: '--tail', argumentStyle: 'separate' },
      ],
    }

    expect(resolveCommandInvocation(capability, { pipelineId: 'pipeline-123', tail: '20' }).args)
      .toEqual(['logs', 'pipeline-123', '--tail', '20'])
    expect(resolvePersistedCommandInvocation(capability, { pipelineId: 'pipeline-123', tail: '20' }).args)
      .toEqual(['logs', '<redacted>', '--tail', '20'])
  })
})

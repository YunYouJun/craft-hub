import type { CommandCapability, ProjectRecord } from '../src/types'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { executeCommand } from '../src/executor'
import { CraftHubStore } from '../src/store'

async function fixture(): Promise<{ project: ProjectRecord, root: string, store: CraftHubStore }> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-executor-'))
  return {
    root,
    project: { id: 'project', name: 'Project', path: root, trust: 'trusted', addedAt: new Date().toISOString() },
    store: new CraftHubStore(join(root, '.data')),
  }
}

function sequence(root: string, log: string, prerequisiteArgs: string[]): CommandCapability {
  return {
    id: 'build-and-deploy',
    kind: 'command',
    name: 'Build and deploy',
    source: 'plugin:test',
    invocation: {
      command: process.execPath,
      args: ['-e', `require('node:fs').appendFileSync(${JSON.stringify(log)}, 'deploy\\n')`],
      cwd: root,
      requiredEnv: [],
      prerequisites: [{
        label: 'Compile',
        command: process.execPath,
        args: prerequisiteArgs,
        cwd: root,
        requiredEnv: [],
      }],
    },
  }
}

describe('structured command sequences', () => {
  it('runs the main command only after every prerequisite succeeds', async () => {
    const { project, root, store } = await fixture()
    const log = join(root, 'steps.log')
    const capability = sequence(root, log, ['-e', `require('node:fs').appendFileSync(${JSON.stringify(log)}, 'compile\\n')`])

    const handle = await executeCommand(store, project, capability)
    const run = await handle.completion

    expect(run.status).toBe('completed')
    expect(await readFile(log, 'utf8')).toBe('compile\ndeploy\n')
    expect(run.stdout).toContain('[Craft Hub 1/2] Compile')
    expect(run.stdout).toContain(`[Craft Hub 2/2] ${process.execPath}`)
  })

  it.runIf(process.platform !== 'win32')('preserves the resized terminal dimensions across command steps', async () => {
    const { project, root, store } = await fixture()
    const capability: CommandCapability = {
      id: 'responsive-sequence',
      kind: 'command',
      name: 'Responsive sequence',
      source: 'plugin:test',
      invocation: {
        command: process.execPath,
        args: ['-e', 'console.log(process.stdout.columns + "x" + process.stdout.rows)'],
        cwd: root,
        requiredEnv: [],
        prerequisites: [{
          label: 'Wait for terminal resize',
          command: process.execPath,
          args: ['-e', 'process.stdin.once("data", () => process.exit(0))'],
          cwd: root,
          requiredEnv: [],
        }],
      },
    }

    const handle = await executeCommand(store, project, capability)
    handle.resize(64, 18)
    handle.write('\r')
    const run = await handle.completion

    expect(run.status).toBe('completed')
    expect(run.stdout).toContain('64x18')
  })

  it('stops before the main command when a prerequisite fails', async () => {
    const { project, root, store } = await fixture()
    const log = join(root, 'steps.log')
    const handle = await executeCommand(store, project, sequence(root, log, ['-e', 'process.exit(7)']))

    const run = await handle.completion

    expect(run.status).toBe('failed')
    expect(run.exitCode).toBe(7)
    await expect(readFile(log, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not start the main command after a sequence is cancelled', async () => {
    const { project, root, store } = await fixture()
    const log = join(root, 'steps.log')
    const handle = await executeCommand(store, project, sequence(root, log, ['-e', 'setTimeout(() => {}, 10_000)']))

    handle.cancel()
    const run = await handle.completion

    expect(run.status).toBe('cancelled')
    await expect(readFile(log, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

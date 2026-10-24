import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { CraftHubRuntime } from 'craft-hub'
import { expect, it, vi } from 'vitest'
import { createNativeNavigationService } from '../src/native-navigation.ts'

it('resolves all registered checkouts without choosing, adding, trusting or executing a project', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-native-navigation-')))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  try {
    const paths = ['one', 'two', 'unregistered'].map(name => join(root, name))
    for (const path of paths) {
      await mkdir(path)
      await promisify(execFile)('git', ['init', path])
      await promisify(execFile)('git', ['-C', path, 'remote', 'add', 'origin', 'https://example.com/team/project.git'])
      await writeFile(join(path, 'package.json'), JSON.stringify({ scripts: { hello: 'node --version' } }))
    }
    const projects = [await runtime.addProject(paths[0]!), await runtime.addProject(paths[1]!)]
    const run = vi.spyOn(runtime, 'run')
    const add = vi.spyOn(runtime, 'addProject')
    const service = createNativeNavigationService(() => runtime)
    const result = await service.resolve('craft-hub-native://project?v=1&repo=https%3A%2F%2Fexample.com%2Fteam%2Fproject.git&capability=command%3Ahello')
    expect(result).toMatchObject({ kind: 'navigation', navigation: { kind: 'project', capabilityId: 'command:hello', matches: expect.arrayContaining(projects) } })
    expect(result.kind === 'navigation' && result.navigation.kind === 'project' && 'matches' in result.navigation && result.navigation.matches).toHaveLength(2)
    expect(await service.verify({ repository: 'https://example.com/team/project' }, paths[2])).toBe(true)
    await expect(service.verify({ repository: 'https://example.com/other' }, paths[2])).rejects.toThrow('does not match')
    expect(run).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
    for (const project of projects) {
      expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
      const command = (await runtime.capabilities(project.id)).find(value => value.kind === 'command')!
      await expect(runtime.run(project.id, command.id)).rejects.toThrow('untrusted')
    }
    await expect(service.resolve('craft-hub-native://project?v=1&repo=https%3A%2F%2Fexample.com%2Fmissing')).resolves.toMatchObject({ navigation: { matches: [] } })
  }
  finally {
    await runtime.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects malformed and executable links before reading any runtime state', async () => {
  const getRuntime = vi.fn(() => {
    throw new Error('must not read runtime')
  })
  const service = createNativeNavigationService(getRuntime)
  for (const input of [null, {}, 'craft-hub-native://run?v=1&command=test', 'craft-hub-native://open?v=1&trust=true', 'craft-hub-native://user:secret@open?v=1', 'craft-hub-native://cloud/connect?code=once&challenge=expected'])
    await expect(service.resolve(input)).rejects.toThrow()
  await expect(service.resolve('craft-hub-native://open?v=1&view=settings')).resolves.toEqual({ kind: 'navigation', navigation: { kind: 'settings' } })
  expect(getRuntime).not.toHaveBeenCalled()
})

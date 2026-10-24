import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, expect, it, vi } from 'vitest'
import { desktopWorkstation, readBundledWorkstation } from '../src/workstation-runtime'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('uses the supplied Node for nested backend workers without inherited preload hooks or Electron Node mode', async () => {
  const { directory, home, root } = await fixture()
  const observation = join(root, 'worker.json')
  await writeFile(join(directory, 'dist/cli.js'), `import fs from 'node:fs'; import { spawnSync } from 'node:child_process';
    process.stdin.resume(); process.stdin.on('end', () => {
      const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({executable:process.execPath,node:process.versions.node,mode:process.env.ELECTRON_RUN_AS_NODE,options:process.env.NODE_OPTIONS,path:process.env.NODE_PATH}))'], {env:process.env,encoding:'utf8',shell:false});
      if (child.status !== 0) process.exit(1);
      fs.writeFileSync(${JSON.stringify(observation)}, child.stdout);
      process.stdout.write(JSON.stringify({ok:true,result:{version:1,items:[]}}));
    });`)
  vi.stubEnv('NODE_OPTIONS', '--import=file:///nonexistent-preload.mjs')
  vi.stubEnv('NODE_PATH', '/nonexistent-modules')
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
  const result = desktopWorkstation({ directory, executable: process.execPath, homeDirectory: home, env: { PATH: '/nonexistent' } })
  expect((await result.plugin.softwareCatalogProviders![0].read()).items).toEqual([])
  expect(JSON.parse(await readFile(observation, 'utf8'))).toEqual({ executable: process.execPath, node: process.versions.node })
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-bundled-workstation-'))
  roots.push(root)
  const directory = join(root, 'app/workstation-runtime')
  const home = join(root, 'New Mac\'s home')
  await mkdir(join(directory, 'dist'), { recursive: true })
  await writeFile(join(directory, 'runtime.json'), JSON.stringify({ schemaVersion: 1, version: '0.1.0', revision: 'a'.repeat(40) }))
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@yunyoujun/workstation', version: '0.1.0', type: 'module' }))
  await writeFile(join(directory, 'dist/cli.js'), 'process.stdin.resume();process.stdin.on("end",()=>process.stdout.write(JSON.stringify({ok:true,result:{version:1,items:[],source:process.env.DOTFILES_REPO_ROOT,mode:process.env.ELECTRON_RUN_AS_NODE}})))')
  return { root, directory, home }
}

it('starts the fixed prebuilt backend without terminal Node, npm, a source checkout or project trust', async () => {
  const { directory, home } = await fixture()
  const result = desktopWorkstation({ directory, executable: process.execPath, homeDirectory: home, env: { PATH: '/nonexistent' } })
  expect(result.bundled?.version).toBe('0.1.0')
  // The real child transport uses a fixed executable and fixed CLI arguments, never a shell command from a profile.
  const catalog = await result.plugin.softwareCatalogProviders![0].read()
  expect(catalog.items).toEqual([])
  await expect(readFile(join(home, '.config/workstation/private.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(readFile(join(directory, 'home/dot_zshrc'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('keeps explicit host commands authoritative and validates bundled identity before execution', async () => {
  const { directory, home } = await fixture()
  expect(desktopWorkstation({ directory, homeDirectory: home, env: { CRAFT_HUB_WORKSTATION_COMMAND: '/explicit/custom-cli' } }).bundled).toBeUndefined()
  expect(readBundledWorkstation('/missing/runtime')).toBeUndefined()
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: '@example/other', version: '0.1.0' }))
  expect(() => readBundledWorkstation(directory)).toThrow('Invalid bundled Workstation')
})

it('retains the explicitly selected legacy Electron backend mode for other desktop platforms', async () => {
  const { directory, home, root } = await fixture()
  const observation = join(root, 'mode')
  await writeFile(join(directory, 'dist/cli.js'), `import fs from 'node:fs';process.stdin.resume();process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(observation)},process.env.ELECTRON_RUN_AS_NODE ?? 'absent');process.stdout.write(JSON.stringify({ok:true,result:{version:1,items:[]}}))})`)
  const result = desktopWorkstation({ directory, executable: process.execPath, electronNodeMode: true, homeDirectory: home, env: { PATH: '/nonexistent' } })
  await result.plugin.softwareCatalogProviders![0].read()
  expect(await readFile(observation, 'utf8')).toBe('1')
})

it('removes native backup keys from general children and supplies them only to configuration transport', async () => {
  const { takeConfigurationBackupKeys } = await import('../src/workstation-runtime')
  const env: NodeJS.ProcessEnv = { PATH: '/nonexistent', CRAFT_HUB_BACKUP_KEY_FIXTURE: 'disposable-test-value', CRAFT_HUB_BACKUP_KEY_bad: 'rejected', CRAFT_HUB_BACKUP_KEY_LARGE: 'x'.repeat(16385) }
  const keys = takeConfigurationBackupKeys(env)
  expect(keys).toEqual({ CRAFT_HUB_BACKUP_KEY_FIXTURE: 'disposable-test-value' })
  expect(env).toEqual({ PATH: '/nonexistent' })
  const { directory, home, root } = await fixture()
  const observations = join(root, 'calls.jsonl')
  await writeFile(join(directory, 'dist/cli.js'), `import fs from 'node:fs'; process.stdin.resume(); process.stdin.on('end', () => {
    fs.appendFileSync(${JSON.stringify(observations)}, JSON.stringify({ operation: process.argv[2], received: process.env.CRAFT_HUB_BACKUP_KEY_FIXTURE === 'disposable-test-value' }) + '\\n');
    process.stdout.write(JSON.stringify({ok:true,result:{version:1,items:[],plans:[],repositories:[]}}));
  });`)
  const result = desktopWorkstation({ directory, executable: process.execPath, homeDirectory: home, env, configurationEnvironment: keys })
  await result.plugin.integrationProviders![0].configurationManagement!.read({}, {})
  await result.plugin.softwareCatalogProviders![0].read()
  const calls = (await readFile(observations, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { operation: string, received: boolean })
  expect(calls.filter(call => call.operation === 'configuration').length).toBeGreaterThan(0)
  expect(calls.every(call => call.received === (call.operation === 'configuration'))).toBe(true)
})

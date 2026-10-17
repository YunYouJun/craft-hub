import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, expect, it } from 'vitest'
import { desktopWorkstation, readBundledWorkstation } from '../src/workstation-runtime'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
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

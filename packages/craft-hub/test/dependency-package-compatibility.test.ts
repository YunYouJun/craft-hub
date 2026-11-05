import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { extract, tarball } from 'pacote'
import { expect, it } from 'vitest'

it('packs and extracts local package file patterns with the patched glob and minimatch dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-package-compatibility-'))
  const source = join(root, 'source')
  const destination = join(root, 'extracted')
  try {
    await mkdir(join(source, 'dist/nested'), { recursive: true })
    await mkdir(join(source, 'assets'), { recursive: true })
    await mkdir(join(source, 'src'), { recursive: true })
    const manifest = {
      name: 'offline-package-fixture',
      version: '1.0.0',
      files: ['dist/**', '!dist/**/*.map', 'assets/{light,dark}.svg'],
      scripts: { prepare: 'node -e "process.exit(99)"' },
    }
    await writeFile(join(source, 'package.json'), JSON.stringify(manifest))
    await writeFile(join(source, 'dist/nested/index.mjs'), 'export const fixture = true\n')
    await writeFile(join(source, 'dist/nested/index.mjs.map'), '{}')
    await writeFile(join(source, 'assets/light.svg'), '<svg/>')
    await writeFile(join(source, 'assets/dark.svg'), '<svg/>')
    await writeFile(join(source, 'assets/unlisted.svg'), '<svg/>')
    await writeFile(join(source, 'src/unlisted.ts'), 'export const source = true\n')

    const archive = join(root, 'fixture.tgz')
    // Pacote accepts a preloaded tree for this dependency-free package without Arborist or network access.
    const packOptions = { ignoreScripts: true, tree: { path: source, package: manifest, isProjectRoot: true } }
    await writeFile(archive, await tarball(source, packOptions))
    await extract(archive, destination, { ignoreScripts: true })

    expect((await readdir(destination, { recursive: true })).map(path => path.split(sep).join('/')).sort()).toEqual([
      'assets',
      'assets/dark.svg',
      'assets/light.svg',
      'dist',
      'dist/nested',
      'dist/nested/index.mjs',
      'package.json',
    ])
    expect(await readFile(join(destination, 'dist/nested/index.mjs'), 'utf8')).toBe('export const fixture = true\n')
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

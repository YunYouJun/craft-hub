import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { DotfilesManager } from '../src/dotfiles-manager'

const execFileAsync = promisify(execFile)

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-dotfiles-'))
  const repositoryPath = join(root, 'dotfiles')
  const dataDir = join(root, 'data')
  await execFileAsync('git', ['init', repositoryPath])
  await mkdir(join(repositoryPath, '.craft-hub'), { recursive: true })
  const manager = new DotfilesManager(dataDir)
  return { dataDir, manager, repositoryPath, root }
}

async function writeManifest(repositoryPath: string, output = 'clean'): Promise<void> {
  await writeFile(join(repositoryPath, '.craft-hub', 'dotfiles.jsonc'), `${JSON.stringify({
    $schema: 'https://example.com/dotfiles.schema.json',
    version: 1,
    name: 'Workstation',
    adapter: 'command',
    platforms: [process.platform],
    operations: {
      check: { command: process.execPath, args: ['-e', `process.stdout.write(${JSON.stringify(output)})`] },
      status: { command: process.execPath, args: ['-e', 'process.stderr.write("status")'] },
      diff: { command: process.execPath, args: ['-e', 'process.exit(2)'] },
    },
  }, null, 2)}\n`)
}

describe('dotfiles manager', () => {
  it('automatically detects a manifest after the shared repository is selected', async () => {
    const paths = await fixture()
    const canonicalRepositoryPath = await realpath(paths.repositoryPath)

    await expect(paths.manager.configure(paths.repositoryPath)).resolves.toMatchObject({
      repositoryPath: canonicalRepositoryPath,
      state: 'manifest-missing',
    })
    await writeManifest(paths.repositoryPath)

    await expect(paths.manager.status()).resolves.toMatchObject({ state: 'untrusted', manifest: { name: 'Workstation' } })
  })

  it('requires trust for the exact manifest before running shell-free read-only operations', async () => {
    const paths = await fixture()
    await writeManifest(paths.repositoryPath)

    await expect(paths.manager.configure(paths.repositoryPath)).resolves.toMatchObject({ state: 'untrusted', manifest: { name: 'Workstation' } })
    await expect(paths.manager.run('check')).rejects.toThrow('Trust the current')
    await expect(paths.manager.trust()).resolves.toMatchObject({ state: 'ready' })
    await expect(paths.manager.run('check')).resolves.toMatchObject({ succeeded: true, stdout: 'clean', stderr: '', exitCode: 0 })
    await expect(paths.manager.run('diff')).resolves.toMatchObject({ succeeded: false, exitCode: 2 })
  })

  it('invalidates trust when the manifest changes', async () => {
    const paths = await fixture()
    await writeManifest(paths.repositoryPath)
    await paths.manager.configure(paths.repositoryPath)
    await paths.manager.trust()

    await writeManifest(paths.repositoryPath, 'changed')

    await expect(paths.manager.status()).resolves.toMatchObject({ state: 'untrusted' })
  })

  it('rejects manifests that resolve outside the repository', async () => {
    const paths = await fixture()
    const outside = join(paths.root, 'outside.jsonc')
    await writeFile(outside, '{}')
    const manifestPath = join(paths.repositoryPath, '.craft-hub', 'dotfiles.jsonc')
    await symlink(outside, manifestPath)

    await expect(paths.manager.configure(paths.repositoryPath)).rejects.toThrow('inside the selected repository')
  })

  it('stores the selected repository once and keeps only trust identity in dotfiles state', async () => {
    const paths = await fixture()
    await writeManifest(paths.repositoryPath)
    await paths.manager.configure(paths.repositoryPath)
    await paths.manager.trust()

    const connection = await readFile(join(paths.dataDir, 'personal-config-repository.json'), 'utf8')
    const state = await readFile(join(paths.dataDir, 'dotfiles-manager.json'), 'utf8')
    const canonicalRepositoryPath = await realpath(paths.repositoryPath)
    expect(JSON.parse(connection).repositoryPath).toBe(canonicalRepositoryPath)
    expect(JSON.parse(state).trustedRepositoryPath).toBe(canonicalRepositoryPath)
    expect(JSON.stringify(JSON.parse(state))).not.toContain(JSON.stringify(process.execPath).slice(1, -1))
  })
})

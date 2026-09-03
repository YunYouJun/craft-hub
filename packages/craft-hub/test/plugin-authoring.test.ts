import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { catalogPluginV1Schema, CraftHubRuntime, initializeMarketplacePlugin, packMarketplacePlugin, validateMarketplacePlugin } from '../src/index'

const execFileAsync = promisify(execFile)
const examplePluginPath = fileURLToPath(new URL('../../../examples/marketplace-plugin', import.meta.url))
const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

describe('marketplace Plugin authoring', () => {
  it('initializes a composable package and validates its packed files', async () => {
    const root = await temporaryPath('craft-hub-plugin-init-')
    const pluginPath = join(root, 'plugin')

    const initialized = await initializeMarketplacePlugin(pluginPath, {
      packageName: '@example/craft-hub-plugin-tools',
      displayName: 'Example tools',
      description: 'Example declarative tools.',
      license: 'MIT',
      withCommand: true,
      withSkill: true,
      withProjectTemplate: true,
    })
    const validation = await validateMarketplacePlugin(pluginPath)

    expect(initialized.files).toEqual([
      'README.md',
      'package.json',
      'skills/tools/SKILL.md',
      'templates/tools-starter/README.md',
    ])
    expect(validation).toMatchObject({
      packageName: '@example/craft-hub-plugin-tools',
      version: '0.1.0',
      license: 'MIT',
      packedFiles: initialized.files,
      manifest: {
        permissions: ['commands'],
        contributes: {
          commands: [expect.objectContaining({ id: 'version-check', command: 'node', args: ['--version'] })],
          skills: [{ path: 'skills/tools/SKILL.md' }],
          projectTemplates: [{ id: 'tools-starter', path: 'templates/tools-starter' }],
        },
      },
    })
  })

  it('refuses to overwrite a non-empty initialization target', async () => {
    const pluginPath = await temporaryPath('craft-hub-plugin-existing-')
    await writeFile(join(pluginPath, 'keep.txt'), 'owned by the user')

    await expect(initializeMarketplacePlugin(pluginPath, {
      packageName: '@example/craft-hub-plugin-tools',
      displayName: 'Example tools',
      license: 'MIT',
    })).rejects.toThrow(/must be empty/)
    await expect(readFile(join(pluginPath, 'keep.txt'), 'utf8')).resolves.toBe('owned by the user')
  })

  it('rejects contributed files omitted from the npm package', async () => {
    const root = await temporaryPath('craft-hub-plugin-packlist-')
    const pluginPath = join(root, 'plugin')
    await initializeMarketplacePlugin(pluginPath, {
      packageName: '@example/craft-hub-plugin-tools',
      displayName: 'Example tools',
      license: 'MIT',
      withSkill: true,
    })
    const packagePath = join(pluginPath, 'package.json')
    const packageDocument = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>
    packageDocument.files = ['README.md']
    await writeFile(packagePath, `${JSON.stringify(packageDocument, null, 2)}\n`)

    await expect(validateMarketplacePlugin(pluginPath)).rejects.toThrow(/Skill is missing from the npm package/)
  })

  it('packs immutable artifacts, creates a valid Catalog Entry, and refuses overwrites', async () => {
    const root = await temporaryPath('craft-hub-plugin-artifacts-')
    const pluginPath = join(root, 'plugin')
    await initializeMarketplacePlugin(pluginPath, {
      packageName: '@example/craft-hub-plugin-tools',
      displayName: 'Example tools',
      description: 'Example declarative tools.',
      license: 'MIT',
      withCommand: true,
    })

    const packed = await packMarketplacePlugin(pluginPath, 'example-publisher')
    const catalogEntry = catalogPluginV1Schema.parse(JSON.parse(await readFile(packed.catalogEntryPath, 'utf8')))

    const tarball = await readFile(packed.tarballPath)
    expect(tarball).not.toHaveLength(0)
    expect(packed.integrity).toBe(`sha512-${createHash('sha512').update(tarball).digest('base64')}`)
    expect(catalogEntry).toMatchObject({
      package: '@example/craft-hub-plugin-tools',
      version: '0.1.0',
      publisher: 'example-publisher',
      integrity: packed.integrity,
      permissions: ['commands'],
      status: 'active',
    })
    await expect(packMarketplacePlugin(pluginPath, 'example-publisher')).rejects.toThrow(/Refusing to overwrite/)
  })

  it('keeps the executable example valid and discoverable through a local link', async () => {
    const root = await temporaryPath('craft-hub-plugin-link-')
    const projectPath = join(root, 'project')
    await mkdir(projectPath)
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data') })
    const project = await runtime.addProject(projectPath)

    await expect(validateMarketplacePlugin(examplePluginPath)).resolves.toMatchObject({
      packageName: '@example/craft-hub-plugin-starter',
    })
    await runtime.pluginManager.linkLocal(examplePluginPath)
    const capabilities = await runtime.capabilities(project.id)

    expect(capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'command', name: 'Check Node.js version' }),
      expect.objectContaining({ kind: 'skill', name: 'starter-tools' }),
    ]))
    await runtime.pluginManager.unlinkLocal('@example/craft-hub-plugin-starter')
    expect((await runtime.capabilities(project.id)).some(capability => capability.source.startsWith('plugin:'))).toBe(false)
  })

  it('exposes deterministic non-interactive initialization through the CLI', async () => {
    const root = await temporaryPath('craft-hub-plugin-cli-')
    const pluginPath = join(root, 'plugin')
    const { stdout } = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      cliPath,
      'plugin:init',
      pluginPath,
      '--non-interactive',
      '--package',
      '@example/craft-hub-plugin-cli',
      '--display-name',
      'CLI tools',
      '--license',
      'MIT',
      '--with-skill',
    ], { encoding: 'utf8' })

    expect(JSON.parse(stdout)).toMatchObject({
      rootPath: pluginPath,
      packageName: '@example/craft-hub-plugin-cli',
    })
    await expect(validateMarketplacePlugin(pluginPath)).resolves.toMatchObject({
      packageName: '@example/craft-hub-plugin-cli',
    })
  })
})

async function temporaryPath(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

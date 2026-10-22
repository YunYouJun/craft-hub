import { cp, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'tsdown'

const repositoryDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..')

/**
 * Packages that stay files beside the bundles: native addons, and jsonc-parser, whose UMD wrapper passes `require`
 * through a factory that bundlers cannot follow.
 */
export const sidecarExternals = ['node-pty', 'keytar', 'jsonc-parser']

/**
 * Bundle the native host's runtime sidecar and the runtime CLI into self-contained ESM files in `outDir`. The CLI sits
 * next to the sidecar because agent connections tell agents to run `cli.mjs` from the runtime's own directory.
 */
export async function bundleSidecar(outDir: string): Promise<void> {
  await build({
    config: false,
    cwd: repositoryDir,
    entry: { sidecar: 'apps/desktop/src/sidecar.ts', cli: 'packages/craft-hub/dist/cli.mjs' },
    outDir,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    minify: true,
    // Bundled CommonJS dependencies still read __dirname, __filename and require.
    shims: true,
    dts: false,
    sourcemap: false,
    clean: true,
    logLevel: 'warn',
    deps: { alwaysBundle: [/./], neverBundle: sidecarExternals },
  })
}

/**
 * Bundle the Microsoft To Do connector into `packageDir`, which replaces its installed package. The plugin resolves the
 * connector by package name and spawns its main entry, and the connector reads `dist/endpoints.json` and
 * `package.json` next to itself, so those keep their paths. keytar stays external for its native addon.
 */
export async function bundleMicrosoftTodoConnector(sourcePackageDir: string, packageDir: string): Promise<void> {
  await build({
    config: false,
    cwd: repositoryDir,
    entry: { index: resolve(sourcePackageDir, 'dist/index.js') },
    outDir: resolve(packageDir, 'dist'),
    format: 'esm',
    platform: 'node',
    target: 'node22',
    minify: true,
    shims: true,
    dts: false,
    sourcemap: false,
    clean: true,
    logLevel: 'warn',
    deps: { alwaysBundle: [/./], neverBundle: ['keytar'] },
  })
  await cp(resolve(sourcePackageDir, 'dist/endpoints.json'), resolve(packageDir, 'dist/endpoints.json'))
  const manifest = JSON.parse(await readFile(resolve(sourcePackageDir, 'package.json'), 'utf8')) as Record<string, unknown>
  // Dependencies are inside the bundle now; keytar is optional and resolved beside the host's own packages.
  await writeFile(resolve(packageDir, 'package.json'), `${JSON.stringify({ name: manifest.name, version: manifest.version, type: 'module', main: 'dist/index.mjs', license: manifest.license }, null, 2)}\n`)
  for (const notice of ['LICENSE', 'README.md']) {
    await cp(resolve(sourcePackageDir, notice), resolve(packageDir, notice)).catch(() => {})
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [outDir, connectorSource, connectorTarget] = process.argv.slice(2)
  if (!outDir)
    throw new Error('Usage: tsx apps/macos/scripts/bundle-sidecar.ts <out-dir> [<connector-source> <connector-target>]')
  await bundleSidecar(resolve(outDir))
  if (connectorSource && connectorTarget)
    await bundleMicrosoftTodoConnector(resolve(connectorSource), resolve(connectorTarget))
}

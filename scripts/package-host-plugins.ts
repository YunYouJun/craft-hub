import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Deploy distribution-owned host packages, including their runtime dependencies. */
export async function packageHostPlugins(
  manifestPath: string,
  targetDirectory: string,
  specifiers: readonly string[],
  deploy: (packageDirectory: string, target: string, packageName: string) => Promise<void> = deployHostPackage,
): Promise<void> {
  const root = dirname(resolve(manifestPath))
  const deployed = new Set<string>()
  for (const specifier of specifiers) {
    if (!specifier.startsWith('./')) {
      // Package specifiers must already be dependencies of the deployed desktop.
      continue
    }
    const source = resolve(root, specifier)
    const sourceRelative = relative(root, source)
    if (sourceRelative.startsWith('../') || sourceRelative === '..')
      throw new Error(`Host plugin must stay inside the distribution directory: ${specifier}`)
    await access(source)
    let packageDirectory = dirname(source)
    while (packageDirectory !== root) {
      try {
        await access(join(packageDirectory, 'package.json'))
        break
      }
      catch {
        packageDirectory = dirname(packageDirectory)
      }
    }
    if (packageDirectory === root)
      throw new Error(`Host plugin requires its own deployable package: ${specifier}`)
    if (!deployed.has(packageDirectory)) {
      const metadata = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8')) as { name: string }
      await deploy(packageDirectory, join(targetDirectory, relative(root, packageDirectory)), metadata.name)
      deployed.add(packageDirectory)
    }
    await access(resolve(targetDirectory, specifier))
  }
}

async function deployHostPackage(packageDirectory: string, target: string, packageName: string): Promise<void> {
  await execFileAsync('pnpm', [
    '--config.node-linker=hoisted',
    '--filter',
    packageName,
    '--prod',
    'deploy',
    '--legacy',
    target,
  ], { cwd: packageDirectory, maxBuffer: 10 * 1024 * 1024 })
}

import { execFile } from 'node:child_process'
import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const lockPath = fileURLToPath(new URL('./workstation-runtime.lock.json', import.meta.url))

/** Build the pinned public backend on the release machine; no checkout or build runs on the user's Mac. */
export async function packageWorkstationRuntime(target: string): Promise<void> {
  const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { repository: string, revision: string, packageManager: string, package: string, version: string }
  if (lock.repository !== 'https://github.com/YunYouJun/workstation.git' || !/^[a-f0-9]{40}$/.test(lock.revision)
    || !/^pnpm@\d+\.\d+\.\d+$/.test(lock.packageManager) || lock.package !== '@yunyoujun/workstation' || !/^\d+\.\d+\.\d+$/.test(lock.version)) {
    throw new Error('Invalid pinned Workstation release input')
  }
  try {
    await access(target)
    throw new Error('Workstation runtime target already exists')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error
  }
  const temporary = await mkdtemp(join(tmpdir(), 'craft-hub-workstation-release-'))
  const source = join(temporary, 'source')
  const payload = join(temporary, 'payload')
  const run = async (command: string, args: string[], cwd: string): Promise<string> => {
    const result = await execute(command, args, { cwd, shell: false, timeout: 180000, maxBuffer: 12 * 1024 * 1024 })
    return result.stdout.trim()
  }
  try {
    await run('git', ['init', '--quiet', source], temporary)
    await run('git', ['fetch', '--quiet', '--depth=1', lock.repository, lock.revision], source)
    await run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], source)
    if (await run('git', ['rev-parse', 'HEAD'], source) !== lock.revision)
      throw new Error('Workstation source revision did not match the release lock')
    const metadata = JSON.parse(await readFile(join(source, 'packages/cli/package.json'), 'utf8')) as { name: string, version: string }
    const workspace = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as { packageManager: string }
    if (metadata.name !== lock.package || metadata.version !== lock.version || workspace.packageManager !== lock.packageManager)
      throw new Error('Workstation package identity did not match the release lock')
    const pnpm = (args: string[]) => run('npm', ['exec', '--yes', `--package=${lock.packageManager}`, '--', 'pnpm', '--dir', source, ...args], source)
    await pnpm(['--filter', `${lock.package}...`, 'install', '--frozen-lockfile'])
    await pnpm(['--filter', lock.package, 'run', 'build'])
    await pnpm(['--config.node-linker=hoisted', '--filter', lock.package, '--prod', 'deploy', '--legacy', payload])
    await access(join(payload, 'dist/cli.js'))
    await writeFile(join(payload, 'runtime.json'), `${JSON.stringify({ schemaVersion: 1, version: lock.version, revision: lock.revision }, null, 2)}\n`)
    // Production deployment includes dependency manifests and license notices, never the source repository or private state.
    await cp(payload, target, { recursive: true, dereference: true, errorOnExist: true, force: false })
  }
  catch (error) {
    await rm(target, { recursive: true, force: true })
    throw error
  }
  finally { await rm(temporary, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [target, ...extra] = process.argv.slice(2)
  if (!target || extra.length)
    throw new Error('Usage: tsx scripts/package-workstation-runtime.ts <new-target-directory>')
  await packageWorkstationRuntime(resolve(target))
}

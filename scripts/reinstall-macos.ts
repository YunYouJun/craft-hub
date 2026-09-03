import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { packageMacos } from './package-macos.ts'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const installDirectory = resolve(process.env.CRAFT_HUB_DESKTOP_INSTALL_DIR ?? '/Applications')

async function run(command: string, args: string[], environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = execFile(command, args, {
      cwd: repositoryRoot,
      env: environment,
    })
    child.stdout?.pipe(process.stdout)
    child.stderr?.pipe(process.stderr)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0)
        resolvePromise()
      else
        reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}`))
    })
  })
}

async function processIsRunning(name: string): Promise<boolean> {
  try {
    await execFileAsync('pgrep', ['-x', name])
    return true
  }
  catch (error) {
    if ((error as { code?: number }).code === 1)
      return false
    throw error
  }
}

async function stopInstalledApplication(productName: string): Promise<void> {
  if (!await processIsRunning(productName))
    return

  console.log(`Stopping ${productName} before installation...`)
  try {
    await execFileAsync('pkill', ['-TERM', '-x', productName])
  }
  catch (error) {
    if ((error as { code?: number }).code !== 1)
      throw error
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!await processIsRunning(productName))
      return
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100))
  }
  throw new Error(`${productName} did not quit. Close it manually, then run the command again.`)
}

async function installApplication(source: string, target: string, productName: string): Promise<void> {
  await mkdir(installDirectory, { recursive: true })
  const transactionDirectory = await mkdtemp(join(installDirectory, `.${productName.replaceAll(' ', '-')}-install-`))
  const stagedApplication = join(transactionDirectory, `${productName}.app`)
  const previousApplication = join(transactionDirectory, 'previous.app')
  let previousMoved = false
  let preserveTransaction = false

  try {
    await execFileAsync('ditto', [source, stagedApplication])
    try {
      await rename(target, previousApplication)
      previousMoved = true
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }

    try {
      await rename(stagedApplication, target)
    }
    catch (error) {
      if (previousMoved) {
        try {
          await rename(previousApplication, target)
        }
        catch (restoreError) {
          preserveTransaction = true
          throw new AggregateError(
            [error, restoreError],
            `Installation and rollback failed; the previous app is preserved at ${previousApplication}`,
          )
        }
      }
      throw error
    }
  }
  finally {
    if (!preserveTransaction)
      await rm(transactionDirectory, { force: true, recursive: true })
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin')
    throw new Error('The macOS desktop app can only be reinstalled on macOS')
  if (process.arch !== 'arm64' && process.arch !== 'x64')
    throw new Error(`Unsupported macOS architecture: ${process.arch}`)

  await run('pnpm', ['build'])
  const architecture = process.arch
  const packageResult = await packageMacos({
    architectures: [architecture],
    createArtifacts: false,
  })

  const packagedApplication = packageResult.applications[0]?.applicationPath
  if (!packagedApplication)
    throw new Error(`Packager did not return an app for ${architecture}`)
  const installedApplication = join(installDirectory, `${packageResult.productName}.app`)
  await access(packagedApplication)
  await stopInstalledApplication(packageResult.productName)
  await installApplication(packagedApplication, installedApplication, packageResult.productName)
  await execFileAsync('open', [installedApplication])
  console.log(`Installed and opened ${installedApplication}`)
}

await main()

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export const nativeProductName = 'Craft Hub Prototype.app'

export interface NativeApplicationProcess {
  pid: number
  executable: string
  startedAt: number
}

export interface NativeInstallOperations {
  copy: (source: string, destination: string) => Promise<void>
  verify: (bundle: string) => Promise<void>
  stop: (bundle: string) => Promise<boolean>
  launch: (bundle: string) => Promise<NativeApplicationProcess>
}

/** Bind installation verification to the signed native executable and its bundled runtime/UI. */
export async function nativeBundleFingerprint(bundle: string): Promise<string> {
  const hash = createHash('sha256')
  for (const file of ['Contents/MacOS/CraftHubMac', 'Contents/_CodeSignature/CodeResources', 'Contents/Resources/app/apps/desktop/dist/sidecar.mjs', 'Contents/Resources/app/apps/web/dist/index.html']) {
    hash.update(file)
    hash.update(await readFile(join(bundle, file)))
  }
  return hash.digest('hex')
}

/** Stage and verify before quitting; retain the previous bundle and restore it if replacement/startup fails. */
export async function installNativeApplication(source: string, target: string, operations: NativeInstallOperations): Promise<{ backupDirectory: string, process: NativeApplicationProcess }> {
  source = resolve(source)
  target = resolve(target)
  if (source === target || source.startsWith(`${target}/`) || target.startsWith(`${source}/`))
    throw new Error('Native build output and installation must be separate directories')
  await mkdir(dirname(target), { recursive: true })
  const transaction = await mkdtemp(join(dirname(target), '.craft-hub-native-install-'))
  const staged = join(transaction, nativeProductName)
  const previous = join(transaction, 'previous.app')
  let previousMoved = false
  let replacementInstalled = false
  let wasRunning = false
  let preserve = false
  try {
    await operations.verify(source)
    const expected = await nativeBundleFingerprint(source)
    await operations.copy(source, staged)
    await operations.verify(staged)
    if (await nativeBundleFingerprint(staged) !== expected)
      throw new Error('Staged native app differs from the new build')
    wasRunning = await operations.stop(target)
    try {
      await rename(target, previous)
      previousMoved = true
      preserve = true
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
    await rename(staged, target)
    replacementInstalled = true
    await operations.verify(target)
    if (await nativeBundleFingerprint(target) !== expected)
      throw new Error('Installed native app differs from the new build')
    const running = await operations.launch(target)
    await writeFile(join(transaction, 'installation.json'), JSON.stringify({ source, target, fingerprint: expected, installedAt: new Date().toISOString(), process: running }, null, 2), { mode: 0o600 })
    preserve = true
    return { backupDirectory: transaction, process: running }
  }
  catch (error) {
    try {
      if (replacementInstalled) {
        await operations.stop(target)
        await rename(target, join(transaction, 'failed.app'))
        preserve = true
      }
      if (previousMoved)
        await rename(previous, target)
      if (wasRunning)
        await operations.launch(target)
    }
    catch (recoveryError) {
      preserve = true
      throw new AggregateError([error, recoveryError], `Native installation recovery needs attention; bundles are preserved at ${transaction}`)
    }
    throw error
  }
  finally {
    if (!preserve)
      await rm(transaction, { recursive: true, force: true })
  }
}

import type { HostExtension, HostExtensionManager } from 'craft-hub'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, open } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseDesktopDistributionManifest } from './distribution.ts'

/** Read a bounded local declaration without evaluating code or changing the application's distribution. */
export async function readDesktopHostExtension(manager: HostExtensionManager, manifestPath: string): Promise<{ extension: HostExtension, revision: string }> {
  const file = await open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  let content: string
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > 1024 * 1024)
      throw new Error('Select a regular distribution JSON file smaller than 1 MiB')
    const bytes = Buffer.alloc(1024 * 1024 + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length)
      if (!bytesRead)
        break
      length += bytesRead
    }
    if (length > 1024 * 1024)
      throw new Error('The distribution JSON file is too large')
    content = bytes.toString('utf8', 0, length)
  }
  finally { await file.close() }
  const manifest = parseDesktopDistributionManifest(JSON.parse(content))
  if (!manifest.hostPlugins?.length)
    throw new Error('This distribution does not declare any host plugins')
  if (manifest.hostPlugins.length > 128)
    throw new Error('A host extension can declare at most 128 entry modules')
  const extension = manager.prepare({
    id: manifest.distribution.id,
    name: manifest.distribution.name,
    manifestPath,
    modules: manifest.hostPlugins,
  })
  await Promise.all(extension.modules.map(path => access(path)))
  return { extension, revision: createHash('sha256').update(content).digest('hex') }
}

/** Review a local distribution as an extension without changing application identity or loading code. */
export async function prepareDesktopHostExtension(manager: HostExtensionManager, manifestPath: string): Promise<HostExtension> {
  return (await readDesktopHostExtension(manager, manifestPath)).extension
}

/** Find the containing distribution for a linked local plugin; only reads declarations. */
export async function findLocalHostExtension(manager: HostExtensionManager, pluginPath: string): Promise<HostExtension | undefined> {
  let directory = resolve(pluginPath)
  while (dirname(directory) !== directory) {
    const manifestPath = join(directory, 'distribution.json')
    try {
      await access(manifestPath)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
      directory = dirname(directory)
      continue
    }
    return prepareDesktopHostExtension(manager, manifestPath)
  }
}

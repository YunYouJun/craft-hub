import type { ProfileLease } from 'craft-hub'
import { resolve } from 'node:path'
import { acquireProfileLease } from 'craft-hub'

/** Hold the native migration barrier and exclude a second sidecar, including one whose former parent just crashed. */
export async function acquireSidecarProfileLease(root: string): Promise<ProfileLease> {
  const parent = await acquireProfileLease([resolve(root)])
  try {
    const writer = await acquireProfileLease([resolve(root, 'runtime'), resolve(root, 'config')], 'migration')
    return {
      paths: [...parent.paths, ...writer.paths],
      release() {
        writer.release()
        parent.release()
      },
    }
  }
  catch (error) {
    parent.release()
    throw error
  }
}

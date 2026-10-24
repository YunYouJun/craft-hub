import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireProfileLease } from 'craft-hub'
import { expect, it } from 'vitest'
import { acquireSidecarProfileLease } from '../src/sidecar-profile'

it('holds the native root across parent loss and excludes overlapping sidecars before profile writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-sidecar-lease-'))
  try {
    const profile = join(root, 'profile')
    const native = await acquireProfileLease([profile])
    const sidecar = await acquireSidecarProfileLease(profile)
    try {
      expect(await readdir(root)).toEqual([])
      native.release()
      await expect(acquireProfileLease([profile], 'migration')).rejects.toThrow('profile is in use')
      await expect(acquireSidecarProfileLease(profile)).rejects.toThrow('profile is in use')
      await expect(acquireProfileLease([join(profile, 'runtime')])).rejects.toThrow('profile is in use')
    }
    finally { sidecar.release() }
    const replacement = await acquireSidecarProfileLease(profile)
    replacement.release()
    const migration = await acquireProfileLease([profile], 'migration')
    try {
      await expect(acquireSidecarProfileLease(profile)).rejects.toThrow('profile is in use')
      expect(await readdir(root)).toEqual([])
    }
    finally { migration.release() }
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

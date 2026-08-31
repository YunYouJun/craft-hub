import type { DistributionConfig } from 'craft-hub'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDesktopDataDirectories } from '../src/data-directories.ts'

const community: DistributionConfig = {
  id: 'community',
  name: 'Craft Hub',
  dataDirectoryName: 'Craft Hub',
}

describe('desktop data directories', () => {
  it('shares runtime state between development and packaged instances of one distribution', () => {
    const appDataDir = resolve('/application-data')
    const env = { CRAFT_HUB_DATA_DIR: '/shared/craft-hub' }
    const development = resolveDesktopDataDirectories({ appDataDir, development: true, distribution: community, env })
    const packaged = resolveDesktopDataDirectories({ appDataDir, development: false, distribution: community, env })

    expect(development.runtimeDataDir).toBe(packaged.runtimeDataDir)
    expect(development.developmentUserDataDir).toBe(join(appDataDir, 'Craft Hub Dev'))
    expect(packaged.developmentUserDataDir).toBeUndefined()
  })

  it('keeps distributions isolated by default', () => {
    const communityDirectories = resolveDesktopDataDirectories({ appDataDir: '/application-data', development: false, distribution: community, env: {} })
    const downstreamDirectories = resolveDesktopDataDirectories({
      appDataDir: '/application-data',
      development: false,
      distribution: { id: 'downstream', name: 'Downstream', dataDirectoryName: 'Downstream Hub' },
      env: {},
    })

    expect(communityDirectories.runtimeDataDir).not.toBe(downstreamDirectories.runtimeDataDir)
  })

  it('allows an explicit runtime directory to be shared across distributions', () => {
    const env = { CRAFT_HUB_DATA_DIR: '/shared/craft-hub' }
    const communityDirectories = resolveDesktopDataDirectories({ appDataDir: '/application-data', development: true, distribution: community, env })
    const downstreamDirectories = resolveDesktopDataDirectories({
      appDataDir: '/application-data',
      development: true,
      distribution: { id: 'downstream', name: 'Downstream', dataDirectoryName: 'Downstream Hub' },
      env,
    })

    expect(communityDirectories.runtimeDataDir).toBe('/shared/craft-hub')
    expect(downstreamDirectories.runtimeDataDir).toBe('/shared/craft-hub')
    expect(communityDirectories.developmentUserDataDir).not.toBe(downstreamDirectories.developmentUserDataDir)
  })
})

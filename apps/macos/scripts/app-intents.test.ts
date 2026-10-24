import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appIntentConstantPaths } from './app-intents.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(paths: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'native-intent-constants-'))
  roots.push(root)
  for (const path of paths) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), '{}')
  }
  return root
}

describe('app intents build product selection', () => {
  it('excludes the other architecture, Debug, tests and stale SwiftPM outputs', async () => {
    const prefix = 'out/Intermediates.noindex/CraftHubMac.build'
    const selected = `${prefix}/Release/CraftHubMac-p.build/Objects-normal/x86_64/CraftHubMac-primary.swiftconstvalues`
    const root = await fixture([
      selected,
      `${prefix}/Release/CraftHubMac-p.build/Objects-normal/arm64/CraftHubMac-primary.swiftconstvalues`,
      `${prefix}/Debug/CraftHubMac-p.build/Objects-normal/x86_64/App.swiftconstvalues`,
      `${prefix}/Release/CraftHubMacTests-p.build/Objects-normal/x86_64/Test.swiftconstvalues`,
      'x86_64-apple-macosx/release/CraftHubMac.build/Stale.swiftconstvalues',
    ])
    expect(await appIntentConstantPaths(join(root, 'out/Products/Release'), 'x64')).toEqual([join(root, selected)])
    await expect(appIntentConstantPaths(join(root, 'out/Products/Debug'), 'x64')).rejects.toThrow('Release')
  })

  it('uses only the requested SwiftPM build product and rejects a missing architecture', async () => {
    const selected = 'arm64-apple-macosx/release/CraftHubMac.build/Intents.swiftconstvalues'
    const root = await fixture([selected, 'arm64-apple-macosx/release/CraftHubMacTests.build/Test.swiftconstvalues'])
    expect(await appIntentConstantPaths(join(root, 'arm64-apple-macosx/release'), 'arm64')).toEqual([join(root, selected)])
    await expect(appIntentConstantPaths(join(root, 'out/Products/Release'), 'x64')).rejects.toThrow('did not emit')
    await expect(appIntentConstantPaths(join(root, 'arm64-apple-macosx/release'), 'other')).rejects.toThrow('arm64 or x64')
  })
})

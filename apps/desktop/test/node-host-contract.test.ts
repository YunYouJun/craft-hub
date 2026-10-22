import { describe, expect, it } from 'vitest'
import { packagedCodexOptions } from '../src/codex-executable.ts'
import contract from './fixtures/node-host-contract.json'

describe('shared macOS GUI tool search contract', () => {
  it.each(contract.searches)('$name', ({ home, environment, directories, expected }) => {
    const contents: Record<string, string[] | undefined> = directories
    const options = packagedCodexOptions({}, {
      modulePath: '/Applications/Craft Hub.app/Contents/Resources/app.asar/main.mjs',
      platform: 'darwin',
      codexMode: 'external',
      homeDirectory: home,
      env: environment,
      readDirectory: path => contents[path] ?? [],
      isExecutable: path => path === `${expected[0]}/codex`,
    })
    expect(options.env?.PATH?.split(':')).toEqual(expected)
    expect(options.codexPathOverride).toBe(`${expected[0]}/codex`)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { packagedCodexOptions } from '../src/codex-executable.ts'

describe('packaged Codex executable', () => {
  it('uses real unpacked paths for the bundled CLI and its companion tools', () => {
    const archivedPackage = '/Applications/Craft Hub.app/Contents/Resources/app.asar/apps/desktop/node_modules/@openai/codex-darwin-arm64/package.json'
    const root = '/Applications/Craft Hub.app/Contents/Resources/app.asar.unpacked/apps/desktop/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin'
    const resolve = vi.fn(() => archivedPackage)
    const options = packagedCodexOptions({}, {
      modulePath: '/Applications/Craft Hub.app/Contents/Resources/app.asar/apps/desktop/dist/main.mjs',
      platform: 'darwin',
      architecture: 'arm64',
      codexMode: 'bundled',
      env: { PATH: '/usr/bin', OPTIONAL: undefined },
      resolve,
      isFile: file => file === `${root}/bin/codex` || file === `${root}/codex-package.json`,
      isDirectory: directory => directory === `${root}/codex-path`,
    })

    expect(resolve).toHaveBeenLastCalledWith('@openai/codex-darwin-arm64/package.json', archivedPackage)
    expect(options.codexPathOverride).toBe(`${root}/bin/codex`)
    expect(options.env).toEqual({ PATH: `${root}/codex-path:/usr/bin` })
  })

  it('supports the SDK legacy vendor layout', () => {
    const root = '/app/app.asar.unpacked/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl'
    const options = packagedCodexOptions({}, {
      modulePath: '/app/app.asar/main.mjs',
      platform: 'linux',
      architecture: 'x64',
      codexMode: 'bundled',
      env: { PATH: '/usr/bin' },
      resolve: () => '/app/app.asar/node_modules/@openai/codex-linux-x64/package.json',
      isFile: file => file === `${root}/codex/codex`,
      isDirectory: directory => directory === `${root}/path`,
    })
    expect(options.codexPathOverride).toBe(`${root}/codex/codex`)
    expect(options.env?.PATH).toBe(`${root}/path:/usr/bin`)
  })

  it('uses Windows path separators and merges case-insensitive PATH keys', () => {
    const root = 'C:\\Craft Hub\\resources\\app.asar.unpacked\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc'
    const options = packagedCodexOptions({ env: { PATH: 'C:\\custom' } }, {
      modulePath: 'C:\\Craft Hub\\resources\\app.asar\\main.mjs',
      platform: 'win32',
      architecture: 'x64',
      codexMode: 'bundled',
      env: { Path: 'C:\\Windows', OTHER: 'value' },
      resolve: () => 'C:\\Craft Hub\\resources\\app.asar\\node_modules\\@openai\\codex-win32-x64\\package.json',
      isFile: file => file === `${root}\\bin\\codex.exe` || file === `${root}\\codex-package.json`,
      isDirectory: directory => directory === `${root}\\codex-path`,
    })
    expect(options.codexPathOverride).toBe(`${root}\\bin\\codex.exe`)
    expect(options.env).toEqual({ Path: `${root}\\codex-path;C:\\custom`, OTHER: 'value' })
  })

  it.each([
    ['/workspace/apps/desktop/src/main.ts', {}],
    ['/Applications/app.asar.unpacked/main.mjs', {}],
    ['/Applications/app.asar/main.mjs', { codexPathOverride: '/custom/codex', env: { PATH: '/custom/tools' } }],
  ])('keeps unpackaged and explicit SDK options unchanged for %s', (modulePath, options) => {
    const resolve = vi.fn()
    expect(packagedCodexOptions(options, { modulePath, resolve })).toBe(options)
    expect(resolve).not.toHaveBeenCalled()
  })

  it('fails before starting an agent if its packaged executable is missing', () => {
    expect(() => packagedCodexOptions({}, {
      modulePath: '/app/app.asar/main.mjs',
      platform: 'darwin',
      architecture: 'x64',
      codexMode: 'bundled',
      resolve: () => '/app/app.asar/node_modules/@openai/codex-darwin-x64/package.json',
      isFile: () => false,
    })).toThrow('Packaged Codex executable is missing')
  })

  it('resolves separately installed Codex from common macOS GUI paths without requiring the removed package', () => {
    const resolve = vi.fn(() => {
      throw new Error('The bundled CLI is absent')
    })
    const isExecutable = vi.fn(candidate => candidate === '/Users/test/.local/bin/codex')
    const options = packagedCodexOptions({}, {
      modulePath: '/app/app.asar/apps/desktop/dist/main.mjs',
      platform: 'darwin',
      codexMode: 'external',
      homeDirectory: '/Users/test',
      env: { PATH: '.:relative:/usr/bin:/bin', OTHER: 'value' },
      resolve,
      isExecutable,
    })
    expect(options.codexPathOverride).toBe('/Users/test/.local/bin/codex')
    expect(options.env?.OTHER).toBe('value')
    expect(options.env?.PATH?.split(':').slice(0, 5)).toEqual(['/usr/bin', '/bin', '/Users/test/.local/bin', '/opt/homebrew/bin', '/usr/local/bin'])
    expect(resolve).not.toHaveBeenCalled()
    expect(isExecutable.mock.calls.flat()).not.toContain('codex')
  })

  it('keeps PATH priority and explicitly reports a missing external CLI', () => {
    const context = { modulePath: '/app/app.asar/apps/desktop/dist/main.mjs', platform: 'darwin' as const, codexMode: 'external' as const, env: { PATH: '/custom/tools:/usr/bin' }, homeDirectory: '/Users/test' }
    expect(packagedCodexOptions({}, { ...context, isExecutable: candidate => candidate === '/custom/tools/codex' }).codexPathOverride).toBe('/custom/tools/codex')
    expect(() => packagedCodexOptions({}, { ...context, isExecutable: () => false })).toThrow('Open Software Center and install Codex CLI')
  })

  it('makes pnpm and installed fnm Node directories available to GUI-launched CLI scripts', () => {
    const readDirectory = vi.fn((directory) => {
      if (directory === '/custom/fnm/node-versions')
        return ['v22.11.0', 'v24.18.0', '.downloads', '../untrusted']
      return []
    })
    const options = packagedCodexOptions({}, {
      modulePath: '/app/app.asar/apps/desktop/dist/main.mjs',
      platform: 'darwin',
      codexMode: 'external',
      homeDirectory: '/Users/test',
      env: { PATH: '/usr/bin:/bin', PNPM_HOME: '/custom/pnpm', FNM_DIR: '/custom/fnm' },
      readDirectory,
      isExecutable: candidate => candidate === '/custom/pnpm/codex',
    })
    expect(options.codexPathOverride).toBe('/custom/pnpm/codex')
    const directories = options.env?.PATH?.split(':') ?? []
    expect(directories).toContain('/Users/test/Library/pnpm')
    expect(directories).toContain('/custom/fnm/aliases/default/bin')
    expect(directories).toContain('/custom/fnm/node-versions/v24.18.0/installation/bin')
    expect(directories.indexOf('/custom/fnm/node-versions/v24.18.0/installation/bin')).toBeLessThan(directories.indexOf('/custom/fnm/node-versions/v22.11.0/installation/bin'))
    expect(directories.some(directory => directory.includes('untrusted') || directory.includes('.downloads'))).toBe(false)
  })

  it.each([
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Users/test/Applications/Codex.app/Contents/Resources/codex',
    '/Users/test/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
  ])('uses an installed native app CLI without a PATH shim: %s', (executable) => {
    const options = packagedCodexOptions({}, {
      modulePath: '/app/app.asar/apps/desktop/dist/main.mjs',
      platform: 'darwin',
      codexMode: 'external',
      homeDirectory: '/Users/test',
      env: { PATH: '/usr/bin:/bin' },
      readDirectory: () => [],
      isExecutable: candidate => candidate === executable,
    })
    expect(options.codexPathOverride).toBe(executable)
  })

  it('makes native app companion tools available without requiring Node', () => {
    const resources = '/Applications/ChatGPT.app/Contents/Resources/codex-cli'
    const options = packagedCodexOptions({}, {
      modulePath: '/app/app.asar/apps/desktop/dist/main.mjs',
      platform: 'darwin',
      codexMode: 'external',
      homeDirectory: '/Users/test',
      env: { PATH: '/usr/bin:/bin' },
      readDirectory: () => [],
      isExecutable: candidate => candidate === `${resources}/CodexCLI.app/Contents/MacOS/codex`,
      isDirectory: directory => directory === `${resources}/codex-path`,
    })
    expect(options.env?.PATH?.split(':')[0]).toBe(`${resources}/codex-path`)
  })

  it('ignores relative package-manager locations and tolerates missing fnm installations', () => {
    const isExecutable = vi.fn<(candidate: string) => boolean>(() => false)
    expect(() => packagedCodexOptions({}, {
      modulePath: '/app/app.asar/main.mjs',
      platform: 'darwin',
      codexMode: 'external',
      homeDirectory: '/Users/test',
      env: { PNPM_HOME: 'relative/pnpm', FNM_DIR: '../fnm' },
      readDirectory: () => { throw new Error('not installed') },
      isExecutable,
    })).toThrow('No executable Codex CLI was found')
    expect(isExecutable.mock.calls.flat().every(candidate => candidate.startsWith('/'))).toBe(true)
  })

  it('requires a native Windows executable and never chooses a command-shell shim', () => {
    const context = { modulePath: 'C:\\app\\app.asar\\main.mjs', platform: 'win32' as const, codexMode: 'external' as const, env: { Path: 'C:\\tools' } }
    const isExecutable = vi.fn(candidate => candidate.endsWith('.cmd'))
    expect(() => packagedCodexOptions({}, { ...context, isExecutable })).toThrow('Windows .cmd and .bat shims are unsupported')
    expect(isExecutable).toHaveBeenCalledWith('C:\\tools\\codex.exe')
    expect(packagedCodexOptions({}, { ...context, isExecutable: candidate => candidate === 'C:\\tools\\codex.exe' }).codexPathOverride).toBe('C:\\tools\\codex.exe')
  })
})

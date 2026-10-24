import { expect, it } from 'vitest'
import { codexExecutable } from '../src/client'

it('finds GUI-installed Codex without a login shell or a project executable', () => {
  const examined: string[] = []
  const executable = codexExecutable({ platform: 'darwin', home: '/fixture/home', exists: (path) => {
    examined.push(path)
    return path === '/fixture/home/.local/bin/codex'
  } })
  expect(executable).toBe('/fixture/home/.local/bin/codex')
  expect(examined).toContain('/fixture/home/Applications/Codex.app/Contents/Resources/codex')
  expect(examined.every(path => path.startsWith('/Applications/') || path.startsWith('/fixture/home/'))).toBe(true)
  expect(codexExecutable({ platform: 'darwin', home: '/fixture/home', exists: path => path === '/opt/homebrew/bin/codex' })).toBe('/opt/homebrew/bin/codex')
  expect(codexExecutable({ platform: 'darwin', home: '/fixture/home', exists: path => path === '/usr/local/bin/codex' })).toBe('/usr/local/bin/codex')
  expect(codexExecutable({ platform: 'win32', exists: () => false })).toBe('codex.exe')
  expect(codexExecutable({ platform: 'linux', exists: () => false })).toBe('codex')
})

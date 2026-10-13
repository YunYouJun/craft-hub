import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ run: vi.fn(), mode: '100644', size: '42', fail: false }))
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: fixture.run }) }
})
const { readRepositoryCatalogFile } = await import('../src/workspace-repository')
const path = 'software.config.ts'
const commit = 'a'.repeat(40)
const blob = 'b'.repeat(40)
beforeEach(() => {
  fixture.mode = '100644'
  fixture.size = '42'
  fixture.fail = false
  fixture.run.mockReset().mockImplementation(async (_command: string, args: string[]) => {
    if (fixture.fail)
      throw new Error('private transport diagnostic')
    const stdout = args.includes('rev-parse') ? commit : args.includes('ls-tree') ? `${fixture.mode} blob ${blob}\t${path}\0` : args.includes('cat-file') ? args.includes('-s') ? fixture.size : 'export const softwareGroups = []' : ''
    return { stdout, stderr: '' }
  })
})

describe('read-only remote catalog transport', () => {
  it('reads a regular blob at one fetched commit without checkout, hooks or shell execution', async () => {
    expect(await readRepositoryCatalogFile('https://github.com/example/catalog.git', 'next/preview', path)).toEqual({ commit, content: 'export const softwareGroups = []' })
    const calls = fixture.run.mock.calls
    expect(calls.find(([, args]) => args.includes('fetch'))![1]).toContain('refs/heads/next/preview')
    expect(calls.find(([, args]) => args.includes('ls-tree'))![1]).toContain(commit)
    for (const [command, args, options] of calls) {
      expect(command).toBe('git')
      expect(args).toContain('core.hooksPath=/dev/null')
      expect(args).not.toContain('checkout')
      expect(options.shell).toBe(false)
      expect(options.env.GIT_TERMINAL_PROMPT).toBe('0')
    }
  })

  it('rejects symlink blobs and oversized files before reading contents', async () => {
    fixture.mode = '120000'
    await expect(readRepositoryCatalogFile('https://example.com/catalog', 'HEAD', path)).rejects.toThrow('regular TypeScript')
    expect(fixture.run.mock.calls.some(([, args]) => args.includes('cat-file'))).toBe(false)
    fixture.mode = '100644'
    fixture.size = String(3 * 1024 * 1024)
    await expect(readRepositoryCatalogFile('https://example.com/catalog', 'HEAD', path)).rejects.toThrow('size limit')
    expect(fixture.run.mock.calls.some(([, args]) => args.includes('cat-file') && args.includes('blob'))).toBe(false)
  })

  it('redacts transport failures', async () => {
    fixture.fail = true
    await expect(readRepositoryCatalogFile('https://example.com/catalog', 'HEAD', path)).rejects.toThrow('Repository read failed')
    await expect(readRepositoryCatalogFile('https://example.com/catalog', 'HEAD', path)).rejects.not.toThrow('private transport diagnostic')
  })
})

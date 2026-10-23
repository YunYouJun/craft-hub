import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const runtimeRequire = createRequire(new URL('../packages/craft-hub/package.json', import.meta.url))
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { parseAllDocuments } = runtimeRequire('yaml') as {
  parseAllDocuments: (source: string) => Array<{
    errors: Error[]
    toJS: () => { packages?: Record<string, unknown>, snapshots?: Record<string, unknown> }
  }>
}
const { satisfies, valid } = runtimeRequire('semver') as {
  satisfies: (version: string, range: string) => boolean
  valid: (version: string) => string | null
}
function readLockfileResolutionKeys(source: string): string[] {
  const documents = parseAllDocuments(source)
  if (documents.length === 0)
    throw new Error('The lockfile contains no YAML documents')

  return documents.flatMap((document) => {
    if (document.errors.length > 0)
      throw document.errors[0]
    const lockfile = document.toJS()
    if (!lockfile || typeof lockfile !== 'object')
      throw new Error('A lockfile document must contain a mapping')
    return [...Object.keys(lockfile.packages ?? {}), ...Object.keys(lockfile.snapshots ?? {})]
  })
}

function resolvedVersions(keys: string[], name: string): string[] {
  return keys
    .filter(key => key.startsWith(`${name}@`))
    .map(key => key.slice(name.length + 1).split('(')[0]!)
}

const lockfileResolutionKeys = readLockfileResolutionKeys(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'))

// Check every lockfile path, including dev and optional dependencies. Live audit
// remains necessary for new advisories; these ranges prevent known regressions.
const vulnerableRanges = [
  { name: '@modelcontextprotocol/client', range: '>=2.0.0 <2.2.0' },
  { name: '@modelcontextprotocol/sdk', range: '>=1.12.0 <1.31.0' },
  { name: '@toon-format/toon', range: '<2.3.1' },
  { name: '@vue/server-renderer', range: '<3.5.42' },
  { name: 'brace-expansion', range: '>=2.0.0 <2.1.7 || >=4.0.0 <5.0.12' },
  { name: 'dompurify', range: '<3.4.17' },
  { name: 'fast-uri', range: '>=3.0.0 <3.1.8' },
  // The upstream maintainer disputes GHSA-ch52-4w7c-c8xp. Version 4.3.0 is
  // outside its reported range; this is not proof of a max-stale behavior fix.
  { name: 'http-cache-semantics', range: '<=4.2.0' },
  { name: 'ip-address', range: '<=10.7.0' },
  { name: 'markdown-it', range: '<14.3.1' },
  { name: 'postcss-selector-parser', range: '<7.1.6' },
  { name: 'proxy-addr', range: '>=1.1.0 <2.0.8' },
  { name: 'sharp', range: '<0.35.5' },
  { name: 'source-map-js', range: '>=1.0.0 <1.2.2' },
  { name: 'undici', range: '>=6.7.0 <6.28.1 || >=7.0.0 <7.29.1' },
]

describe('dependency advisory regressions', () => {
  it.each([
    { format: 'single', separator: '' },
    { format: 'multiple', separator: '---\n' },
  ])('finds affected toolchain and peer resolutions in $format lockfile documents', ({ separator }) => {
    const source = separator
      ? `importers:\n  .:\n    packageManagerDependencies:\n      pnpm: {}\npackages:\n  undici@6.28.0: {}\n${separator}packages:\n  undici@7.29.1: {}\nsnapshots:\n  undici@7.28.0(peer@1.0.0): {}\n`
      : 'packages:\n  undici@6.28.0: {}\n  undici@7.29.1: {}\nsnapshots:\n  undici@7.28.0(peer@1.0.0): {}\n'
    const versions = resolvedVersions(readLockfileResolutionKeys(source), 'undici')

    expect(versions.filter(version => satisfies(version, '>=6.7.0 <6.28.1 || >=7.0.0 <7.29.1')))
      .toEqual(['6.28.0', '7.28.0'])
    expect(versions).toContain('7.29.1')
  })

  it('rejects malformed later documents instead of scanning a partial lockfile', () => {
    expect(() => readLockfileResolutionKeys('packages:\n  undici@7.29.1: {}\n---\npackages: [\n')).toThrow()
  })

  it.each(vulnerableRanges)('keeps every $name resolution outside known affected ranges', ({ name, range }) => {
    const versions = resolvedVersions(lockfileResolutionKeys, name)

    expect(versions.length).toBeGreaterThan(0)
    for (const version of versions) {
      expect(valid(version)).not.toBeNull()
      expect(satisfies(version, range), `${name}@${version} matches ${range}`).toBe(false)
    }
  })

  it('does not trust unrelated IPv4 clients through a mapped IPv6 subnet', () => {
    const sdkRequire = createRequire(runtimeRequire.resolve('@modelcontextprotocol/sdk/server/mcp.js'))
    const expressRequire = createRequire(sdkRequire.resolve('express'))
    const proxyAddr = expressRequire('proxy-addr') as { compile: (subnet: string) => (address: string) => boolean }

    expect(proxyAddr.compile('::ffff:10.0.0.0/8')('203.0.113.10')).toBe(false)
    expect(proxyAddr.compile('::ffff:10.0.0.0/104')('10.1.2.3')).toBe(true)
    expect(proxyAddr.compile('::ffff:10.0.0.0/104')('203.0.113.10')).toBe(false)
  })

  it('omits carriage-return attribute names during Vue server rendering', () => {
    const { ssrRenderAttrs } = webRequire('vue/server-renderer') as {
      ssrRenderAttrs: (props: Record<string, string>) => string
    }
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(ssrRenderAttrs({ 'id': 'safe', 'x\ronerror': 'unsafe' })).toBe(' id="safe"')
    }
    finally {
      warning.mockRestore()
    }
  })
})

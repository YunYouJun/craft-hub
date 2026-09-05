import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { communityDesktopUpdateBaseUrl, parseDesktopDistributionManifest, resolveDesktopDistributionAsset } from '../src/distribution.ts'

const downstreamManifest = {
  schemaVersion: 1,
  hostPlugins: ['@acme/craft-hub-host-plugin', './plugins/host-plugin.mjs'],
  distribution: {
    id: 'acme',
    name: 'Acme Workbench',
    appId: 'com.acme.workbench',
    dataDirectoryName: 'Acme Workbench',
    marketplaceSources: [{
      id: 'acme',
      name: 'Acme',
      kind: 'managed',
      catalogUrl: 'https://developer.acme.example/plugins/catalog.json',
      registry: 'https://registry.acme.example/npm/',
      enabled: true,
    }],
    marketplaceTrustPolicies: [{
      id: 'acme-catalog-2026',
      organization: 'Acme',
      catalogUrl: 'https://developer.acme.example/plugins/catalog.json',
      algorithm: 'ed25519',
      publicKeySpki: 'AQID',
    }],
  },
  desktop: {
    artifactName: 'Acme-Workbench',
    icons: {
      application: 'assets/icon.png',
      macos: 'assets/icon.icns',
    },
    protocol: 'acme-workbench',
    updateBaseUrl: null,
    about: {
      authors: ['Acme Developer Experience'],
      copyright: 'Copyright © Acme',
      description: 'An Acme developer workbench.',
      license: 'Distributed for Acme developers.',
      linkLabel: 'Documentation',
      website: 'https://developer.acme.example/workbench',
    },
  },
}

describe('desktop distribution manifest', () => {
  it('publishes community updates from the deployed Cloudflare Pages site', () => {
    expect(communityDesktopUpdateBaseUrl).toBe('https://craft-hub.pages.dev/updates/alpha')
  })

  it('validates and normalizes one downstream distribution', () => {
    const { updateBaseUrl: _updateBaseUrl, ...desktop } = downstreamManifest.desktop
    expect(parseDesktopDistributionManifest(downstreamManifest)).toEqual({
      ...downstreamManifest,
      desktop: {
        ...desktop,
        developmentProtocol: 'acme-workbench-dev',
      },
    })
  })

  it.each([
    [{ ...downstreamManifest, distribution: { ...downstreamManifest.distribution, name: '../outside' } }, 'safe file name'],
    [{ ...downstreamManifest, desktop: { ...downstreamManifest.desktop, protocol: 'Acme Workbench' } }, 'URL scheme'],
    [{ ...downstreamManifest, desktop: { ...downstreamManifest.desktop, artifactName: '../Acme' } }, 'letters, digits, and hyphens'],
    [{ ...downstreamManifest, desktop: { ...downstreamManifest.desktop, icons: { ...downstreamManifest.desktop.icons, application: '../icon.png' } } }, 'safe path relative'],
    [{ ...downstreamManifest, desktop: { ...downstreamManifest.desktop, icons: { ...downstreamManifest.desktop.icons, application: 'assets/icon.svg' } } }, 'must reference a .png file'],
    [{ ...downstreamManifest, desktop: { ...downstreamManifest.desktop, icons: { ...downstreamManifest.desktop.icons, macos: '/tmp/icon.icns' } } }, 'safe path relative'],
    [{ ...downstreamManifest, distribution: { ...downstreamManifest.distribution, marketplaceSources: [{ ...downstreamManifest.distribution.marketplaceSources[0], catalogUrl: 'http://developer.acme.example/catalog.json' }] } }, 'credential-free HTTPS'],
    [{ ...downstreamManifest, distribution: { ...downstreamManifest.distribution, marketplaceSources: [{ ...downstreamManifest.distribution.marketplaceSources[0], kind: 'user' }] } }, 'builtin or managed'],
    [{ ...downstreamManifest, distribution: { ...downstreamManifest.distribution, marketplaceTrustPolicies: [{ ...downstreamManifest.distribution.marketplaceTrustPolicies[0], algorithm: 'rsa' }] } }, 'must be ed25519'],
    [{ ...downstreamManifest, distribution: { ...downstreamManifest.distribution, marketplaceTrustPolicies: [{ ...downstreamManifest.distribution.marketplaceTrustPolicies[0], catalogUrl: 'http://developer.acme.example/catalog.json' }] } }, 'credential-free HTTPS'],
    [{ ...downstreamManifest, distribution: { ...downstreamManifest.distribution, marketplaceTrustPolicies: [{ ...downstreamManifest.distribution.marketplaceTrustPolicies[0], publicKeySpki: 'not base64' }] } }, 'base64url'],
    [{ ...downstreamManifest, hostPlugins: ['./../outside.mjs'] }, 'stay inside'],
    [{ ...downstreamManifest, hostPlugins: ['https://example.com/plugin.mjs'] }, 'package name or safe relative'],
    [{ ...downstreamManifest, hostPlugins: ['@acme/plugin', '@acme/plugin'] }, 'duplicate'],
  ])('rejects an unsafe manifest', (manifest, message) => {
    expect(() => parseDesktopDistributionManifest(manifest)).toThrow(message)
  })

  it('resolves declared assets from the manifest directory', () => {
    expect(resolveDesktopDistributionAsset('/tmp/acme/distribution.json', 'assets/icon.png'))
      .toBe(resolve('/tmp/acme/assets/icon.png'))
    expect(() => resolveDesktopDistributionAsset('/tmp/acme/distribution.json', '../icon.png'))
      .toThrow('must stay inside')
  })
})

import type { DesktopLinkError, DesktopLinkErrorCode } from '../src/deep-links'
import { describe, expect, it } from 'vitest'
import { DesktopLinkCoordinator, findDesktopLinkArgument, parseDesktopLink } from '../src/deep-links'

const rejectedLinks: Array<[string, DesktopLinkErrorCode]> = [
  ['https://example.com', 'unexpected-scheme'],
  ['craft-hub://run?v=1&command=test', 'unexpected-action'],
  ['craft-hub://open?v=2', 'unexpected-version'],
  ['craft-hub://open?v=1&view=capabilities', 'unexpected-parameter'],
  ['craft-hub://open?v=1&v=1', 'repeated-parameter'],
  ['craft-hub://project?v=1&repo=file%3A%2F%2F%2Ftmp%2Fproject', 'unsafe-repository'],
  ['craft-hub://project?v=1&repo=https%3A%2F%2Fexample.com%2Frepo&subdir=..%2Foutside', 'unsafe-repository'],
  [`craft-hub://open?v=1&padding=${'x'.repeat(2_100)}`, 'link-too-long'],
]

describe('desktop links', () => {
  it.each([
    ['craft-hub://open?v=1', { kind: 'navigation', navigation: { kind: 'home' } }],
    ['craft-hub-dev://open?v=1', { kind: 'navigation', navigation: { kind: 'home' } }],
    [
      'craft-hub://project?v=1&repo=https%3A%2F%2Fgithub.com%2FYunYouJun%2Fcraft-hub.git&subdir=apps%2Fweb',
      {
        kind: 'navigation',
        navigation: {
          kind: 'project',
          reference: { repository: 'https://github.com/YunYouJun/craft-hub', subdir: 'apps/web' },
        },
      },
    ],
    ['craft-hub://marketplace/sources/import?catalog=https%3A%2F%2Fexample.com%2Fcatalog.json', { kind: 'marketplace-import', catalogUrl: 'https://example.com/catalog.json' }],
    ['craft-hub://cloud/connect?code=once&challenge=expected', { kind: 'cloud-connect', url: 'craft-hub://cloud/connect?code=once&challenge=expected' }],
  ])('parses %s', (url, expected) => {
    expect(parseDesktopLink(url)).toEqual(expected)
  })

  it.each(rejectedLinks)('rejects %s with stable reason %s', (url, code) => {
    expect(() => parseDesktopLink(url)).toThrowError(expect.objectContaining<Partial<DesktopLinkError>>({ code }))
  })

  it('finds startup links and keeps callback queues independent from last-wins navigation', () => {
    expect(findDesktopLinkArgument(['craft-hub', '--flag', 'craft-hub://open?v=1'])).toBe('craft-hub://open?v=1')
    const coordinator = new DesktopLinkCoordinator()
    coordinator.accept('craft-hub://open?v=1')
    coordinator.accept('craft-hub://cloud/connect?code=once&challenge=expected')
    coordinator.accept('craft-hub://marketplace/sources/import?catalog=https%3A%2F%2Fexample.com%2Fcatalog.json')
    coordinator.accept('craft-hub://project?v=1&repo=https%3A%2F%2Fexample.com%2Fproject')

    expect(coordinator.consumeCloudConnect()).toContain('cloud/connect')
    expect(coordinator.consumeMarketplaceImport()).toBe('https://example.com/catalog.json')
    expect(coordinator.consumeNavigation()).toEqual({ kind: 'project', reference: { repository: 'https://example.com/project' } })
    expect(coordinator.consumeNavigation()).toBeUndefined()
  })
})

import { expect, it } from 'vitest'
import { desktopConnectFromURL, storedDesktopConnect } from './desktop-connect'

it.each(['craft-hub', 'craft-hub-dev', 'craft-hub-native'])('preserves the exact %s callback through login', (scheme) => {
  const input = { publicKey: 'fixture-public-key', challenge: 'fixture_challenge-1', callback: `${scheme}://cloud/connect` }
  const url = new URL(`https://cloud.example.com/connect?${new URLSearchParams({ public_key: input.publicKey, challenge: input.challenge, callback: input.callback })}`)
  expect(desktopConnectFromURL(url)).toEqual(input)
  expect(storedDesktopConnect(JSON.stringify(input))).toEqual(input)
})

it('rejects duplicate and tampered callback targets before bootstrap or navigation', () => {
  for (const callback of ['https://example.com', 'craft-hub-native://cloud/other', 'craft-hub-native://cloud/connect?extra=1', 'craft-hub-native://user@cloud/connect'])
    expect(storedDesktopConnect(JSON.stringify({ publicKey: 'fixture', challenge: 'fixture', callback }))).toBeUndefined()
  expect(storedDesktopConnect('{invalid')).toBeUndefined()
  const url = new URL('https://cloud.example.com/connect?public_key=fixture&challenge=a&challenge=b&callback=craft-hub-native%3A%2F%2Fcloud%2Fconnect')
  expect(desktopConnectFromURL(url)).toBeUndefined()
})

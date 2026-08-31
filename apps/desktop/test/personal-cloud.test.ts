import { parseCloudConnectCallback } from '@craft-hub/personal-cloud'
import { describe, expect, it } from 'vitest'

describe('personal cloud protocol callback', () => {
  it('accepts only the expected scheme, host, path, code, and challenge', () => {
    expect(parseCloudConnectCallback('craft-hub://cloud/connect?code=once&challenge=expected', 'expected')).toEqual({
      code: 'once',
      challenge: 'expected',
    })
    expect(parseCloudConnectCallback('craft-hub-dev://cloud/connect?code=once&challenge=expected', 'expected')).toEqual({
      code: 'once',
      challenge: 'expected',
    })
    expect(parseCloudConnectCallback('acme-workbench://cloud/connect?code=once&challenge=expected', 'expected', ['acme-workbench'])).toEqual({
      code: 'once',
      challenge: 'expected',
    })
    expect(() => parseCloudConnectCallback('https://cloud/connect?code=once&challenge=expected', 'expected')).toThrow('Unexpected')
    expect(() => parseCloudConnectCallback('craft-hub://cloud/connect?code=once&challenge=other', 'expected')).toThrow('challenge')
    expect(() => parseCloudConnectCallback('craft-hub://cloud/connect?challenge=expected', 'expected')).toThrow('challenge')
  })
})

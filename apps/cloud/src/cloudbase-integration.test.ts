// @vitest-environment happy-dom

import cloudbase from '@cloudbase/js-sdk/app'
import { describe, expect, it } from 'vitest'
import '@cloudbase/js-sdk/auth'

describe('cloudBase browser entry points', () => {
  it('registers authentication on the minimal app entry point', () => {
    const app = cloudbase.init({
      env: 'browser-entry-point-test',
      persistence: 'none',
    })

    expect(app.auth).toBeDefined()
    expect(app.auth.signOut).toBeTypeOf('function')
  })
})

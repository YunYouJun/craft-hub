import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const cloudFunctionRequire = createRequire(new URL('../cloudfunctions/personal-cloud/package.json', import.meta.url))
const nodeSdkRequire = createRequire(cloudFunctionRequire.resolve('@cloudbase/node-sdk/package.json'))
const databaseRequire = createRequire(nodeSdkRequire.resolve('@cloudbase/database/package.json'))

describe('dependency security compatibility', () => {
  it('loads the CloudBase SDK after applying dependency overrides', () => {
    const cloudbase = cloudFunctionRequire('@cloudbase/node-sdk') as {
      init: (options: object) => { auth: unknown, database: unknown }
    }
    const application = cloudbase.init({ env: 'test-env', secretId: 'test-id', secretKey: 'test-key' })

    expect(application.auth).toBeTypeOf('function')
    expect(application.database).toBeTypeOf('function')
  })

  it('resolves the safe lodash.set replacement without prototype pollution', () => {
    const set = databaseRequire('lodash.set') as (target: object, path: string, value: unknown) => object
    const target = {}
    set(target, 'project.commands.build', 'pnpm build')
    set(target, '__proto__.polluted', true)

    expect(target).toEqual({ project: { commands: { build: 'pnpm build' } } })
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })
})

import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const cloudFunctionRequire = createRequire(new URL('../cloudfunctions/personal-cloud/package.json', import.meta.url))
const nodeSdkRequire = createRequire(cloudFunctionRequire.resolve('@cloudbase/node-sdk/package.json'))
const databaseRequire = createRequire(nodeSdkRequire.resolve('@cloudbase/database/package.json'))

interface CloudBaseSdk {
  init: (options: object) => {
    auth: () => { getUserInfo: unknown }
    database: () => { collection: (name: string) => { doc: (id: string) => { id: string, get: unknown } } }
  }
}

// vi.mock cannot intercept createRequire. These are the real CJS exports used by
// node-sdk 3.18.x: keep the SDK/factories real and isolate cloud discovery plus
// the request entry points used by these clients. Missing/renamed exports must
// fail rather than fall back to a real probe when upgrading the SDK. Recheck
// these internal boundaries on upgrades; do not substitute cloud env flags.
const cloudPlatform = nodeSdkRequire('./dist/utils/cloudplatform') as {
  preflightRuntimeCloudPlatform: () => Promise<void>
}
const metadata = nodeSdkRequire('./dist/utils/metadata') as {
  lookupAppId: () => Promise<string>
  lookupCredentials: (role: string) => Promise<unknown>
}
const { Db } = nodeSdkRequire('@cloudbase/database') as { Db: { reqClass?: unknown } }

// A synchronous callback prevents async work from outliving the restored guards.
function withOfflineCloudBase(run: (cloudbase: CloudBaseSdk) => undefined) {
  const restorations: (() => void)[] = []
  const requesterDescriptor = Object.getOwnPropertyDescriptor(Db, 'reqClass')
  const unexpectedRequests: string[] = []

  function blockRequest(target: Record<string, (...args: never[]) => unknown>, method: string, label: string) {
    // Guard before credentials, signing, DNS, sockets, or retry timers can run.
    const spy = vi.spyOn(target, method).mockImplementation(() => {
      unexpectedRequests.push(label)
      throw new Error(`Unexpected CloudBase request in offline compatibility test: ${label}`)
    })
    restorations.push(() => spy.mockRestore())
  }

  try {
    const preflight = vi.spyOn(cloudPlatform, 'preflightRuntimeCloudPlatform').mockResolvedValue(undefined)
    restorations.push(() => preflight.mockRestore())
    blockRequest(metadata, 'lookupAppId', 'metadata app ID')
    blockRequest(metadata, 'lookupCredentials', 'metadata credentials')

    const apiRequester = nodeSdkRequire('./dist/utils/tcbapirequester') as { request: (...args: unknown[]) => unknown }
    const openApiRequester = nodeSdkRequire('./dist/utils/tcbopenapicommonrequester') as { request: (...args: unknown[]) => unknown }
    blockRequest(apiRequester, 'request', 'CloudBase API')
    blockRequest(openApiRequester, 'request', 'CloudBase Open API')

    const cloudbase = cloudFunctionRequire('@cloudbase/node-sdk') as CloudBaseSdk
    run(cloudbase)

    // A swallowed request error must still fail the test.
    expect(unexpectedRequests).toEqual([])
    expect(preflight).toHaveBeenCalled()
  }
  finally {
    for (const restore of restorations.reverse())
      restore()
    // database() changes a static dependency field; preserve both its value and
    // whether it existed, even when an assertion or SDK constructor throws.
    if (requesterDescriptor)
      Object.defineProperty(Db, 'reqClass', requesterDescriptor)
    else
      Reflect.deleteProperty(Db, 'reqClass')
  }
}

function isolatedState() {
  return {
    preflight: cloudPlatform.preflightRuntimeCloudPlatform,
    appId: metadata.lookupAppId,
    credentials: metadata.lookupCredentials,
    api: nodeSdkRequire('./dist/utils/tcbapirequester').request,
    openApi: nodeSdkRequire('./dist/utils/tcbopenapicommonrequester').request,
    requester: Object.getOwnPropertyDescriptor(Db, 'reqClass'),
  }
}

const offlineConfig = { env: 'test-env', secretId: 'test-id', secretKey: 'test-key' }

// The SDK uses shared CJS exports and a static Db field, so keep this suite serial.
describe('dependency security compatibility', { concurrent: false }, () => {
  it('initializes the real CloudBase SDK and local clients offline after dependency overrides', () => {
    const before = isolatedState()
    withOfflineCloudBase((cloudbase) => {
      const application = cloudbase.init(offlineConfig)
      const auth = application.auth()
      const document = application.database().collection('dependency-smoke').doc('offline-document')

      expect(auth.getUserInfo).toBeTypeOf('function')
      expect(document.id).toBe('offline-document')
      expect(document.get).toBeTypeOf('function')
    })
    expect(isolatedState()).toEqual(before)
  })

  it.each([false, true])('restores state after failure (existing database requester: %s)', (hasRequester) => {
    const originalRequester = Object.getOwnPropertyDescriptor(Db, 'reqClass')
    const failure = new Error('intentional smoke test failure')
    try {
      if (hasRequester)
        Object.defineProperty(Db, 'reqClass', { value: Symbol('existing requester'), configurable: true, writable: true })
      const before = isolatedState()
      expect(() => withOfflineCloudBase((cloudbase) => {
        cloudbase.init(offlineConfig).database()
        throw failure
      })).toThrow(failure)
      expect(isolatedState()).toEqual(before)
    }
    finally {
      if (originalRequester)
        Object.defineProperty(Db, 'reqClass', originalRequester)
      else
        Reflect.deleteProperty(Db, 'reqClass')
    }
  })

  it.each([
    { label: 'metadata app ID', attempt: () => metadata.lookupAppId() },
    { label: 'metadata credentials', attempt: () => metadata.lookupCredentials('offline-test-role') },
    { label: 'CloudBase API', attempt: () => nodeSdkRequire('./dist/utils/tcbapirequester').request({}) },
    { label: 'CloudBase Open API', attempt: () => nodeSdkRequire('./dist/utils/tcbopenapicommonrequester').request({}) },
  ])('fails closed before $label access', ({ label, attempt }) => {
    const before = isolatedState()
    expect(() => withOfflineCloudBase(() => {
      // Each export is already replaced with the throwing guard, not its real
      // implementation. These checks never start metadata or API requests.
      attempt()
    })).toThrow(`Unexpected CloudBase request in offline compatibility test: ${label}`)
    expect(isolatedState()).toEqual(before)
  })

  it('detects unexpected requests even when the SDK catches the guard error', () => {
    const before = isolatedState()
    expect(() => withOfflineCloudBase((cloudbase) => {
      cloudbase.init(offlineConfig)
      try {
        metadata.lookupAppId()
      }
      catch {
        // Emulate SDK code that silently catches a blocked request.
      }
    })).toThrow(/metadata app ID/)
    expect(isolatedState()).toEqual(before)
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

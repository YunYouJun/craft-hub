import { PassThrough } from 'node:stream'
import { beforeEach, expect, it, vi } from 'vitest'
import { identitySourceRequest, identityTransferRequirement, inspectIdentityRecipient } from '../src/identity-transfer-recipient.ts'

const fixture = vi.hoisted(() => ({
  source: '/private/tmp/Source.app',
  recipient: '/private/tmp/Native.app',
  codes: new Map<string, { identifier: string, team: string, flags: string, plist: Record<string, unknown>, entitlements?: unknown, invalid?: boolean }>(),
  calls: [] as Array<{ command: string, args: string[], options: unknown }>,
}))
vi.mock('node:fs/promises', () => ({ realpath: vi.fn(async (path: string) => path === process.execPath ? `${fixture.source}/Contents/MacOS/Source` : path) }))
vi.mock('node:child_process', () => ({
  execFile: vi.fn((command: string, args: string[], options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    fixture.calls.push({ command, args, options })
    const stdin = new PassThrough()
    queueMicrotask(() => {
      if (command === '/usr/bin/plutil' && args.at(-1) === '-') {
        let input = ''
        stdin.on('data', chunk => input += chunk)
        stdin.on('end', () => callback(null, input, ''))
        return
      }
      const application = args.at(-1)!.replace('/Contents/Info.plist', '')
      const code = fixture.codes.get(application)
      if (!code || code.invalid) {
        callback(new Error('Untrusted tool failure that must never escape'), '', 'sensitive diagnostic')
        return
      }
      if (command === '/usr/bin/plutil') {
        callback(null, JSON.stringify(code.plist), '')
      }
      else if (command === '/usr/bin/codesign') {
        if (args.includes('--verify'))
          callback(null, '', '')
        else if (args.includes('--entitlements'))
          callback(null, code.entitlements === undefined ? '' : JSON.stringify(code.entitlements), '')
        else
          callback(null, '', `Identifier=${code.identifier}\nTeamIdentifier=${code.team}\nCodeDirectory v=20500 size=123 flags=0x${code.flags}(runtime) hashes=1+1 location=embedded\nCDHash=${'a'.repeat(40)}\n`)
      }
      else {
        callback(new Error('A selected app must never execute during preflight'), '', '')
      }
    })
    return { stdin }
  }),
}))

beforeEach(() => {
  fixture.calls.length = 0
  fixture.codes.clear()
  const native = 'dev.craft-hub.macos-prototype'
  fixture.codes.set(fixture.source, {
    identifier: 'org.example.craft-hub',
    team: 'ABCDE12345',
    flags: '10000',
    plist: {
      CFBundleIdentifier: 'org.example.craft-hub',
      CFBundleExecutable: 'Source',
      CraftHubProfileMigrationGuardVersion: 1,
      CraftHubIdentityRecipientBundleIdentifier: native,
      CraftHubIdentityHostSecurityVersion: 1,
      CraftHubIdentityTransferVersion: 1,
      CraftHubIdentityTransferCapabilities: ['preview', 'coordinated-transfer'],
    },
  })
  fixture.codes.set(fixture.recipient, {
    identifier: native,
    team: 'ABCDE12345',
    flags: '10000',
    plist: { CFBundleIdentifier: native, CFBundleExecutable: 'Native', CraftHubProfileMigrationGuardVersion: 1, CraftHubIdentityRecipientVersion: 1, CraftHubIdentitySourceBundleIdentifier: 'org.example.craft-hub' },
  })
})

it('requires strict declarative maintenance input and never accepts recipient keys or argv', () => {
  expect(identitySourceRequest({ version: 1, action: 'preview' })).toEqual({ version: 1, action: 'preview' })
  expect(identitySourceRequest({ version: 1, action: 'recipient-preflight', application: fixture.recipient }).action).toBe('recipient-preflight')
  expect(identitySourceRequest({ version: 1, action: 'migrate', application: fixture.recipient, targetProfile: '/private/tmp/native-profile' })).toEqual({ version: 1, action: 'migrate', application: fixture.recipient, targetProfile: '/private/tmp/native-profile' })
  for (const action of ['recover', 'rollback'])
    expect(identitySourceRequest({ version: 1, action, application: fixture.recipient, transaction: '/private/tmp/transaction' }).action).toBe(action)
  for (const extra of [{ approved: true }, { sourceData: '/different' }, { recipientKey: 'caller-key' }, { args: ['--other'] }])
    expect(() => identitySourceRequest({ version: 1, action: 'migrate', application: fixture.recipient, targetProfile: '/private/tmp/native-profile', ...extra })).toThrow('not ready')
  for (const input of [null, [], { version: 1, action: 'seal', request: {} }, { version: 1, action: 'preview', recipientKey: 'caller-key' }, { version: 1, action: 'recipient-preflight', application: 'relative.app' }, { version: 1, action: 'recipient-preflight', application: fixture.recipient, args: ['--inspect'] }, { version: true, action: 'preview' }, { version: 1, action: 'recipient-preflight', application: '/tmp/\nUntrusted.app' }])
    expect(() => identitySourceRequest(input)).toThrow('not ready')
})

it('rejects requirement grammar injection and noncanonical identifiers', () => {
  expect(identityTransferRequirement('org.example.craft-hub', 'ABCDE12345')).toContain('anchor apple generic')
  for (const id of ['', 'org.example" or true', 'org.example\n', '-org.example', 'x'.repeat(256)])
    expect(() => identityTransferRequirement(id, 'ABCDE12345')).toThrow('not ready')
  for (const team of ['', 'abcde12345', 'ABCDE12345" or true', 'ABCDE12345\n'])
    expect(() => identityTransferRequirement('org.example.craft-hub', team)).toThrow('not ready')
})

it.runIf(process.platform === 'darwin')('verifies both sealed releases with fixed tools, same team and no application launch', async () => {
  fixture.codes.get(fixture.source)!.entitlements = { 'com.apple.security.cs.allow-jit': true, 'com.apple.security.cs.disable-library-validation': false }
  await expect(inspectIdentityRecipient(fixture.recipient)).resolves.toMatchObject({ application: fixture.recipient, sourceApplication: fixture.source, team: 'ABCDE12345', executable: `${fixture.recipient}/Contents/MacOS/Native` })
  const validations = fixture.calls.filter(call => call.args.includes('--verify'))
  expect(validations).toHaveLength(2)
  expect(validations.every(call => call.args.includes('--deep') && call.args.includes('--strict') && call.args.includes('--all-architectures'))).toBe(true)
  expect(validations[1]!.args).toContain(identityTransferRequirement('dev.craft-hub.macos-prototype', 'ABCDE12345'))
  expect(fixture.calls.every(call => ['/usr/bin/codesign', '/usr/bin/plutil'].includes(call.command))).toBe(true)
  expect(fixture.calls.every(call => (call.options as { env: unknown }).env && !Object.hasOwn((call.options as { env: object }).env, 'NODE_OPTIONS'))).toBe(true)
})

it.runIf(process.platform === 'darwin')('blocks older source contracts before inspecting the selected recipient', async () => {
  const code = fixture.codes.get(fixture.source)!
  code.plist.CraftHubIdentityTransferCapabilities = ['preview', 'recipient-preflight']
  await expect(inspectIdentityRecipient(fixture.recipient)).rejects.toThrow('not ready')
  expect(fixture.calls.some(call => call.args.includes(fixture.recipient))).toBe(false)
})

it.runIf(process.platform === 'darwin')('rejects a different signer, identity or ad hoc flags even with matching capability claims', async () => {
  const code = fixture.codes.get(fixture.recipient)!
  for (const fields of [{ team: 'OTHER12345' }, { identifier: 'org.example.other' }, { flags: '10002' }, { flags: '0' }]) {
    const before = { ...code }
    Object.assign(code, fields)
    await expect(inspectIdentityRecipient(fixture.recipient)).rejects.toThrow('not ready')
    Object.assign(code, before)
  }
})

it.runIf(process.platform === 'darwin')('rejects unsealed, inconsistent and legacy application metadata', async () => {
  const code = fixture.codes.get(fixture.recipient)!
  for (const patch of [
    { CFBundleExecutable: '../other' },
    { CFBundleIdentifier: 'org.example.other' },
    { CraftHubProfileMigrationGuardVersion: true },
    { CraftHubIdentityRecipientVersion: 2 },
    { CraftHubIdentitySourceBundleIdentifier: 'org.example.other' },
  ]) {
    const before = code.plist
    code.plist = { ...before, ...patch }
    await expect(inspectIdentityRecipient(fixture.recipient)).rejects.toThrow('not ready')
    code.plist = before
  }
  code.invalid = true
  await expect(inspectIdentityRecipient(fixture.recipient)).rejects.toThrow(new Error('The applications are not ready for authenticated identity transfer'))
})

it.runIf(process.platform === 'darwin')('rejects injection entitlements and malformed entitlement dictionaries', async () => {
  for (const application of [fixture.source, fixture.recipient]) {
    const code = fixture.codes.get(application)!
    for (const key of ['com.apple.security.get-task-allow', 'com.apple.security.cs.allow-dyld-environment-variables', 'com.apple.security.cs.disable-library-validation', 'com.apple.security.cs.allow-unsigned-executable-memory', 'com.apple.security.cs.disable-executable-page-protection']) {
      for (const value of [true, 'false', 0, null]) {
        code.entitlements = { [key]: value }
        await expect(inspectIdentityRecipient(fixture.recipient)).rejects.toThrow('not ready')
      }
    }
    for (const value of [true, null, []]) {
      code.entitlements = value
      await expect(inspectIdentityRecipient(fixture.recipient)).rejects.toThrow('not ready')
    }
    code.entitlements = undefined
  }
})

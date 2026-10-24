import type { IdentityMigrationCommand } from './identity-migration.ts'
import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import process from 'node:process'

const recipientIdentifier = 'dev.craft-hub.macos-prototype'
const rejected = (): Error => new Error('The applications are not ready for authenticated identity transfer')

/** Public metadata only. A preflight result is not an authorization token and never accepts a recipient key. */
export interface IdentityRecipientPreflight {
  application: string
  executable: string
  sourceApplication: string
  team: string
  sourceCodeHash: string
  recipientCodeHash: string
}

/** Maintenance input stays declarative. Neither a caller-selected key nor arbitrary recipient arguments are accepted. */
export function identitySourceRequest(value: unknown): { version: 1, action: 'preview' } | { version: 1, action: 'recipient-preflight', application: string } | IdentityMigrationCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw rejected()
  const input = value as Record<string, unknown>
  if (input.version === 1 && input.action === 'preview' && Object.keys(input).sort().join(',') === 'action,version')
    return { version: 1, action: 'preview' }
  if (input.version === 1 && input.action === 'recipient-preflight' && Object.keys(input).sort().join(',') === 'action,application,version'
    && typeof input.application === 'string' && input.application.length <= 4096
    && isAbsolute(input.application) && input.application.endsWith('.app') && !/[\r\n\0]/.test(input.application)) {
    return { version: 1, action: 'recipient-preflight', application: input.application }
  }
  if (input.version === 1 && ['migrate', 'recover', 'rollback'].includes(String(input.action))
    && typeof input.application === 'string' && input.application.length <= 4096
    && isAbsolute(input.application) && input.application.endsWith('.app') && !/[\r\n\0]/.test(input.application)) {
    const key = input.action === 'migrate' ? 'targetProfile' : 'transaction'
    const path = input[key]
    if (Object.keys(input).sort().join(',') !== ['action', 'application', key, 'version'].sort().join(',')
      || typeof path !== 'string' || path.length > 4096 || !isAbsolute(path) || /[\r\n\0]/.test(path)) {
      throw rejected()
    }
    if (input.action === 'migrate')
      return { version: 1, action: 'migrate', application: input.application, targetProfile: path }
    if (input.action === 'recover' || input.action === 'rollback')
      return { version: 1, action: input.action, application: input.application, transaction: path }
  }
  throw rejected()
}

function run(command: string, args: string[]): Promise<{ stdout: string, stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024, env: { PATH: '/usr/bin:/bin', LANG: 'C' } }, (error, stdout, stderr) => {
      if (error)
        reject(rejected())
      else
        resolve({ stdout, stderr })
    })
  })
}

/** Strict literals for Apple's requirement grammar; source and recipient must use Developer ID Application. */
export function identityTransferRequirement(identifier: string, team: string): string {
  if (identifier.length > 255 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/i.test(identifier) || !/^[A-Z0-9]{10}$/.test(team)
    || /[\r\n]/.test(identifier + team)) {
    throw rejected()
  }
  return `anchor apple generic and identifier "${identifier}" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${team}"`
}

function field(text: string, name: string): string {
  const values = text.split('\n').filter(line => line.startsWith(`${name}=`)).map(line => line.slice(name.length + 1))
  if (values.length !== 1 || !values[0])
    throw rejected()
  return values[0]
}

async function signedApplication(application: string, expected?: { identifier: string, team: string }): Promise<{
  identifier: string
  team: string
  codeHash: string
  plist: Record<string, unknown>
  executable: string
}> {
  if (!isAbsolute(application) || !application.endsWith('.app') || /[\r\n\0]/.test(application)
    || await realpath(application) !== application) {
    throw rejected()
  }
  const displayed = await run('/usr/bin/codesign', ['--display', '--verbose=4', application])
  const identifier = field(displayed.stderr, 'Identifier')
  const team = field(displayed.stderr, 'TeamIdentifier')
  const codeHash = field(displayed.stderr, 'CDHash')
  if (!/^[a-f0-9]{40,64}$/.test(codeHash) || (expected && (identifier !== expected.identifier || team !== expected.team)))
    throw rejected()
  // Display output is untrusted until this succeeds. In particular, copied/ad hoc app identifiers prove nothing.
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', '-R', identityTransferRequirement(identifier, team), application])
  const flags = [...displayed.stderr.matchAll(/^CodeDirectory .* flags=0x([a-f0-9]+)(?:\(|\s|$)/gm)]
  if (flags.length !== 1)
    throw rejected()
  const value = Number.parseInt(flags[0]![1]!, 16)
  if ((value & 0x10000) === 0 || (value & 0x2) !== 0)
    throw rejected()
  const plist = JSON.parse((await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(application, 'Contents/Info.plist')])).stdout) as Record<string, unknown>
  if (plist.CFBundleIdentifier !== identifier || plist.CraftHubProfileMigrationGuardVersion !== 1
    || typeof plist.CFBundleExecutable !== 'string' || !plist.CFBundleExecutable || basename(plist.CFBundleExecutable) !== plist.CFBundleExecutable
    || ['.', '..'].includes(plist.CFBundleExecutable) || /[\r\n\0]/.test(plist.CFBundleExecutable)) {
    throw rejected()
  }
  const executable = join(application, 'Contents/MacOS', plist.CFBundleExecutable)
  if (await realpath(executable) !== executable)
    throw rejected()
  // Require the absence of injection exceptions in the sealed entitlement blob, not a file selected by a caller.
  const entitlements = await run('/usr/bin/codesign', ['--display', '--entitlements', ':-', '--xml', application])
  if (entitlements.stdout.trim()) {
    // plutil parses the actual signed XML through stdin; no temporary entitlement file is created.
    const parsed = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const child = execFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024, env: { PATH: '/usr/bin:/bin', LANG: 'C' } }, (error, stdout) => {
        try {
          if (error)
            throw rejected()
          const value: unknown = JSON.parse(stdout)
          if (!value || typeof value !== 'object' || Array.isArray(value))
            throw rejected()
          resolve(value as Record<string, unknown>)
        }
        catch { reject(rejected()) }
      })
      child.stdin?.on('error', () => {})
      child.stdin?.end(entitlements.stdout)
    })
    for (const key of ['com.apple.security.get-task-allow', 'com.apple.security.cs.allow-dyld-environment-variables', 'com.apple.security.cs.disable-library-validation', 'com.apple.security.cs.allow-unsigned-executable-memory', 'com.apple.security.cs.disable-executable-page-protection']) {
      if (parsed[key] !== undefined && parsed[key] !== false)
        throw rejected()
    }
  }
  return { identifier, team, codeHash, plist, executable }
}

/**
 * Read-only source-side preflight. It never executes the selected app, touches safeStorage, or acquires a profile lease.
 * The future source-owned launcher must repeat this immediately before spawn; the native process must independently
 * authenticate its running parent through Security before any Keychain operation. This result is not reusable proof.
 */
export async function inspectIdentityRecipient(application: string): Promise<IdentityRecipientPreflight> {
  try {
    if (process.platform !== 'darwin')
      throw rejected()
    const ownExecutable = await realpath(process.execPath)
    if (basename(dirname(ownExecutable)) !== 'MacOS' || basename(dirname(dirname(ownExecutable))) !== 'Contents')
      throw rejected()
    const sourceApplication = dirname(dirname(dirname(ownExecutable)))
    const source = await signedApplication(sourceApplication)
    if (source.executable !== ownExecutable || source.identifier === recipientIdentifier
      || source.plist.CraftHubIdentityHostSecurityVersion !== 1 || source.plist.CraftHubIdentityTransferVersion !== 1
      || source.plist.CraftHubIdentityRecipientBundleIdentifier !== recipientIdentifier
      || !Array.isArray(source.plist.CraftHubIdentityTransferCapabilities)
      || !source.plist.CraftHubIdentityTransferCapabilities.includes('coordinated-transfer')) {
      throw rejected()
    }
    const recipient = await signedApplication(application, { identifier: recipientIdentifier, team: source.team })
    if (recipient.plist.CraftHubIdentityRecipientVersion !== 1
      || recipient.plist.CraftHubIdentitySourceBundleIdentifier !== source.identifier) {
      throw rejected()
    }
    return { application, executable: recipient.executable, sourceApplication, team: source.team, sourceCodeHash: source.codeHash, recipientCodeHash: recipient.codeHash }
  }
  catch { throw rejected() }
}

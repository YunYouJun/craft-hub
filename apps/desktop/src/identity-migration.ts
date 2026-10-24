import type { IdentityTransferReview } from '@craft-hub/personal-cloud'
import type { ProfileIdentityParticipant, ProfileMigrationPreview, ProfileMigrationReceipt } from 'craft-hub'
import type { DeviceVault } from './device-vault.ts'
import type { IdentityRecipientClient } from './identity-recipient-client.ts'
import type { IdentityRecipientPreflight } from './identity-transfer-recipient.ts'
import { IdentityTransferError, personalCloudOrigin } from '@craft-hub/personal-cloud'
import { applyIdentityProfileMigration, canonicalProfilePath, encryptedIdentityBlocker, previewIdentityProfileRecovery, previewProfileMigration, ProfileIdentityRecoveryError, recoverIdentityProfileMigration, rollbackIdentityProfileMigration } from 'craft-hub'
import { openIdentityRecipient } from './identity-recipient-client.ts'
import { inspectIdentityRecipient } from './identity-transfer-recipient.ts'

/** Declarative navigation only. Approval, source roots and recipient keys cannot be supplied by maintenance input. */
export type IdentityMigrationCommand = { version: 1, action: 'migrate', application: string, targetProfile: string }
  | { version: 1, action: 'recover' | 'rollback', application: string, transaction: string }
type Recovery = Awaited<ReturnType<typeof previewIdentityProfileRecovery>>
/** Public review metadata, without encrypted envelopes, temporary recipient keys or private identity material. */
export type IdentityMigrationReview = { kind: 'migrate', peer: IdentityRecipientPreflight, profile: ProfileMigrationPreview, identity: IdentityTransferReview, endpoint: string, webOrigin: string }
  | { kind: 'recover' | 'rollback', peer: IdentityRecipientPreflight, recovery: Recovery }
/** The recovery location survives uncertain acknowledgements; cancellation never implies a rollback decision. */
export type IdentityMigrationResult = { status: 'cancelled' }
  | { status: 'complete', receipt: ProfileMigrationReceipt }
  | { status: 'recovery-required', transaction: string }
/** Trusted source-host dependencies. The native transport and signing policy are deliberately not injectable here. */
export interface IdentityMigrationOptions {
  vault: DeviceVault
  sourceData: string
  sourceConfig: string
  endpoint: string
  webOrigin: string
  confirm: (review: IdentityMigrationReview) => Promise<boolean>
  signal?: AbortSignal
}

function sameIdentity(left: IdentityTransferReview, right: IdentityTransferReview): boolean {
  return left.sourceData === right.sourceData && left.sourceRevision === right.sourceRevision
    && left.publicKey === right.publicKey && left.deviceId === right.deviceId
}

/** Coordinate one reviewed native transfer/recovery through the shared journal and the source-owned recipient. */
export async function coordinateIdentityMigration(command: IdentityMigrationCommand, options: IdentityMigrationOptions): Promise<IdentityMigrationResult> {
  let recipient: IdentityRecipientClient | undefined
  const check = (): void => {
    if (options.signal?.aborted)
      throw new IdentityTransferError()
  }
  try {
    check()
    const peer = await inspectIdentityRecipient(command.application)
    const sourceData = await canonicalProfilePath(options.sourceData)
    const sourceConfig = await canonicalProfilePath(options.sourceConfig)
    const endpoint = personalCloudOrigin(options.endpoint)
    const webOrigin = personalCloudOrigin(options.webOrigin)
    const confirm = async (review: IdentityMigrationReview): Promise<boolean> => {
      check()
      const accepted = await options.confirm(structuredClone(review))
      check()
      return accepted === true
    }
    if (command.action === 'migrate') {
      const profile = await previewProfileMigration({ sourceData, sourceConfig, target: command.targetProfile })
      if (profile.blockers.length !== 1 || profile.blockers[0] !== encryptedIdentityBlocker)
        throw new IdentityTransferError()
      const identity = await options.vault.previewTransfer()
      if (!identity || identity.sourceData !== sourceData)
        throw new IdentityTransferError()
      if (!await confirm({ kind: 'migrate', peer, profile, identity, endpoint, webOrigin }))
        return { status: 'cancelled' }
      // Generate the short-lived recipient key only after the user finishes reviewing. The native launcher
      // pins both reviewed code hashes, so an app replacement during the dialog invalidates this approval.
      recipient = await openIdentityRecipient(peer, options.signal)
      recipient.assertHostsStopped()
      const request = await recipient.prepare(profile.paths, endpoint, webOrigin)
      if (!sameIdentity(identity, request))
        throw new IdentityTransferError()
      const binding = {
        id: request.challenge,
        sourceRevision: request.sourceRevision,
        publicKey: request.publicKey,
        ...(request.deviceId === undefined ? {} : { deviceId: request.deviceId }),
        endpoint,
        webOrigin,
      }
      const client = recipient
      let sealed = false
      const participant: ProfileIdentityParticipant = {
        inspect: context => client.inspect(context),
        stage: async (context) => {
          check()
          client.assertHostsStopped()
          if (sealed)
            throw new IdentityTransferError()
          sealed = true
          // applyIdentityProfileMigration owns all exclusive leases and durable guards before this callback.
          // Do not call the older standalone seal adapter: it would try to acquire the same leases again.
          const envelope = await options.vault.sealTransfer(request, { endpoint, webOrigin })
          check()
          await client.stage(context, envelope)
        },
        activate: context => client.activate(context),
        finish: context => client.finish(context),
        rollback: context => client.rollback(context),
      }
      return { status: 'complete', receipt: await applyIdentityProfileMigration(profile.paths, profile.revision, binding, participant, async () => {
        check()
        client.assertHostsStopped()
      }) }
    }
    const recovery = await previewIdentityProfileRecovery(command.transaction)
    if (recovery.paths.sourceData !== sourceData || recovery.paths.sourceConfig !== sourceConfig
      || recovery.identity.endpoint !== endpoint || recovery.identity.webOrigin !== webOrigin) {
      throw new IdentityTransferError()
    }
    if (!await confirm({ kind: command.action, peer, recovery }))
      return { status: 'cancelled' }
    // A changed journal or candidate invalidates recovery approval, including a different durable decision.
    const current = await previewIdentityProfileRecovery(command.transaction)
    if (current.reviewRevision !== recovery.reviewRevision)
      throw new IdentityTransferError()
    recipient = await openIdentityRecipient(peer, options.signal)
    recipient.assertHostsStopped()
    const { transaction, paths, identity } = recovery
    await recipient.resume({ transaction, paths, identity })
    const client = recipient
    const participant: ProfileIdentityParticipant = {
      inspect: context => client.inspect(context),
      stage: async () => { throw new IdentityTransferError() },
      activate: context => client.activate(context),
      finish: context => client.finish(context),
      rollback: context => client.rollback(context),
    }
    const stopped = async (): Promise<void> => {
      check()
      client.assertHostsStopped()
    }
    const receipt = command.action === 'rollback'
      ? await rollbackIdentityProfileMigration(transaction, recovery.revision, participant, stopped, recovery.reviewRevision)
      : await recoverIdentityProfileMigration(transaction, participant, stopped, recovery.reviewRevision)
    return { status: 'complete', receipt }
  }
  catch (error) {
    if (error instanceof ProfileIdentityRecoveryError)
      return { status: 'recovery-required', transaction: error.transaction }
    throw new IdentityTransferError()
  }
  finally { recipient?.close() }
}

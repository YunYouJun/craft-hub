import { flipFuses, FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses'

const fuses = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
}

/** Flip only the authentication-critical fuses before signing; leave unrelated cookie and web behavior unchanged. */
export async function hardenDesktopFuses(application: string): Promise<void> {
  await flipFuses(application, { version: FuseVersion.V1, ...fuses })
  await verifyDesktopFuses(application)
}

/** Check actual binary bits again after packaging, rather than trusting a plist promise or build configuration. */
export async function verifyDesktopFuses(application: string): Promise<void> {
  const actual = await getCurrentFuseWire(application)
  if (actual.version !== FuseVersion.V1 || Object.entries(fuses).some(([key, enabled]) => actual[Number(key) as FuseV1Options] !== (enabled ? FuseState.ENABLE : FuseState.DISABLE)))
    throw new Error('Packaged Electron authentication fuses do not match the release policy')
}

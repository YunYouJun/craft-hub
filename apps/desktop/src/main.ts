/* eslint-disable antfu/no-top-level-await -- Electron must finish profile-path setup before its ready event. */
import process from 'node:process'

// Select maintenance mode before importing runtime, account, plugin, window or single-instance startup code.
try {
  const { selectDesktopHostMode } = await import('./native-migration-entry.ts')
  const mode = await selectDesktopHostMode(process.argv)
  if (mode.kind === 'identity-transfer') {
    const { prepareIdentityTransferHost } = await import('./identity-transfer-host.ts')
    const run = await prepareIdentityTransferHost()
    void run()
  }
  else if (mode.kind === 'migration') {
    const { prepareNativeMigrationHost } = await import('./native-migration-host.ts')
    const run = await prepareNativeMigrationHost(mode.gate)
    void run()
  }
  else {
    await import('./desktop-main.ts')
  }
}
catch {
  process.stderr.write('Craft Hub failed to load its requested host mode\n')
  process.exitCode = 1
  process.exit(1)
}

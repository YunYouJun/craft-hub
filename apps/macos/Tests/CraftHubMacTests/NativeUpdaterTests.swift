import Testing

@testable import CraftHubMac

@MainActor @Test func unconfiguredUpdaterStaysDisabledAcrossStartsAndManualChecks() {
  let updater = NativeUpdater(info: [:])
  updater.start()
  updater.start()
  updater.checkForUpdates()
  updater.setAutomaticChecks(true)
  #expect(!updater.isAvailable)
  #expect(!updater.canCheckForUpdates)
  #expect(!updater.automaticallyChecks)
  #expect(updater.unavailableReason != nil)
}

import Foundation
import Testing

@testable import CraftHubMacCore

private func releaseInfo() -> [String: Any] {
  [
    "CraftHubUpdatesEnabled": true, "SUFeedURL": "https://updates.example.com/native/arm64/appcast.xml",
    "SUPublicEDKey": Data(repeating: 1, count: 32).base64EncodedString(),
    "SUVerifyUpdateBeforeExtraction": true, "SURequireSignedFeed": true,
  ]
}

@Test func localBuildsCannotStartUpdatesFromStaleReleaseSettings() throws {
  #expect(try NativeUpdateConfiguration(info: [:]) == nil)
  var info = releaseInfo()
  info["CraftHubUpdatesEnabled"] = false
  #expect(try NativeUpdateConfiguration(info: info) == nil)
  #expect(try NativeUpdateConfiguration(info: releaseInfo())?.feedURL.host == "updates.example.com")
}

@Test(arguments: [
  "http://updates.example.com/appcast.xml", "file:///tmp/appcast.xml", "https://user:secret@example.com/feed",
  "https://example.com/feed#fragment", "https://example.com/\nfeed",
])
func nativeUpdatesRejectUnsafeFeeds(_ feed: String) {
  var info = releaseInfo()
  info["SUFeedURL"] = feed
  #expect(throws: NativeUpdateConfiguration.ConfigurationError.self) { try NativeUpdateConfiguration(info: info) }
}

@Test(arguments: ["SUPublicEDKey", "SUFeedURL", "SUVerifyUpdateBeforeExtraction", "SURequireSignedFeed"])
func releaseUpdatesRequireAllTrustInputs(_ key: String) {
  var info = releaseInfo()
  info.removeValue(forKey: key)
  #expect(throws: NativeUpdateConfiguration.ConfigurationError.self) { try NativeUpdateConfiguration(info: info) }
}

@Test func nativeUpdatesRejectInvalidPublicKeys() {
  for key in ["", "not a key", Data(repeating: 1, count: 31).base64EncodedString()] {
    var info = releaseInfo()
    info["SUPublicEDKey"] = key
    #expect(throws: NativeUpdateConfiguration.ConfigurationError.self) { try NativeUpdateConfiguration(info: info) }
  }
}

@MainActor @Test func cancellingABusyUpdateQuitLeavesTheRuntimeRunning() async {
  var stopped = false
  let accepted = await NativeTermination.prepare(
    requireIdle: { throw CocoaError(.userCancelled) },
    confirmInterruption: { _ in false }, shutdown: { stopped = true })
  #expect(!accepted)
  #expect(!stopped)
}

@MainActor @Test func updateQuitWaitsForRuntimeDrainBeforeApprovingRelaunch() async {
  var events: [String] = []
  let accepted = await NativeTermination.prepare(
    requireIdle: { events.append("idle") },
    confirmInterruption: { _ in
      Issue.record("Idle quit must not prompt")
      return false
    },
    shutdown: {
      events.append("stopping")
      await Task.yield()
      events.append("stopped")
    })
  if accepted { events.append("relaunch") }
  #expect(events == ["idle", "stopping", "stopped", "relaunch"])
}

@MainActor @Test func explicitQuitCanProceedWhenRuntimeStatusIsUnavailable() async {
  var stopped = false
  let accepted = await NativeTermination.prepare(
    requireIdle: { throw URLError(.timedOut) },
    confirmInterruption: { _ in true }, shutdown: { stopped = true })
  #expect(accepted && stopped)
}

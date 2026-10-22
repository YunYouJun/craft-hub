import Foundation
import Testing
import CraftHubMacCore
@testable import CraftHubMac

@MainActor
@Test func lateWebRoutesCannotStealANativeSelection() {
  let suite = "craft-hub-navigation-test-\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = WorkbenchModel(defaults: defaults)
  model.routeChanged("/overview")
  model.selection = .environment
  model.select(.environment)
  model.routeChanged("/software")
  #expect(model.selection == .environment)
  #expect(model.presentsNativeContent)
  model.run("palette")
  model.routeChanged("/tools")
  #expect(model.selection == .environment)
  model.showWebWorkbench()
  model.routeChanged("/tools")
  #expect(model.selection == .tools)
}

@MainActor
@Test func recoveryReturnsFromWebFallbackToTheSavedNativePage() throws {
  let suite = "craft-hub-recovery-test-\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = WorkbenchModel(defaults: defaults)
  model.routeChanged("/overview")
  model.selection = .software
  model.select(.software)
  model.showWebWorkbench()
  #expect(!model.presentsNativeContent)
  let secret = String(repeating: "a", count: 64)
  let data = try JSONSerialization.data(withJSONObject: [
    "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)",
    "nativeApiToken": String(repeating: "b", count: 64),
  ])
  model.connect(try RuntimeConnection(handshake: data))
  model.routeChanged("/overview")
  #expect(model.selection == .software)
  #expect(model.presentsNativeContent)
  #expect(model.machine != nil)
  model.showWebWorkbench()
  model.select(.software)
  #expect(model.presentsNativeContent)
}

@MainActor @Test func recreatedWindowsReuseTheEphemeralSessionUntilTheRuntimeChanges() throws {
  let model = WorkbenchModel()
  let original = model.webSessionDataStore()
  model.webWillLoad()
  #expect(model.webSessionDataStore() === original)
  #expect(!original.isPersistent)
  let secret = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(handshake: JSONSerialization.data(withJSONObject: [
    "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)", "nativeApiToken": secret,
  ]))
  model.connect(connection)
  #expect(model.webSessionDataStore() !== original)
}

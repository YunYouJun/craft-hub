import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private func preferencesConnection() throws -> RuntimeConnection {
  let secret = String(repeating: "a", count: 64)
  return try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)",
      "nativeApiToken": secret,
    ]))
}

private actor PreferenceGate {
  var pending: CheckedContinuation<Void, Never>?
  var requests = 0
  var finished = false
  func receive(_ request: URLRequest) async -> (Data, URLResponse) {
    requests += 1
    await withCheckedContinuation { pending = $0 }
    finished = true
    return (
      Data(#"{"settings":{"workbench.theme":"dark","workbench.locale":"zh-CN"}}"#.utf8),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
  func release() {
    pending?.resume()
    pending = nil
  }
}

@MainActor @Test func nativePreferencesCacheDisplayStateAndMirrorTheRuntimeSnapshot() async throws {
  let suite = "craft-hub-test-\(UUID())"
  let defaults = try #require(UserDefaults(suiteName: suite))
  defer { defaults.removePersistentDomain(forName: suite) }
  defaults.set("light", forKey: "nativeTheme")
  defaults.set("en", forKey: "nativeLanguage")
  var appearances: [RuntimePreferences.Theme] = []
  let preferences = NativePreferences(defaults: defaults, applyAppearance: { appearances.append($0) })
  preferences.start()
  #expect(preferences.theme == .light && preferences.language == .english)
  let client = RuntimeAPIClient(connection: try preferencesConnection()) { request in
    #expect(request.url?.path == "/api/settings")
    #expect(request.httpMethod == "GET")
    #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
    return (
      Data(#"{"settings":{"workbench.theme":"dark","workbench.locale":"zh-CN","ignored":"value"}}"#.utf8),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
  preferences.refresh(client)
  for _ in 0..<100 {
    if preferences.theme == .dark { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(preferences.theme == .dark && preferences.language == .chinese)
  #expect(defaults.string(forKey: "nativeTheme") == "dark")
  #expect(defaults.string(forKey: "nativeLanguage") == "zh-CN")
  preferences.setTheme(.system)
  preferences.setLanguage(.english)
  #expect(appearances == [.light, .dark, .system, .system])
  preferences.refresh(nil)
}

@MainActor @Test func oldSettingsRequestsCannotOverwriteANewerBridgePreferenceOrDisconnectedSession() async throws {
  let suite = "craft-hub-test-\(UUID())"
  let defaults = try #require(UserDefaults(suiteName: suite))
  defer { defaults.removePersistentDomain(forName: suite) }
  let preferences = NativePreferences(defaults: defaults, applyAppearance: { _ in })
  for disconnect in [false, true] {
    let gate = PreferenceGate()
    preferences.setTheme(.light)
    preferences.setLanguage(.english)
    preferences.refresh(
      RuntimeAPIClient(connection: try preferencesConnection(), transport: { await gate.receive($0) }))
    for _ in 0..<100 {
      if await gate.requests > 0 { break }
      try await Task.sleep(for: .milliseconds(5))
    }
    if disconnect { preferences.refresh(nil) } else { preferences.setTheme(.system) }
    await gate.release()
    for _ in 0..<100 {
      if await gate.finished { break }
      try await Task.sleep(for: .milliseconds(5))
    }
    await Task.yield()
    #expect(preferences.theme == (disconnect ? .light : .system))
    #expect(preferences.language == .english)
  }
}

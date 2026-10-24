import CraftHubMacCore
import Foundation
import SwiftUI
import Testing

@testable import CraftHubMac

@Test func nativeMenuShortcutsMatchTheWebRecorderContract() throws {
  struct Fixture: Decodable {
    let shortcut: String
    let nativeScalar: UInt32
    let modifiers: [String]
  }
  var root = URL(fileURLWithPath: #filePath)
  for _ in 0..<5 { root.deleteLastPathComponent() }
  let data = try Data(contentsOf: root.appendingPathComponent("apps/desktop/test/fixtures/shortcut-contract.json"))
  for fixture in try JSONDecoder().decode([Fixture].self, from: data) {
    let shortcut = try #require(NativeShortcut.parse(fixture.shortcut))
    #expect(shortcut.key.character.unicodeScalars.first?.value == fixture.nativeScalar, "\(fixture.shortcut)")
    var modifiers: EventModifiers = []
    for name in fixture.modifiers {
      modifiers.insert(["Mod": .command, "Control": .control, "Alt": .option, "Shift": .shift][name]!)
    }
    #expect(shortcut.modifiers == modifiers)
  }
}

@Test func malformedMenuBindingsCannotBecomeBareTypingOrUnintendedModifiers() {
  for value in [
    "", "A", "Space", "Enter", "ArrowUp", "Mod", "Mod+", "Mod++K", "Mod+Mod+K", "Meta+K",
    "Command+K", "Unknown+K", "Mod+Dead", "F0", "F36", "F01", "Mod+\n", "Mod+ ", "Mod+Click",
    "Mod+" + String(repeating: "x", count: 100),
  ] {
    #expect(NativeShortcut.parse(value) == nil, "\(value)")
  }
  #expect(NativeShortcut.parse("Mod+Shift+K") == NativeShortcut.parse("Shift+Mod+k"))
  #expect(NativeShortcut.capability("capability:project:npm:build")?.capability == "npm:build")
  for id in ["capability:project", "capability::build", "capability:project:", "project:build"] {
    #expect(NativeShortcut.capability(id) == nil)
  }
}

private func shortcutConnection() throws -> RuntimeConnection {
  let secret = String(repeating: "a", count: 64)
  return try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)",
      "nativeApiToken": secret,
    ]))
}

private func shortcutResponse(_ request: URLRequest, _ body: String) -> (Data, URLResponse) {
  #expect(request.httpMethod == "GET")
  return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
}

@MainActor private func settle(_ model: NativeShortcuts) async throws {
  for _ in 0..<200 {
    if !model.isLoading { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(!model.isLoading)
}

@MainActor @Test func nativeCapabilityShortcutsOnlyDiscoverConfiguredProjectsAndNavigateToReview() async throws {
  let suite = "craft-hub-test-\(UUID())"
  let defaults = try #require(UserDefaults(suiteName: suite))
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = NativeShortcuts(defaults: defaults)
  var requests: [String] = []
  var removed = false
  let client = RuntimeAPIClient(connection: try shortcutConnection()) { request in
    let path = request.url!.path
    requests.append(path)
    switch path {
    case "/api/settings":
      return shortcutResponse(
        request,
        #"{"settings":{"workbench.shortcuts":{"workbench.showCommandPalette":"Mod+Shift+J","capability:p:npm:build":"Mod+Alt+B","capability:p:missing":"Mod+Alt+M","capability:p:duplicate1":"Mod+D","capability:p:duplicate2":"Mod+d","capability:p:palette":"Mod+Shift+J","capability:removed:build":"Mod+Alt+U","ignored":"F1"}}}"#
      )
    case "/api/projects":
      return shortcutResponse(
        request,
        removed
          ? #"{"projects":[]}"#
          : #"{"projects":[{"id":"p","name":"Sample","path":"/fixture","trust":"untrusted"},{"id":"unconfigured","name":"Other","path":"/other","trust":"untrusted"}]}"#
      )
    case "/api/projects/p/capability-discovery":
      return shortcutResponse(
        request,
        #"{"capabilities":[{"id":"npm:build","name":"Build","kind":"command"},{"id":"duplicate1","name":"One","kind":"command"},{"id":"duplicate2","name":"Two","kind":"command"},{"id":"palette","name":"Three","kind":"command"}]}"#
      )
    default:
      Issue.record("Unexpected endpoint: \(path)")
      return shortcutResponse(request, "{}")
    }
  }
  var selections: [String] = []
  model.openProject = { project, capability in selections.append("\(project):\(capability)") }
  model.connect(client)
  try await settle(model)
  #expect(model.palette == NativeShortcut.parse("Mod+Shift+J"))
  #expect(model.entries.map(\.id) == ["capability:p:npm:build"])
  #expect(model.entries.first?.title == "Build — Sample")
  #expect(model.perform("capability:p:npm:build"))
  #expect(!model.perform("capability:p:missing"))
  #expect(selections == ["p:npm:build"])
  #expect(requests == ["/api/settings", "/api/projects", "/api/projects/p/capability-discovery"])
  removed = true
  model.refresh()
  #expect(!model.perform("capability:p:npm:build"))
  try await settle(model)
  #expect(model.entries.isEmpty)
  model.connect(nil)
  #expect(!model.perform("capability:p:npm:build"))
  let restored = NativeShortcuts(defaults: defaults)
  #expect(restored.palette == NativeShortcut.parse("Mod+Shift+J"))
  #expect(restored.entries.isEmpty)
}

private actor ShortcutGate {
  private var pending: CheckedContinuation<Void, Never>?
  var requests = 0
  var finished = false
  func receive(_ request: URLRequest, body: String? = nil) async -> (Data, URLResponse) {
    requests += 1
    await withCheckedContinuation { pending = $0 }
    finished = true
    return shortcutResponse(
      request, body ?? #"{"settings":{"workbench.shortcuts":{"workbench.showCommandPalette":"Mod+Z"}}}"#)
  }
  func release() {
    pending?.resume()
    pending = nil
  }
}

@MainActor @Test func lateDiscoveryCannotRestoreDisconnectedCapabilityShortcuts() async throws {
  let suite = "craft-hub-test-\(UUID())"
  let defaults = try #require(UserDefaults(suiteName: suite))
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = NativeShortcuts(defaults: defaults)
  let gate = ShortcutGate()
  model.connect(
    RuntimeAPIClient(connection: try shortcutConnection()) { request in
      switch request.url!.path {
      case "/api/settings":
        return shortcutResponse(request, #"{"settings":{"workbench.shortcuts":{"capability:p:build":"Mod+B"}}}"#)
      case "/api/projects":
        return shortcutResponse(
          request, #"{"projects":[{"id":"p","name":"Sample","path":"/fixture","trust":"untrusted"}]}"#)
      case "/api/projects/p/capability-discovery":
        return await gate.receive(request, body: #"{"capabilities":[{"id":"build","name":"Build","kind":"command"}]}"#)
      default:
        Issue.record("Unexpected endpoint")
        return shortcutResponse(request, "{}")
      }
    })
  for _ in 0..<200 {
    if await gate.requests > 0 { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(await gate.requests == 1)
  model.connect(nil)
  await gate.release()
  for _ in 0..<200 {
    if await gate.finished { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  await Task.yield()
  #expect(model.entries.isEmpty)
  #expect(!model.perform("capability:p:build"))
}

@MainActor @Test func liveShortcutSettingsRestoreDefaultsAndIgnoreOldConnections() async throws {
  let suite = "craft-hub-test-\(UUID())"
  let defaults = try #require(UserDefaults(suiteName: suite))
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = NativeShortcuts(defaults: defaults)
  let gate = ShortcutGate()
  model.connect(RuntimeAPIClient(connection: try shortcutConnection(), transport: { await gate.receive($0) }))
  for _ in 0..<200 {
    if await gate.requests > 0 { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(await gate.requests == 1)
  var settings = #"{"workbench.showCommandPalette":"Mod+Alt+P"}"#
  model.connect(
    RuntimeAPIClient(connection: try shortcutConnection()) { request in
      #expect(request.url?.path == "/api/settings")
      return shortcutResponse(request, "{\"settings\":{\"workbench.shortcuts\":\(settings)}}")
    })
  try await settle(model)
  await gate.release()
  for _ in 0..<200 {
    if await gate.finished { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  await Task.yield()
  #expect(model.palette == NativeShortcut.parse("Mod+Alt+P"))
  settings = #"{"workbench.showCommandPalette":"Unknown+K"}"#
  model.refresh()
  try await settle(model)
  #expect(model.palette == nil)
  #expect(NativeShortcuts(defaults: defaults).palette == nil)
  settings = "{}"
  model.refresh()
  try await settle(model)
  #expect(model.palette == NativeShortcut.parse("Mod+K"))
  model.connect(nil)
}

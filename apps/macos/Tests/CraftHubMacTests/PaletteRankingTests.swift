import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private actor PaletteServer {
  var pins = ["p": ["z", "s", "stale"], "q": ["a"]]
  var failedPins = false
  var blockPins = false
  var waiting: CheckedContinuation<Void, Never>?
  var requests: [String] = []
  var waitingForPins: Bool { waiting != nil }

  func changePins(_ pins: [String: [String]]) { self.pins = pins }
  func failPins() { failedPins = true }
  func block() { blockPins = true }
  func release() {
    waiting?.resume()
    waiting = nil
  }

  func fetch(_ request: URLRequest) async throws -> (Data, URLResponse) {
    #expect(request.httpMethod == "GET")
    let path = request.url!.path
    requests.append(path)
    var body: String
    switch path {
    case "/api/projects":
      body =
        #"{"projects":[{"id":"p","name":"Sample","path":"/fixture","trust":"untrusted"},{"id":"q","name":"Other","path":"/other","trust":"untrusted"}]}"#
    case "/api/projects/p/capability-discovery":
      body =
        #"{"capabilities":[{"id":"a","name":"alpha","kind":"command"},{"id":"b","name":"build","kind":"command"},{"id":"z","name":"zeta","description":"build release","kind":"command"},{"id":"r","name":"rebuild","kind":"command"},{"id":"s","name":"z-skill","kind":"skill"}]}"#
    case "/api/projects/q/capability-discovery":
      body =
        #"{"capabilities":[{"id":"a","name":"alpha","kind":"command"},{"id":"b","name":"build-preview","kind":"command"}]}"#
    case "/api/projects/p/pins", "/api/projects/q/pins":
      let project = path.contains("/p/") ? "p" : "q"
      let snapshot = pins[project] ?? []
      if project == "p", blockPins { await withCheckedContinuation { waiting = $0 } }
      if failedPins { throw URLError(.timedOut) }
      body = String(
        data: try JSONSerialization.data(withJSONObject: ["projectId": project, "capabilityIds": snapshot]),
        encoding: .utf8)!
    case "/api/integrations": body = #"{"integrations":[]}"#
    case "/api/workbenches": body = "[]"
    default:
      Issue.record("Unexpected endpoint: \(path)")
      body = "{}"
    }
    return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
}

private func paletteClient(_ server: PaletteServer) throws -> RuntimeAPIClient {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  return RuntimeAPIClient(connection: connection, transport: { try await server.fetch($0) })
}

@MainActor private func settlePalette(_ model: CommandPaletteModel) async throws {
  for _ in 0..<200 {
    if !model.loading { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(!model.loading)
}

@MainActor @Test func paletteRanksPinsWithinSearchRelevanceAndKeepsProjectAndSkillScopes() async throws {
  let server = PaletteServer()
  let model = CommandPaletteModel()
  model.connect(try paletteClient(server))
  model.opened(mode: .commands)
  try await settlePalette(model)
  #expect(model.results.map(\.id) == ["q:a", "p:z", "p:a", "p:b", "q:b", "p:r"])
  #expect(model.results.filter(\.isPinned).map(\.id) == ["q:a", "p:z"])
  model.query = "build"
  #expect(model.results.map(\.id) == ["p:b", "q:b", "p:r", "p:z"])
  model.query = "Sample:"
  #expect(model.results.map(\.id) == ["p:z", "p:a", "p:b", "p:r"])
  model.category = .skills
  model.query = ""
  #expect(model.results.map(\.id) == ["p:s"])
  #expect(model.results.first?.isPinned == true)
  model.category = .all
  #expect(model.results.prefix(3).allSatisfy { $0.isPinned })
  model.query = "> "
  #expect(!model.results.contains { $0.category == .skills })
  #expect(model.error == nil)
  #expect(await server.requests.filter { $0.hasSuffix("/pins") }.count == 2)
  model.connect(nil)
  #expect(!model.results.contains { $0.isPinned })
}

@MainActor @Test func paletteInvalidationReordersPinsWithoutLosingQueryOrSelectedIdentity() async throws {
  let server = PaletteServer()
  let model = CommandPaletteModel()
  model.connect(try paletteClient(server))
  model.opened(mode: .commands)
  try await settlePalette(model)
  model.query = "Sample:"
  model.selectedID = "p:b"
  await server.changePins(["p": ["a"]])
  model.invalidate()
  try await settlePalette(model)
  #expect(model.query == "Sample:")
  #expect(model.selected?.id == "p:b")
  #expect(model.results.first?.id == "p:a")
  #expect(model.results.filter(\.isPinned).map(\.id) == ["p:a"])
  await server.failPins()
  model.invalidate()
  try await settlePalette(model)
  #expect(model.results.count == 4)
  #expect(!model.results.contains { $0.isPinned })
  #expect(model.error != nil)
  model.connect(nil)
}

@MainActor @Test func cancelledPinReadCannotRestoreAnotherSessionCatalog() async throws {
  let server = PaletteServer()
  await server.block()
  let model = CommandPaletteModel()
  model.connect(try paletteClient(server))
  model.opened(mode: .commands)
  for _ in 0..<200 {
    if await server.waitingForPins { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(await server.waitingForPins)
  model.connect(nil)
  await server.release()
  try await Task.sleep(for: .milliseconds(20))
  #expect(model.catalog.isEmpty)
  #expect(model.results.isEmpty)
}

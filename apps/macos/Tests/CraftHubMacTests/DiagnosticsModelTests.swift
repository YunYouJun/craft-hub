import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private func diagnosticData(state: String) -> Data {
  Data(
    "{\"checkedAt\":\"2026-10-23T00:00:00Z\",\"summary\":{\"errors\":0,\"warnings\":0},\"diagnostics\":[],\"providers\":[{\"id\":\"fixture\",\"title\":\"Fixture\",\"pluginId\":\"fixture\",\"state\":\"\(state)\"}]}"
      .utf8)
}
@Test(arguments: ["empty", "error", "skipped", "future-state"])
func incompleteDiagnosticsNeverShowAnAllClear(state: String) throws {
  let snapshot = try JSONDecoder().decode(DiagnosticSnapshot.self, from: diagnosticData(state: state))
  #expect(!snapshot.reportsComplete && !snapshot.allClear)
}
@Test func completedDiagnosticProvidersCanShowAllClear() throws {
  let snapshot = try JSONDecoder().decode(DiagnosticSnapshot.self, from: diagnosticData(state: "ready"))
  #expect(snapshot.reportsComplete && snapshot.allClear)
}
@MainActor @Test func diagnosticsAreReadOnlyAndRefreshOnPluginInvalidation() async throws {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  var calls: [URLRequest] = []
  let model = DiagnosticsModel()
  model.connect(
    RuntimeAPIClient(connection: connection) { request in
      calls.append(request)
      return (
        diagnosticData(state: "empty"),
        HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
      )
    })
  await model.load()
  await model.load()
  #expect(calls.count == 1)
  model.invalidate([.plugins])
  await model.load()
  #expect(calls.count == 2 && calls.allSatisfy { $0.httpMethod == "GET" && $0.url?.path == "/api/diagnostics" })
  #expect(model.snapshot?.allClear == false)
  model.connect(nil)
  #expect(model.snapshot == nil)
}

@MainActor @Test func failedDiagnosticRefreshRetainsHistoryWithoutClaimingCurrentChecksPassed() async throws {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  var failing = false
  let model = DiagnosticsModel()
  model.connect(
    RuntimeAPIClient(connection: connection) { request in
      if failing { throw URLError(.timedOut) }
      return (
        diagnosticData(state: "ready"),
        HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
      )
    })
  await model.load()
  #expect(model.allClear && !model.stale)
  model.invalidate([.plugins])
  #expect(model.stale && !model.allClear)
  failing = true
  await model.load()
  #expect(model.snapshot?.allClear == true && model.error != nil && model.stale && !model.allClear)
  failing = false
  await model.load()
  #expect(model.allClear && !model.stale && model.error == nil)
  failing = true
  await model.load(force: true)
  #expect(model.stale && !model.allClear)
  model.connect(nil)
  #expect(model.snapshot == nil && !model.allClear)
}

@MainActor @Test func diagnosticProviderSeverityAndTextFiltersComposeAndRemovedProvidersReset() async throws {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  var removed = false
  let model = DiagnosticsModel()
  model.connect(
    RuntimeAPIClient(connection: connection) { request in
      let data =
        removed
        ? diagnosticData(state: "ready")
        : Data(
          #"""
          {"checkedAt":"2026-10-23T00:00:00Z","summary":{"errors":1,"warnings":1},
           "providers":[{"id":"local","title":"Local","pluginId":"fixture","state":"ready"}],
           "diagnostics":[
             {"id":"first","kind":"host-provider","providerId":"local","severity":"error","message":"Invalid config","code":"BAD_CONFIG"},
             {"id":"second","kind":"settings","severity":"warning","message":"Config needs review"}]}
          """#.utf8)
      return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    })
  await model.load()
  model.selectedID = "first"
  model.detailID = "first"
  #expect(model.selected?.id == "first" && model.detail?.id == "first")
  model.query = "  config  "
  #expect(model.filtered.count == 2)
  model.providerID = "local"
  #expect(model.filtered.map(\.id) == ["first"])
  model.severity = "warning"
  #expect(model.filtered.isEmpty && model.hasFilters)
  #expect(model.selectedID == nil && model.detail?.id == "first")
  model.clearFilters()
  #expect(!model.hasFilters && model.filtered.count == 2)
  model.providerID = "local"
  removed = true
  await model.load(force: true)
  #expect(model.providerID == "all" && model.allClear)
  #expect(model.detailID == nil)
}

@MainActor @Test func diagnosticDetailsRefreshInPlaceAndCopiedTextKeepsFailureContext() async throws {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  var message = "Invalid declaration"
  var requests: [URLRequest] = []
  let model = DiagnosticsModel()
  model.connect(
    RuntimeAPIClient(connection: connection) { request in
      requests.append(request)
      let data = try JSONSerialization.data(withJSONObject: [
        "checkedAt": "2026-10-23T00:00:00Z", "summary": ["errors": 1, "warnings": 0],
        "providers": [
          [
            "id": "fixture", "title": "Local validation", "pluginId": "fixture", "state": "error",
            "message": "Could not read config",
          ]
        ],
        "diagnostics": [
          [
            "id": "issue", "kind": "project-config", "severity": "error", "providerId": "fixture", "message": message,
            "path": "/fixture/project.jsonc", "line": 4, "column": 2, "code": "INVALID_CONFIG",
          ]
        ],
      ])
      return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    })
  await model.load()
  model.selectedID = "issue"
  model.detailID = "issue"
  message = "Missing command"
  await model.load(force: true)
  #expect(model.selected?.message == message && model.detail?.message == message)
  model.invalidate([.projects])
  let copied = DiagnosticPresentation.copyText(
    try #require(model.detail), provider: model.snapshot?.providers?.first,
    checkedAt: try #require(model.snapshot?.checkedAt), stale: model.stale)
  #expect(copied.contains("/fixture/project.jsonc:4:2") && copied.contains("INVALID_CONFIG"))
  #expect(copied.contains(message) && copied.contains("Could not read config"))
  #expect(copied.contains("Previous results") && copied.contains("2026-10-23T00:00:00Z"))
  #expect(requests.allSatisfy { $0.httpMethod == "GET" })
  model.connect(nil)
  #expect(model.selectedID == nil && model.detailID == nil)
}

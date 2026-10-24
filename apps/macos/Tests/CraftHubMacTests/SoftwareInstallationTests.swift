import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private let catalogJSON =
  #"{"version":1,"sources":[{"id":"fixture","title":"Fixture","canManage":true,"items":[{"id":"tool","title":{"en":"Tool"},"group":{"id":"dev","title":{"en":"Development"}},"url":"https://example.com/tool","status":"not-detected","canInstall":true}]}]}"#
private func planJSON(prerequisites: Bool = false) -> String {
  """
  {"version":1,"id":"plan-1","sourceId":"fixture","createdAt":"2026-10-23T00:00:00Z","items":[{"softwareId":"tool","title":{"en":"Tool"},"action":"install","installation":{"kind":"brew-cask","packageId":"fixture-tool"}}],"prerequisites":\(prerequisites ? "[\"Install prerequisite\"]" : "[]")}
  """
}
private func runJSON(_ state: String = "queued") -> String {
  """
  {"version":1,"id":"run-1","sourceId":"fixture","planId":"plan-1","createdAt":"2026-10-23T00:00:00Z","updatedAt":"2026-10-23T00:00:00Z","state":"\(state)","items":[{"softwareId":"tool","title":{"en":"Tool"},"state":"queued","log":"literal log $(never execute)"}]}
  """
}
private func connection() throws -> RuntimeConnection {
  let token = String(repeating: "a", count: 64)
  return try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
}
private actor InstallationFixture {
  var requests: [URLRequest] = []
  var history = "[]"
  var prerequisite = false
  var installFails = false
  var historyFails = false
  var holdHistory = false
  var holdPreview = false
  var waiter: CheckedContinuation<Void, Never>?
  func configure(
    history: String? = nil, prerequisite: Bool = false, installFails: Bool = false, historyFails: Bool = false,
    holdHistory: Bool = false, holdPreview: Bool = false
  ) {
    if let history { self.history = history }
    self.prerequisite = prerequisite
    self.installFails = installFails
    self.historyFails = historyFails
    self.holdHistory = holdHistory
    self.holdPreview = holdPreview
  }
  func release() {
    waiter?.resume()
    waiter = nil
    holdHistory = false
    holdPreview = false
  }
  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    let json: String
    switch request.url!.path {
    case "/api/software": json = catalogJSON
    case "/api/software/fixture/plan":
      if holdPreview { await withCheckedContinuation { waiter = $0 } }
      json = planJSON(prerequisites: prerequisite)
    case "/api/software/fixture/install":
      if installFails { throw URLError(.timedOut) }
      json = runJSON()
    case "/api/software/fixture/runs":
      if historyFails { throw URLError(.cannotConnectToHost) }
      json = "{\"version\":1,\"runs\":\(history)}"
      if holdHistory { await withCheckedContinuation { waiter = $0 } }
    case "/api/software/fixture/runs/run-1/cancel": json = runJSON("cancelling")
    default: throw URLError(.badURL)
    }
    return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
}
@MainActor private func model(_ fixture: InstallationFixture) async throws -> SoftwareInstallationModel {
  let client = RuntimeAPIClient(connection: try connection(), transport: { try await fixture.response($0) })
  let model = SoftwareInstallationModel(client: client)
  model.updateSources(try await client.software().sources)
  return model
}
private func waitUntilHeld(_ fixture: InstallationFixture) async throws {
  for _ in 0..<100 {
    if await fixture.waiter != nil { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("Expected the fixture request to be held")
}

@MainActor @Test func softwarePreviewAndCancelNeverInstallAndConfirmationSendsOnlyReviewedPlan() async throws {
  let fixture = InstallationFixture()
  let model = try await model(fixture)
  await model.preview(source: "fixture", ids: ["tool"])
  #expect(model.canConfirm)
  model.dismissPlan()
  await model.confirm()
  #expect(await fixture.requests.filter { $0.url?.path.hasSuffix("/install") == true }.isEmpty)
  await model.preview(source: "fixture", ids: ["tool"])
  await model.confirm()
  let installs = await fixture.requests.filter { $0.url?.path.hasSuffix("/install") == true }
  #expect(installs.count == 1)
  let body = try JSONSerialization.jsonObject(with: installs[0].httpBody!) as! [String: Any]
  #expect(Set(body.keys) == ["planId", "confirmed"])
  #expect(body["planId"] as? String == "plan-1" && body["confirmed"] as? Bool == true)
  #expect(model.plan == nil && model.runs.first?.state == "queued")
  #expect(
    await fixture.requests.allSatisfy {
      !$0.url!.path.contains("trust") && $0.value(forHTTPHeaderField: "Cookie") == nil
    })
}

@MainActor @Test func prerequisitesAndUnsupportedProvidersPreventSoftwareInstallation() async throws {
  let fixture = InstallationFixture()
  await fixture.configure(prerequisite: true)
  let model = try await model(fixture)
  await model.preview(source: "fixture", ids: ["tool"])
  #expect(!model.canConfirm)
  await model.confirm()
  let count = await fixture.requests.count
  model.updateSources([])
  await model.preview(source: "fixture", ids: ["tool"])
  await model.confirm()
  #expect(await fixture.requests.count == count)
}

@MainActor @Test func uncertainSoftwareInstallationRequiresFreshHistoryBeforeAnotherPlan() async throws {
  let fixture = InstallationFixture()
  let model = try await model(fixture)
  await model.preview(source: "fixture", ids: ["tool"])
  await fixture.configure(installFails: true, historyFails: true)
  await model.confirm()
  model.dismissPlan()
  #expect(model.uncertain != nil)
  await model.preview(source: "fixture", ids: ["tool"])
  #expect(model.uncertain != nil && model.plan == nil)
  #expect(await fixture.requests.filter { $0.url?.path.hasSuffix("/install") == true }.count == 1)
  #expect(await fixture.requests.filter { $0.url?.path.hasSuffix("/plan") == true }.count == 1)
  await fixture.configure(history: "[\(runJSON())]")
  await model.loadRuns()
  #expect(model.uncertain == nil && model.sourceBusy("fixture"))
  await model.preview(source: "fixture", ids: ["tool"])
  #expect(model.plan == nil)
}

@MainActor @Test func oldSoftwareHistoryCannotOverwriteAnInstallationOrCancellationAcknowledgement() async throws {
  let fixture = InstallationFixture()
  let model = try await model(fixture)
  await model.preview(source: "fixture", ids: ["tool"])
  await fixture.configure(holdHistory: true)
  let old = Task { await model.loadRuns() }
  try await waitUntilHeld(fixture)
  await model.confirm()
  await model.cancel(try #require(model.runs.first))
  await fixture.release()
  await old.value
  #expect(model.runs.first?.state == "cancelling")
  #expect(model.runs.first?.items.first?.log == "literal log $(never execute)")
}

@MainActor @Test func lateSoftwarePreviewCannotRestoreReviewAfterDisconnect() async throws {
  let fixture = InstallationFixture()
  let model = try await model(fixture)
  await fixture.configure(holdPreview: true)
  let preview = Task { await model.preview(source: "fixture", ids: ["tool"]) }
  try await waitUntilHeld(fixture)
  model.disconnect()
  await fixture.release()
  await preview.value
  #expect(model.plan == nil && !model.showsPlan && !model.planning)
  await model.confirm()
  #expect(await fixture.requests.filter { $0.url?.path.hasSuffix("/install") == true }.isEmpty)
}

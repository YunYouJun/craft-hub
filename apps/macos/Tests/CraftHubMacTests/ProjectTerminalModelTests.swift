import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private actor TerminalModelFixture {
  var applications = ["Terminal", "Ghostty"]
  var requests: [URLRequest] = []
  var holdList = false
  var holdOpen = false
  var listing = false
  var opening = false
  var listFailure = false
  var openFailure = false
  var listContinuation: CheckedContinuation<Void, Never>?
  var openContinuation: CheckedContinuation<Void, Never>?
  func configure(applications: [String]) { self.applications = applications }
  func pauseList(fail: Bool = false) {
    holdList = true
    listFailure = fail
  }
  func recoverList() { listFailure = false }
  func pauseOpen(fail: Bool = false) {
    holdOpen = true
    openFailure = fail
  }
  func releaseList() {
    listContinuation?.resume()
    listContinuation = nil
  }
  func releaseOpen() {
    openContinuation?.resume()
    openContinuation = nil
  }
  func receive(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    let value: [String: Any]
    var status = 200
    if request.url!.path == "/api/native-host/terminal-applications" {
      let failed = listFailure
      value = failed ? ["error": "Fixture catalog failed"] : ["version": 1, "applications": applications]
      if failed { status = 503 }
      if holdList {
        holdList = false
        listing = true
        await withCheckedContinuation { listContinuation = $0 }
        listing = false
      }
    } else {
      let failed = openFailure
      let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: String]
      value =
        failed
        ? ["error": "Fixture terminal unavailable"]
        : ["version": 1, "destination": "terminal", "application": body["application"]!]
      if failed { status = 409 }
      if holdOpen {
        holdOpen = false
        opening = true
        await withCheckedContinuation { openContinuation = $0 }
        opening = false
      }
    }
    return (
      try JSONSerialization.data(withJSONObject: value),
      HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    )
  }
}

private func modelTerminalClient(_ fixture: TerminalModelFixture) throws -> RuntimeAPIClient {
  let secret = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)",
      "nativeApiToken": secret,
    ]))
  return RuntimeAPIClient(connection: connection, transport: { try await fixture.receive($0) })
}

private func terminalModelDefaults() -> (String, UserDefaults) {
  let suite = "CraftHubTerminalTests-\(UUID().uuidString)"
  return (suite, UserDefaults(suiteName: suite)!)
}

private func awaitTerminalModel(_ condition: () async -> Bool) async throws {
  for _ in 0..<200 {
    if await condition() { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("Terminal model fixture did not reach its expected operation")
}

@MainActor @Test func preferredExternalTerminalSurvivesRestartWithinItsProfileAndUnavailableSelectionDoesNotFallback()
  async throws
{
  let fixture = TerminalModelFixture()
  let (suite, defaults) = terminalModelDefaults()
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = ProjectTerminalModel(defaults: defaults)
  model.connect(try modelTerminalClient(fixture))
  model.select(projectID: "project")
  await model.load()
  #expect(model.preferredApplication == "Terminal" && model.canOpen)
  model.chooseApplication("Ghostty")
  let restarted = ProjectTerminalModel(defaults: defaults)
  #expect(restarted.preferredApplication == "Ghostty")
  let (otherSuite, otherDefaults) = terminalModelDefaults()
  defer { otherDefaults.removePersistentDomain(forName: otherSuite) }
  #expect(ProjectTerminalModel(defaults: otherDefaults).preferredApplication.isEmpty)
  await fixture.configure(applications: ["Terminal"])
  await model.load(force: true)
  #expect(model.preferredApplication == "Ghostty" && model.unavailableSelection && !model.canOpen)
  await model.open(.init(projectID: "project"))
  #expect(await fixture.requests.allSatisfy { $0.httpMethod != "POST" })
  model.chooseApplication("Terminal")
  #expect(model.canOpen && !model.unavailableSelection)
}

@MainActor @Test func externalTerminalOpeningUsesExactScopeAndNeverCallsProjectTrustOrExecution() async throws {
  let fixture = TerminalModelFixture()
  let (suite, defaults) = terminalModelDefaults()
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = ProjectTerminalModel(defaults: defaults)
  model.connect(try modelTerminalClient(fixture))
  model.select(projectID: "untrusted")
  await model.load()
  await model.open(.init(projectID: "untrusted"))
  model.select(projectID: "untrusted", capabilityID: "package:build")
  await model.open(.init(projectID: "untrusted", capabilityID: "package:build"))
  let writes = await fixture.requests.filter { $0.httpMethod == "POST" }
  #expect(writes.count == 2)
  let bodies = try writes.map { try JSONSerialization.jsonObject(with: $0.httpBody!) as! [String: String] }
  #expect(bodies[0] == ["projectId": "untrusted", "application": "Terminal"])
  #expect(bodies[1] == ["projectId": "untrusted", "application": "Terminal", "capabilityId": "package:build"])
  #expect(writes.allSatisfy { $0.url!.path == "/api/native-host/open-project-terminal" })
  #expect(model.notice != nil && model.error == nil)
}

@MainActor @Test func externalTerminalPendingOpenCannotDoubleSubmitOrReportAnOldErrorOnANewScope() async throws {
  let fixture = TerminalModelFixture()
  let (suite, defaults) = terminalModelDefaults()
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = ProjectTerminalModel(defaults: defaults)
  model.connect(try modelTerminalClient(fixture))
  model.select(projectID: "first")
  await model.load()
  await fixture.pauseOpen(fail: true)
  let open = Task { await model.open(.init(projectID: "first")) }
  try await awaitTerminalModel { await fixture.opening }
  #expect(model.opening && !model.canOpen)
  await model.open(.init(projectID: "first"))
  model.select(projectID: "second", capabilityID: "build")
  #expect(!model.opening && model.error == nil)
  await fixture.releaseOpen()
  await open.value
  #expect(model.context == .init(projectID: "second", capabilityID: "build"))
  #expect(model.error == nil && model.notice == nil && !model.stale)
  #expect(await fixture.requests.filter { $0.httpMethod == "POST" }.count == 1)
}

@MainActor @Test func externalTerminalReconnectRejectsLateCatalogAndOpenReceiptsFromThePreviousRuntime() async throws {
  let old = TerminalModelFixture()
  let (suite, defaults) = terminalModelDefaults()
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = ProjectTerminalModel(defaults: defaults)
  model.connect(try modelTerminalClient(old))
  model.select(projectID: "first")
  await old.pauseList(fail: true)
  let reading = Task { await model.load() }
  try await awaitTerminalModel { await old.listing }
  let replacement = TerminalModelFixture()
  await replacement.configure(applications: ["Warp"])
  model.connect(try modelTerminalClient(replacement))
  await model.load()
  #expect(model.applications == ["Warp"] && model.preferredApplication == "Warp")
  await old.releaseList()
  await reading.value
  #expect(model.applications == ["Warp"] && model.error == nil)
  await replacement.pauseOpen()
  let opening = Task { await model.open(.init(projectID: "first")) }
  try await awaitTerminalModel { await replacement.opening }
  model.connect(nil)
  await replacement.releaseOpen()
  await opening.value
  #expect(model.notice == nil && model.error == nil && !model.canOpen)
}

@MainActor @Test func externalTerminalOpeningLeavesThePendingNativeCommandReviewUntouched() async throws {
  let (suite, defaults) = terminalModelDefaults()
  defer { defaults.removePersistentDomain(forName: suite) }
  let secret = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)",
      "nativeApiToken": secret,
    ]))
  var paths: [String] = []
  let project: [String: Any] = ["id": "fixture", "name": "Fixture", "path": "/fixture", "trust": "untrusted"]
  let invocation: [String: Any] = ["command": "fixture", "args": [], "cwd": "/fixture", "requiredEnv": []]
  let command: [String: Any] = [
    "id": "build", "name": "Build", "kind": "command", "source": "fixture", "invocation": invocation,
  ]
  let client = RuntimeAPIClient(
    connection: connection,
    transport: { request in
      let path = request.url!.path
      paths.append(path)
      let value: Any
      if path == "/api/projects" {
        value = ["projects": [project], "diagnostics": []]
      } else if path.hasSuffix("/capability-discovery") {
        value = ["capabilities": [command], "packages": [], "diagnostics": []]
      } else if path.hasSuffix("/preview-command") {
        value = invocation
      } else if path.hasSuffix("/command-review") {
        value = [
          "reviewId": "review", "project": project, "capability": command, "invocation": invocation,
          "expiresAt": "2026-10-29T00:05:00Z",
        ]
      } else if path == "/api/runs" {
        value = [] as [String]
      } else if path.hasSuffix("/terminal-applications") {
        value = ["version": 1, "applications": ["Terminal"]]
      } else {
        value = ["version": 1, "destination": "terminal", "application": "Terminal"]
      }
      return (
        try JSONSerialization.data(withJSONObject: value),
        HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
      )
    })
  let workbench = WorkbenchModel(defaults: defaults)
  workbench.projectCommand.connect(client)
  workbench.projectTerminal.connect(client)
  workbench.showProjectCommand("fixture", capability: "build")
  await workbench.projectCommand.load()
  await workbench.projectCommand.prepareReview()
  await workbench.projectTerminal.load()
  let review = workbench.projectCommand.review?.reviewId
  await workbench.projectTerminal.open(.init(projectID: "fixture", capabilityID: "build"))
  #expect(review == "review" && workbench.projectCommand.review?.reviewId == review)
  #expect(workbench.projectCommand.run == nil && workbench.presentsNativeContent && !workbench.webContentRequested)
  #expect(!paths.contains(where: { $0.hasSuffix("/trust") || $0.hasSuffix("/run") }))
}

@MainActor @Test func choosingACachedTerminalCannotHideTheDiscoveryFailureThatBlocksOpening() async throws {
  let fixture = TerminalModelFixture()
  let (suite, defaults) = terminalModelDefaults()
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = ProjectTerminalModel(defaults: defaults)
  model.connect(try modelTerminalClient(fixture))
  model.select(projectID: "fixture")
  await model.load()
  await fixture.pauseList(fail: true)
  let refresh = Task { await model.load(force: true) }
  try await awaitTerminalModel { await fixture.listing }
  await fixture.releaseList()
  await refresh.value
  #expect(model.stale && !model.canOpen && model.error?.contains("Fixture catalog failed") == true)
  model.chooseApplication("Ghostty")
  #expect(model.preferredApplication == "Ghostty" && !model.canOpen)
  #expect(model.error?.contains("Fixture catalog failed") == true)
  await fixture.recoverList()
  await model.load(force: true)
  #expect(model.canOpen && model.error == nil)
}

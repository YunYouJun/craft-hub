import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private actor DetailsModelFixture {
  var discoveries = 0
  var fail = false
  var includePackage = true
  var holdNext = false
  var holding = false
  var continuation: CheckedContinuation<Void, Never>?
  func configure(fail: Bool = false, package: Bool = true) {
    self.fail = fail
    includePackage = package
  }
  func hold() { holdNext = true }
  func release() {
    continuation?.resume()
    continuation = nil
    holding = false
  }
  func receive(_ request: URLRequest) async throws -> (Data, URLResponse) {
    #expect(request.httpBody == nil && (request.httpMethod == nil || request.httpMethod == "GET"))
    var status = 200
    let value: [String: Any]
    if request.url!.path == "/api/projects" {
      value = [
        "projects": ["first", "second"].map { ["id": $0, "name": $0, "path": "/fixture/\($0)", "trust": "untrusted"] },
        "diagnostics": [],
      ]
    } else {
      discoveries += 1
      if fail {
        value = ["error": "Fixture discovery failed"]
        status = 503
      } else {
        let package: [String: Any] = ["relativePath": "apps/sample", "root": false, "name": "Sample"]
        value = [
          "packages": includePackage ? [package] : [], "diagnostics": [],
          "capabilities": [
            [
              "id": "plugin:build", "kind": "command", "name": "Build", "source": "fixture-plugin",
              "description": "Compile sample", "package": package,
            ],
            ["id": "skill:review", "kind": "skill", "name": "Review", "source": "fixture-skills"],
          ],
        ]
      }
      if holdNext {
        holdNext = false
        holding = true
        await withCheckedContinuation { continuation = $0 }
      }
    }
    return (
      try JSONSerialization.data(withJSONObject: value),
      HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    )
  }
}

private func modelDetailsClient(_ fixture: DetailsModelFixture) throws -> RuntimeAPIClient {
  let secret = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)",
      "nativeApiToken": secret,
    ]))
  return RuntimeAPIClient(connection: connection, transport: { try await fixture.receive($0) })
}

private func awaitDetailsHold(_ fixture: DetailsModelFixture) async throws {
  for _ in 0..<200 {
    if await fixture.holding { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("Fixture did not hold its discovery request")
}

@MainActor @Test func projectInspectionFiltersPluginCapabilitiesAndRetainsFailedObservationsAsStale() async throws {
  let fixture = DetailsModelFixture()
  let model = ProjectDetailsModel()
  model.connect(try modelDetailsClient(fixture))
  model.select("first")
  await model.load()
  #expect(model.canReview && model.snapshot?.project.trust == "untrusted")
  model.search = "FIXTURE-PLUGIN"
  #expect(model.filtered.map(\.id) == ["plugin:build"])
  model.search = ""
  model.packagePath = "apps/sample"
  #expect(model.filtered.map(\.id) == ["plugin:build"])
  model.packagePath = ""
  model.kind = "skill"
  #expect(model.filtered.map(\.id) == ["skill:review"])
  model.invalidate([.runs])
  await model.load()
  #expect(await fixture.discoveries == 1)
  await fixture.configure(fail: true)
  await model.load(force: true)
  #expect(model.snapshot?.project.id == "first" && model.stale && !model.canReview)
  #expect(model.error?.contains("Fixture discovery failed") == true)
  model.packagePath = "apps/sample"
  await fixture.configure(package: false)
  await model.load(force: true)
  #expect(model.canReview && model.error == nil && model.packagePath.isEmpty)
}

@MainActor @Test func projectInspectionCoalescesReadsAndRepeatsInvalidationsArrivingDuringDiscovery() async throws {
  let fixture = DetailsModelFixture()
  await fixture.hold()
  let model = ProjectDetailsModel()
  model.connect(try modelDetailsClient(fixture))
  model.select("first")
  let first = Task { await model.load() }
  try await awaitDetailsHold(fixture)
  model.invalidate([.plugins])
  let second = Task { await model.load() }
  await fixture.release()
  await first.value
  await second.value
  #expect(await fixture.discoveries == 2)
  #expect(model.canReview && !model.loading)
}

@MainActor @Test func lateProjectReadsCannotReplaceANewerProjectOrReconnectAfterClosing() async throws {
  let fixture = DetailsModelFixture()
  await fixture.hold()
  let model = ProjectDetailsModel()
  model.connect(try modelDetailsClient(fixture))
  model.select("first")
  let old = Task { await model.load() }
  try await awaitDetailsHold(fixture)
  model.select("second")
  await model.load()
  #expect(model.snapshot?.project.id == "second")
  await fixture.release()
  await old.value
  #expect(model.snapshot?.project.id == "second" && model.canReview)
  await fixture.hold()
  let closing = Task { await model.load(force: true) }
  try await awaitDetailsHold(fixture)
  model.close()
  await fixture.release()
  await closing.value
  #expect(model.projectID == nil && model.snapshot == nil && !model.loading && !model.canReview)
}

@MainActor @Test func runtimeReplacementDiscardsHeldProjectObservations() async throws {
  let oldFixture = DetailsModelFixture()
  await oldFixture.hold()
  let model = ProjectDetailsModel()
  model.connect(try modelDetailsClient(oldFixture))
  model.select("first")
  let old = Task { await model.load() }
  try await awaitDetailsHold(oldFixture)
  let replacement = DetailsModelFixture()
  await replacement.configure(fail: true)
  model.connect(try modelDetailsClient(replacement))
  await model.load()
  await oldFixture.release()
  await old.value
  #expect(model.projectID == "first" && model.snapshot == nil && model.stale && !model.loading)
  #expect(model.error?.contains("Fixture discovery failed") == true)
}

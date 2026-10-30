import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private actor CatalogReadFixture {
  var requestCount = 0
  var held = false
  var fails = false
  private var pending: CheckedContinuation<Void, Never>?
  let identifier: String

  init(identifier: String = "fixture", held: Bool = false) {
    self.identifier = identifier
    self.held = held
  }

  func setFailure(_ fails: Bool) { self.fails = fails }

  func release() {
    held = false
    pending?.resume()
    pending = nil
  }

  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requestCount += 1
    if held { await withCheckedContinuation { pending = $0 } }
    if fails { throw URLError(.timedOut) }
    let body: [String: Any] = [
      "integrations": [
        [
          "id": identifier, "actions": [],
          "views": [["id": "tasks", "title": "Tasks", "scope": "global", "blocks": []]],
        ]
      ],
      "diagnostics": [],
    ]
    return (
      try JSONSerialization.data(withJSONObject: body),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
}

private func catalogClient(_ fixture: CatalogReadFixture) throws -> RuntimeAPIClient {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)",
      "nativeApiToken": token,
    ]))
  return RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) })
}

private func waitForCatalogRead(_ fixture: CatalogReadFixture) async throws {
  for _ in 0..<100 {
    if await fixture.requestCount > 0 { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("The catalog request did not start")
}

@MainActor @Test func concurrentCatalogReadersWaitForTheSameSnapshot() async throws {
  let fixture = CatalogReadFixture(held: true)
  let model = IntegrationWorkbenchModel()
  model.connect(try catalogClient(fixture))
  let first = Task { await model.loadCatalog() }
  try await waitForCatalogRead(fixture)
  var secondFinished = false
  let second = Task {
    let loaded = await model.loadCatalog()
    secondFinished = true
    return loaded
  }
  try await Task.sleep(for: .milliseconds(25))
  #expect(!secondFinished)
  #expect(model.loadingCatalog && model.entries.isEmpty)
  await fixture.release()
  #expect(await first.value)
  #expect(await second.value)
  #expect(await fixture.requestCount == 1)
  #expect(model.entries.map(\.id) == ["fixture/tasks"])
  #expect(!model.loadingCatalog)
}

@MainActor @Test func failedCatalogRefreshRequiresASuccessfulReadBeforeConfirmingAbsence() async throws {
  let fixture = CatalogReadFixture()
  let model = IntegrationWorkbenchModel()
  model.connect(try catalogClient(fixture))
  #expect(await model.loadCatalog())
  await fixture.setFailure(true)
  #expect(await model.loadCatalog(force: true) == false)
  #expect(model.error != nil && model.entries.map(\.id) == ["fixture/tasks"])
  await fixture.setFailure(false)
  #expect(await model.loadCatalog())
  #expect(await fixture.requestCount == 3)
  #expect(model.error == nil)
}

@MainActor @Test func reconnectDiscardsTheOldCatalogWithoutReplacingTheNewSnapshot() async throws {
  let oldFixture = CatalogReadFixture(identifier: "old", held: true)
  let newFixture = CatalogReadFixture(identifier: "new")
  let model = IntegrationWorkbenchModel()
  model.connect(try catalogClient(oldFixture))
  let oldRead = Task { await model.loadCatalog() }
  try await waitForCatalogRead(oldFixture)
  model.connect(try catalogClient(newFixture))
  #expect(await model.loadCatalog())
  await oldFixture.release()
  #expect(await oldRead.value == false)
  #expect(model.entries.map(\.id) == ["new/tasks"] && !model.loadingCatalog && model.error == nil)
}

@MainActor @Test func invalidatedCatalogReadsCannotConfirmAbsenceAndCanBeRetried() async throws {
  let fixture = CatalogReadFixture(held: true)
  let model = IntegrationWorkbenchModel()
  model.connect(try catalogClient(fixture))
  let read = Task { await model.loadCatalog() }
  try await waitForCatalogRead(fixture)
  model.invalidate([.plugins])
  await fixture.release()
  #expect(await read.value == false)
  #expect(model.entries.isEmpty && !model.loadingCatalog)
  #expect(await model.loadCatalog())
  #expect(await fixture.requestCount == 2)
}

@MainActor @Test func cancellingOneCatalogWaiterDoesNotCancelAnotherReadersSnapshot() async throws {
  let fixture = CatalogReadFixture(held: true)
  let model = IntegrationWorkbenchModel()
  model.connect(try catalogClient(fixture))
  let read = Task { await model.loadCatalog() }
  try await waitForCatalogRead(fixture)
  let cancelledRead = Task { await model.loadCatalog() }
  await Task.yield()
  cancelledRead.cancel()
  await fixture.release()
  #expect(await read.value)
  #expect(await cancelledRead.value == false)
  #expect(await fixture.requestCount == 1)
  #expect(model.entries.map(\.id) == ["fixture/tasks"])
}

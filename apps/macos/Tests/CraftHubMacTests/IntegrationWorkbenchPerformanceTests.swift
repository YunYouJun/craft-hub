import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private actor WorkbenchPerformanceFixture {
  private(set) var requests: [String] = []
  private(set) var maximumConcurrentCopies = 0
  private var held = Set<String>()
  private var continuations: [String: CheckedContinuation<Void, Never>] = [:]
  private var active: [String: Int] = [:]
  private var emptyCatalog = false

  func holdLists() { held = Set((1...5).map { "list-\($0)" }) }
  func holdCatalog() { held.insert("integrations") }
  func removeEntries() { emptyCatalog = true }
  func releaseAll() {
    held = []
    let pending = continuations.values
    continuations = [:]
    for continuation in pending { continuation.resume() }
  }

  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    let action = request.url!.lastPathComponent
    requests.append(action)
    active[action, default: 0] += 1
    maximumConcurrentCopies = max(maximumConcurrentCopies, active[action]!)
    defer { active[action, default: 0] -= 1 }
    if held.contains(action) { await withCheckedContinuation { continuations[action] = $0 } }
    let value: [String: Any]
    if action == "integrations" {
      let actions: [[String: Any]] = (["connection"] + (1...5).map { "list-\($0)" } + ["search"]).map {
        [
          "id": $0, "title": $0, "operation": $0 == "connection" ? "connection.status" : "work-items.list",
          "effect": "remote-read", "effectiveConfirmation": "never",
        ]
      }
      let blocks: [[String: Any]] =
        [["id": "connection", "type": "connection-status", "actionId": "connection"]]
        + (1...5).map { ["id": "list-\($0)", "type": "entity-list", "actionId": "list-\($0)"] }
        + [["id": "search", "type": "entity-search", "actionId": "search"]]
      let contributions: [[String: Any]] =
        emptyCatalog
        ? []
        : [
          [
            "id": "fixture", "actions": actions,
            "views": [["id": "tasks", "title": "Tasks", "scope": "global", "blocks": blocks]],
          ]
        ]
      value = ["integrations": contributions, "diagnostics": []]
    } else if action == "connection" {
      value = [
        "version": 1, "kind": "connection", "connection": ["connected": true, "session": ["cacheKey": "first"]],
      ]
    } else {
      value = [
        "version": 1, "kind": "entities",
        "page": [
          "items": [["id": action, "key": action, "title": action, "active": true, "personal": true]],
          "nextCursor": "next", "currentUser": ["id": "first"],
        ],
      ]
    }
    return (
      try JSONSerialization.data(withJSONObject: value),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
}

@MainActor private func performanceWorkbench(_ fixture: WorkbenchPerformanceFixture) async throws
  -> IntegrationWorkbenchModel
{
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)",
      "nativeApiToken": token,
    ]))
  let model = IntegrationWorkbenchModel()
  model.connect(RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) }))
  await model.loadCatalog()
  return model
}

@MainActor @Test func workbenchPerformanceReselectingTheSameGlobalSourcePreservesItsRowsAndFilters() async throws {
  let fixture = WorkbenchPerformanceFixture()
  let model = try await performanceWorkbench(fixture)
  await model.select("fixture/tasks")
  let block = try #require(model.entry?.view.blocks.first { $0.id == "list-1" })
  let state = model.state(block)
  state.query = "saved filter"
  state.personalOnly = true
  model.search = "Tasks"
  let count = await fixture.requests.count
  await model.select("fixture/tasks", project: "ignored-by-global-scope")
  #expect(await fixture.requests.count == count)
  #expect(model.state(block) === state)
  #expect(model.state(block).query == "saved filter" && model.state(block).personalOnly)
  #expect(model.state(block).page?.nextCursor == "next")
  #expect(model.search.isEmpty)
  #expect(model.projectID.isEmpty)
}

@MainActor @Test func workbenchPerformanceFreshSnapshotsSkipAutomaticReadsAndRelevantChangesRefreshThem() async throws {
  let fixture = WorkbenchPerformanceFixture()
  let model = try await performanceWorkbench(fixture)
  await model.select("fixture/tasks")
  let count = await fixture.requests.count
  await model.refreshIfIdle()
  #expect(await fixture.requests.count == count)
  #expect(model.invalidate([.softwareSources]) == false)
  await model.refreshIfIdle()
  #expect(await fixture.requests.count == count)
  #expect(model.invalidate([.configurationSync]) == false)
  await model.refreshIfIdle()
  #expect(await fixture.requests.count == count)
  #expect(model.invalidate([.integrations]))
  await model.refreshIfIdle()
  #expect(await fixture.requests.count == count + 6)
  #expect(await fixture.requests.contains("search") == false)
}

@MainActor @Test func workbenchPerformanceIndependentListsLoadTogetherWithAtMostFourRequests() async throws {
  let fixture = WorkbenchPerformanceFixture()
  let model = try await performanceWorkbench(fixture)
  await fixture.holdLists()
  let loading = Task { await model.select("fixture/tasks") }
  for _ in 0..<100 {
    if await fixture.requests.contains("list-1") { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  try await Task.sleep(for: .milliseconds(25))
  let started = await fixture.requests.filter { $0.hasPrefix("list-") }
  #expect(started.count == 4)
  #expect(started.contains("list-2"))
  #expect(!started.contains("list-5"))
  #expect(await fixture.requests.prefix(2) == ["integrations", "connection"])
  await fixture.releaseAll()
  await loading.value
  #expect(await fixture.requests.filter { $0.hasPrefix("list-") }.count == 5)
  #expect(model.states.values.filter { $0.page != nil }.count == 5)
}

@MainActor @Test func workbenchPerformanceChangesDuringAReadCoalesceIntoOneFreshFollowup() async throws {
  let fixture = WorkbenchPerformanceFixture()
  let model = try await performanceWorkbench(fixture)
  await fixture.holdLists()
  let loading = Task { await model.select("fixture/tasks") }
  for _ in 0..<100 {
    if await fixture.requests.filter({ $0.hasPrefix("list-") }).count == 4 { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(model.invalidate([.integrations]))
  await model.refreshIfIdle()
  await model.refreshIfIdle()
  await fixture.releaseAll()
  await loading.value
  for _ in 0..<100 {
    if await fixture.requests.filter({ $0 == "list-1" }).count == 2, !model.refreshing { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(await fixture.requests.filter { $0 == "list-1" }.count == 2)
  #expect(await fixture.requests.filter { $0 == "connection" }.count == 2)
  #expect(await fixture.maximumConcurrentCopies == 1)
  #expect(model.states.filter { $0.key != "search" }.values.allSatisfy { !$0.stale && !$0.loading })
}

@MainActor @Test func workbenchPerformanceRemovingTheSelectedEntryEndsTheActiveRefresh() async throws {
  let fixture = WorkbenchPerformanceFixture()
  let model = try await performanceWorkbench(fixture)
  await model.select("fixture/tasks")
  await fixture.holdCatalog()
  model.invalidate([.plugins])
  let refresh = Task { await model.refresh() }
  for _ in 0..<100 {
    if await fixture.requests.filter({ $0 == "integrations" }).count == 2 { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(model.refreshing)
  await model.refreshIfIdle()
  await fixture.removeEntries()
  await fixture.releaseAll()
  await refresh.value
  #expect(model.entries.isEmpty && model.entryID.isEmpty && !model.refreshing)
  let count = await fixture.requests.count
  await model.refreshIfIdle()
  #expect(await fixture.requests.count == count)
}

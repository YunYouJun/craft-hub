import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private let integrationCatalog = #"""
  {"integrations":[{"id":"fixture","actions":[
  {"id":"configuration","title":"Configuration","operation":"configuration.list","effect":"local-read","effectiveConfirmation":"never"},
  {"id":"update","title":"Save","operation":"configuration.update","effect":"local-write","effectiveConfirmation":"always"},
  {"id":"connection","title":"Connection","operation":"connection.status","effect":"remote-read","effectiveConfirmation":"never"},
  {"id":"tasks","title":"Tasks","operation":"work-items.list","effect":"remote-read","effectiveConfirmation":"never"},
  {"id":"search","title":"Search","operation":"work-items.search","effect":"remote-read","effectiveConfirmation":"never"},
  {"id":"gated","title":"Reviewed read","operation":"configuration.list","effect":"local-read","effectiveConfirmation":"always"}],
  "views":[{"id":"configuration","title":"Config","scope":"global-and-project","blocks":[{"id":"configuration","type":"entity-list","actionId":"configuration"}]},
  {"id":"tasks","title":"Tasks","scope":"global","blocks":[{"id":"connection","type":"connection-status","actionId":"connection"},{"id":"tasks","type":"entity-list","actionId":"tasks","statusFilter":"active"},{"id":"search","type":"entity-search","actionId":"search"},{"id":"gated","type":"entity-list","actionId":"gated"},{"id":"form","type":"action-form","actionId":"update"}]}]}],"diagnostics":[]}
  """#

private actor IntegrationFixture {
  var requests: [URLRequest] = []
  var account = "first"
  var connected = true
  var fail: String?
  var hold: String?
  var waiter: CheckedContinuation<Void, Never>?
  func configure(account: String = "first", connected: Bool = true, fail: String? = nil, hold: String? = nil) {
    self.account = account
    self.connected = connected
    self.fail = fail
    self.hold = hold
  }
  func release() {
    waiter?.resume()
    waiter = nil
    hold = nil
  }
  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    let action = request.url!.lastPathComponent
    let responseAccount = account
    if hold == action { await withCheckedContinuation { waiter = $0 } }
    if fail == action { throw URLError(.timedOut) }
    let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    if action == "integrations" { return (Data(integrationCatalog.utf8), response) }
    let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
    let input = body["input"] as? [String: Any] ?? [:]
    let json: [String: Any]
    if action == "connection" {
      json = [
        "version": 1, "kind": "connection",
        "connection": ["connected": connected, "session": ["cacheKey": responseAccount]],
      ]
    } else if action == "configuration" || action == "update" {
      let scope = request.url!.path.contains("/projects/") ? "project" : "global"
      json = [
        "version": 1, "kind": "entities",
        "page": [
          "items": [
            [
              "id": "plugin@fixture", "key": "configuration", "title": "Fixture", "active": true, "personal": false,
              "configurationToggle": [
                "enabled": action != "update", "inherited": false, "revision": action == "update" ? "new" : "inspected",
                "scope": scope,
              ],
            ]
          ]
        ],
      ]
    } else {
      let next = input["cursor"] != nil
      let rows: [[String: Any]] = (next ? ["one", "three"] : ["one", "two"]).map { key in
        [
          "id": "same-provider-id", "key": "\(responseAccount)/\(key)",
          "title": next ? "Updated \(key)" : "Item \(key)",
          "active": true, "personal": true,
        ]
      }
      json = [
        "version": 1, "kind": "entities",
        "page": [
          "items": rows, "nextCursor": "same-cursor", "currentUser": ["id": responseAccount], "coverage": "partial",
        ],
      ]
    }
    return (try JSONSerialization.data(withJSONObject: json), response)
  }
}
@MainActor private func integrationModel(_ fixture: IntegrationFixture) async throws -> IntegrationWorkbenchModel {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1,
      "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  let model = IntegrationWorkbenchModel()
  model.connect(RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) }))
  await model.loadCatalog()
  return model
}
private func waitForIntegration(_ fixture: IntegrationFixture) async throws {
  for _ in 0..<100 {
    if await fixture.waiter != nil { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("Integration request was not held")
}

@MainActor @Test func lateAccountReadsAndDisconnectedWriteReceiptsCannotRestoreDiscardedState() async throws {
  let fixture = IntegrationFixture()
  let model = try await integrationModel(fixture)
  await model.select("fixture/tasks")
  let tasks = try #require(model.entry?.view.blocks.first { $0.id == "tasks" })
  let connection = try #require(model.entry?.view.blocks.first { $0.id == "connection" })
  await fixture.configure(hold: "tasks")
  let read = Task { await model.read(tasks) }
  try await waitForIntegration(fixture)
  await fixture.configure(account: "second")
  await model.read(connection)
  await fixture.release()
  await read.value
  #expect(model.state(tasks).page == nil)
  await model.read(tasks)
  #expect(model.state(tasks).page?.items.allSatisfy { $0.key.hasPrefix("second/") } == true)
  await model.select("fixture/configuration")
  let block = try #require(model.entry?.view.blocks.first)
  model.prepareToggle(block, item: try #require(model.state(block).page?.items.first), enabled: false)
  let review = try #require(model.review)
  await fixture.configure(hold: "update")
  let write = Task { await model.confirm(review) }
  try await waitForIntegration(fixture)
  model.connect(nil)
  await fixture.release()
  await write.value
  #expect(model.states.isEmpty && model.entries.isEmpty && !model.busy && model.notice == nil)
}

@MainActor @Test func nativeBlocksOnlyReadDeclaredUnconfirmedActionsAndStopRepeatedPagination() async throws {
  let fixture = IntegrationFixture()
  let model = try await integrationModel(fixture)
  #expect(await fixture.requests.count == 1)
  await model.select("fixture/tasks")
  #expect(await fixture.requests.map { $0.url!.lastPathComponent } == ["integrations", "connection", "tasks"])
  let block = try #require(model.entry?.view.blocks.first { $0.id == "tasks" })
  let state = model.state(block)
  #expect(state.page?.items.count == 2)
  await model.read(block, append: true)
  #expect(state.page?.items.count == 3 && state.page?.nextCursor == nil && state.page?.coverage == "partial")
  #expect(state.page?.items.first?.title == "Updated one" && state.error != nil)
  #expect(await fixture.requests.allSatisfy { $0.httpMethod == "GET" || $0.url!.query == "presentation=workbench-v1" })
}

@MainActor @Test func accountChangesDropOldPagesAndNeverSendOldAccountCursors() async throws {
  let fixture = IntegrationFixture()
  let model = try await integrationModel(fixture)
  await model.select("fixture/tasks")
  let block = try #require(model.entry?.view.blocks.first { $0.id == "tasks" })
  await fixture.configure(account: "second")
  await model.read(block, append: true)
  #expect(model.state(block).page?.items.allSatisfy { $0.key.hasPrefix("second/") } == true)
  let request = try #require(await fixture.requests.last)
  let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
  #expect((body["input"] as? [String: Any])?["cursor"] == nil)
  await fixture.configure(account: "second", connected: false)
  await model.refresh()
  #expect(model.state(block).page == nil && model.state(block).stale)
}

@MainActor @Test func scopedConfigurationReviewFreezesRevisionAndCannotSurviveInvalidation() async throws {
  let fixture = IntegrationFixture()
  let model = try await integrationModel(fixture)
  await model.select("fixture/configuration", project: "project")
  let block = try #require(model.entry?.view.blocks.first)
  let item = try #require(model.state(block).page?.items.first)
  model.prepareToggle(block, item: item, enabled: false)
  let cancelled = try #require(model.review)
  model.invalidate([.integrations])
  await model.confirm(cancelled)
  #expect(await fixture.requests.filter { $0.url?.lastPathComponent == "update" }.isEmpty)
  await model.refresh()
  model.prepareToggle(block, item: try #require(model.state(block).page?.items.first), enabled: nil)
  let reviewed = try #require(model.review)
  await model.confirm(reviewed)
  let request = try #require(await fixture.requests.last)
  #expect(request.url?.path == "/api/projects/project/integrations/fixture/actions/update")
  let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
  let input = try #require(body["input"] as? [String: Any])
  #expect(input["revision"] as? String == "inspected" && input["enabled"] is NSNull)
  #expect(body["confirmed"] as? Bool == true)
  #expect(
    body["reviewedAction"] as? [String: String] == ["operation": "configuration.update", "effect": "local-write"])
  #expect(model.state(block).page?.items.first?.configurationToggle?.revision == "new")
}

@MainActor @Test func uncertainConfigurationNeedsFreshReadAndLateScopesCannotReplaceCurrentState() async throws {
  let fixture = IntegrationFixture()
  let model = try await integrationModel(fixture)
  await model.select("fixture/configuration")
  let block = try #require(model.entry?.view.blocks.first)
  model.prepareToggle(block, item: try #require(model.state(block).page?.items.first), enabled: false)
  await fixture.configure(fail: "update")
  await model.confirm(try #require(model.review))
  #expect(model.uncertain == block.id && !model.canChangeContext)
  await model.select("fixture/tasks")
  #expect(model.entryID == "fixture/configuration")
  await fixture.configure()
  await model.refresh()
  #expect(model.uncertain == nil && model.canChangeContext)
  await fixture.configure(hold: "configuration")
  let pending = Task { await model.read(block) }
  try await waitForIntegration(fixture)
  await model.select("fixture/tasks")
  await fixture.release()
  await pending.value
  #expect(model.entryID == "fixture/tasks" && model.states["configuration"] == nil)
}

@MainActor @Test func sourceSearchKeepsItsKeywordAcrossPaginationWithoutApplyingALocalTitleFilter() async throws {
  let fixture = IntegrationFixture()
  let model = try await integrationModel(fixture)
  await model.select("fixture/tasks")
  let block = try #require(model.entry?.view.blocks.first { $0.id == "search" })
  model.state(block).query = "metadata:needle"
  await model.read(block, keyword: "metadata:needle")
  #expect(model.state(block).visibleItems.count == 2)
  await model.read(block, append: true)
  let request = try #require(await fixture.requests.last)
  let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
  #expect((body["input"] as? [String: Any])?["keyword"] as? String == "metadata:needle")
  model.connect(nil)
  #expect(model.entries.isEmpty && model.states.isEmpty && model.review == nil)
}

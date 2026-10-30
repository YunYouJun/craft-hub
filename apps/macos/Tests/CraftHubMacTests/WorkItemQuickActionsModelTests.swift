import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private actor WorkItemActionFixture {
  var requests: [URLRequest] = []
  var workflow = true
  var status = "developing"
  var account = "account-a"
  var connected = true
  var fail: String?
  var hold: String?
  var waiter: CheckedContinuation<Void, Never>?
  private let heldRequests = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
  var changedWorkflow = false
  var changedDeclaration = false
  var omitDetailSource = false
  func configure(
    status: String? = nil, account: String? = nil, connected: Bool? = nil, fail: String? = nil,
    hold: String? = nil, workflow: Bool? = nil, changedWorkflow: Bool? = nil, changedDeclaration: Bool? = nil,
    omitDetailSource: Bool? = nil
  ) {
    if let status { self.status = status }
    if let account { self.account = account }
    if let connected { self.connected = connected }
    if let workflow { self.workflow = workflow }
    if let changedWorkflow { self.changedWorkflow = changedWorkflow }
    if let changedDeclaration { self.changedDeclaration = changedDeclaration }
    if let omitDetailSource { self.omitDetailSource = omitDetailSource }
    self.fail = fail
    self.hold = hold
  }
  func release() {
    hold = nil
    waiter?.resume()
    waiter = nil
  }
  func waitForHeldRequest() async -> Bool {
    var iterator = heldRequests.stream.makeAsyncIterator()
    return await iterator.next() != nil
  }
  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    let action = request.url!.lastPathComponent
    let capturedStatus = status
    if hold == action {
      await withCheckedContinuation {
        waiter = $0
        heldRequests.continuation.yield(())
      }
    }
    if fail == action { throw URLError(.timedOut) }
    let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    let json: [String: Any]
    if action == "integrations" {
      var actions = [
        [
          "id": "get", "title": "Details", "operation": "work-items.get", "effect": "remote-read",
          "effectiveConfirmation": "never",
        ],
        [
          "id": "connection", "title": "Connection", "operation": "connection.status", "effect": "remote-read",
          "effectiveConfirmation": "never",
        ],
        [
          "id": "update", "title": "Update", "operation": "work-items.update-status", "effect": "remote-write",
          "effectiveConfirmation": changedDeclaration ? "never" : "always",
        ],
      ]
      if workflow {
        actions.append([
          "id": "transitions", "title": "Transitions", "operation": "work-items.transitions", "effect": "remote-read",
          "effectiveConfirmation": "never",
        ])
      }
      json = ["integrations": [["id": "fixture", "actions": actions, "views": []]], "diagnostics": []]
    } else if action == "connection" {
      json = [
        "version": 1, "kind": "connection", "connection": ["connected": connected, "session": ["cacheKey": account]],
      ]
    } else if action == "transitions" {
      json = [
        "currentStatus": capturedStatus,
        "transitions": [
          [
            "id": "test", "title": "Ready for testing", "fromStatus": capturedStatus,
            "toStatus": changedWorkflow ? "other-status" : "testing", "requiredFields": ["owner"],
          ]
        ],
      ]
    } else if action == "get" {
      var item = Self.entity(status: capturedStatus)
      if omitDetailSource { item.removeValue(forKey: "sourceRef") }
      json = ["version": 1, "kind": "entity", "entity": item]
    } else {
      let input = try body(request)["input"] as! [String: Any]
      let next = input["status"] as? String ?? input["statusCategory"] as? String ?? "unknown"
      status = next
      // A provider may return only native IDs and status after an update.
      json = [
        "version": 1, "kind": "entity",
        "entity": [
          "key": "receipt", "id": "display-id", "title": "Review proposal", "status": next,
          "active": next != "done", "personal": false,
        ],
      ]
    }
    return (try JSONSerialization.data(withJSONObject: json), response)
  }
  static func entity(status: String = "developing") -> [String: Any] {
    [
      "key": "account/inbox/native-id", "id": "display-id", "title": "Review proposal", "active": true,
      "personal": true, "status": status, "statusLabel": "Developing", "statusCategory": "active",
      "statusUpdateAvailable": true, "description": "<p>Full details</p><script>hidden()</script>",
      "url": "https://example.com/items/1", "metadata": ["workspaceId": "space", "itemId": "wrong-id"],
      "sourceRef": [
        "providerId": "tasks", "instanceId": "fixture", "accountId": "owner", "containerId": "inbox", "kind": "task",
        "itemId": "native-id",
      ],
    ]
  }
  func count(_ action: String) -> Int { requests.filter { $0.url!.lastPathComponent == action }.count }
}

private func body(_ request: URLRequest) throws -> [String: Any] {
  try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
}
@MainActor private func quickActionModel(_ fixture: WorkItemActionFixture, now: @escaping () -> Date = Date.init) throws
  -> WorkItemQuickActionsModel
{
  let model = WorkItemQuickActionsModel(now: now)
  model.connect(try quickActionClient(fixture))
  return model
}
private func quickActionClient(_ fixture: WorkItemActionFixture) throws -> RuntimeAPIClient {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  return RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) })
}
private func quickActionTarget(readOnly: Bool = false, project: String? = nil) throws -> WorkItemActionTarget {
  var projected = WorkItemActionFixture.entity()
  projected.removeValue(forKey: "description")
  let item = try JSONDecoder().decode(
    IntegrationPresentation.Entity.self, from: JSONSerialization.data(withJSONObject: projected))
  return WorkItemActionTarget(integrationId: "fixture", projectId: project, item: item, readOnly: readOnly)
}
private func waitForQuickAction(_ fixture: WorkItemActionFixture) async throws {
  let held = await withTaskGroup(of: Bool.self) { group in
    group.addTask { await fixture.waitForHeldRequest() }
    group.addTask {
      try? await Task.sleep(for: .seconds(5))
      return false
    }
    let observed = await group.next() ?? false
    group.cancelAll()
    return observed
  }
  if !held { await fixture.release() }
  try #require(held, "Quick action request was not held")
}
@MainActor private func prepareQuickAction(_ model: WorkItemQuickActionsModel) throws
  -> WorkItemQuickActionsModel.Review
{
  model.select("test")
  model.edit("owner", value: "alex")
  model.prepareReview()
  return try #require(model.review)
}

@MainActor @Test func quickDetailsUseExactSourceScopeAndCachedTargetsNeverInvokeRemoteActions() async throws {
  let fixture = WorkItemActionFixture()
  let model = try quickActionModel(fixture)
  await model.open(try quickActionTarget())
  #expect(model.item?.description?.contains("Full details") == true && !model.stale)
  let request = try #require(await fixture.requests.first { $0.url!.lastPathComponent == "get" })
  let input = try body(request)["input"] as! [String: Any]
  #expect(input["itemId"] as? String == "native-id" && input["workspaceId"] as? String == "space")
  #expect((input["sourceRef"] as? [String: String])?["containerId"] == "inbox")
  #expect(request.url?.path == "/api/integrations/fixture/actions/get")
  #expect(await fixture.count("update") == 0)
  await fixture.configure(omitDetailSource: true)
  await model.reload()
  #expect(model.stale && model.error != nil && !model.canChangeStatus)
  let previous = await fixture.requests.count
  await model.open(try quickActionTarget(readOnly: true))
  #expect(await fixture.requests.count == previous && model.stale && !model.canChangeStatus)
}

@MainActor @Test func statusReviewFreezesRequiredFieldsAndOnlyOneConfirmedWriteCanRun() async throws {
  let fixture = WorkItemActionFixture()
  let model = try quickActionModel(fixture)
  await model.open(try quickActionTarget(project: "project"), mode: .status)
  model.select("test")
  #expect(!model.canReview)
  model.edit("owner", value: "alex")
  #expect(model.canReview)
  model.prepareReview()
  let review = try #require(model.review)
  model.edit("owner", value: "later edit")
  #expect(review.fields == ["owner": "alex"] && model.fields["owner"] == "alex")
  #expect(await fixture.count("update") == 0)
  var receipt: IntegrationPresentation.Entity?
  model.completed = { receipt = $0 }
  await fixture.configure(hold: "update")
  let write = Task { await model.confirm(review) }
  try await waitForQuickAction(fixture)
  await model.confirm(review)
  #expect(model.executing)
  #expect(await fixture.count("update") == 1)
  await fixture.release()
  await write.value
  #expect(model.target == nil && receipt?.status == "testing" && receipt?.sourceRef?.itemId == "native-id")
  #expect(receipt?.metadata?["workspaceId"] == .string("space"))
  let request = try #require(await fixture.requests.last { $0.url!.lastPathComponent == "update" })
  let requestBody = try body(request)
  let input = requestBody["input"] as! [String: Any]
  #expect(request.url?.path == "/api/projects/project/integrations/fixture/actions/update")
  #expect(requestBody["confirmed"] as? Bool == true)
  #expect(
    requestBody["reviewedAction"] as? [String: String] == [
      "operation": "work-items.update-status", "effect": "remote-write",
    ])
  #expect(input["currentStatus"] as? String == "developing" && input["transitionId"] as? String == "test")
  #expect(input["fields"] as? [String: String] == ["owner": "alex"])
}

@MainActor @Test func successfulDetailsRemainVisibleWhenWorkflowOptionsFailWithoutEnablingStatusWrites() async throws {
  let fixture = WorkItemActionFixture()
  await fixture.configure(fail: "transitions")
  let model = try quickActionModel(fixture)
  let target = try quickActionTarget()
  #expect(target.item.description == nil)
  await model.open(target)
  #expect(model.item?.description?.contains("Full details") == true)
  #expect(model.error != nil && model.stale && !model.canChangeStatus && !model.canReview)
  model.show(.status)
  model.select("test")
  model.edit("owner", value: "alex")
  model.prepareReview()
  #expect(model.review == nil)
  #expect(await fixture.count("get") == 1)
  #expect(await fixture.count("update") == 0)
  await fixture.configure()
  await model.reload()
  #expect(!model.stale && model.canChangeStatus)
}

@MainActor @Test func configurationSyncHeartbeatKeepsAReviewedActionButConfigurationChangesInvalidateIt() async throws {
  let fixture = WorkItemActionFixture()
  let suite = "craft-hub-work-item-heartbeat-\(UUID())"
  let defaults = try #require(UserDefaults(suiteName: suite))
  defer { defaults.removePersistentDomain(forName: suite) }
  let workbench = WorkbenchModel(defaults: defaults)
  let actions = workbench.workItemActions
  actions.connect(try quickActionClient(fixture))
  await actions.open(try quickActionTarget())
  let reviewed = try prepareQuickAction(actions)
  workbench.invalidate([.configurationSync])
  #expect(actions.review?.id == reviewed.id && !actions.stale)
  workbench.invalidate([.userConfig])
  #expect(actions.review == nil && actions.stale)
  await actions.confirm(reviewed)
  #expect(await fixture.count("update") == 0)
}

@MainActor @Test func changedItemAccountWorkflowOrDeclarationCannotUseAnOldReview() async throws {
  for change in ["item", "account", "workflow", "declaration", "disconnected"] {
    let fixture = WorkItemActionFixture()
    let model = try quickActionModel(fixture)
    await model.open(try quickActionTarget())
    let review = try prepareQuickAction(model)
    switch change {
    case "item": await fixture.configure(status: "already-changed")
    case "account": await fixture.configure(account: "account-b")
    case "workflow": await fixture.configure(changedWorkflow: true)
    case "declaration": await fixture.configure(changedDeclaration: true)
    default: await fixture.configure(connected: false)
    }
    await model.confirm(review)
    #expect(await fixture.count("update") == 0)
    #expect(model.stale && model.error != nil && !model.uncertain)
  }
}

@MainActor @Test func expiredOrInvalidatedReviewNeverWritesAndLateReadsCannotRestoreAClosedSheet() async throws {
  let fixture = WorkItemActionFixture()
  var current = Date(timeIntervalSince1970: 1_800_000_000)
  let model = try quickActionModel(fixture, now: { current })
  await model.open(try quickActionTarget())
  let expired = try prepareQuickAction(model)
  current.addTimeInterval(121)
  await model.confirm(expired)
  #expect(model.stale)
  #expect(await fixture.count("update") == 0)
  await model.reload()
  let invalidated = try prepareQuickAction(model)
  model.invalidate()
  await model.confirm(invalidated)
  #expect(await fixture.count("update") == 0)
  await fixture.configure(hold: "get")
  let read = Task { await model.reload() }
  try await waitForQuickAction(fixture)
  model.connect(nil)
  await fixture.release()
  await read.value
  #expect(model.target == nil && model.item == nil && !model.loading && !model.executing)
}

@MainActor @Test func ambiguousWritesBlockRepetitionUntilExplicitSourceReconciliation() async throws {
  let fixture = WorkItemActionFixture()
  let model = try quickActionModel(fixture)
  await model.open(try quickActionTarget())
  let review = try prepareQuickAction(model)
  await fixture.configure(fail: "update")
  await model.confirm(review)
  #expect(model.uncertain && model.pending && model.stale)
  await model.confirm(review)
  await model.reload()
  model.close()
  await model.open(try quickActionTarget())
  #expect(await fixture.count("update") == 1 && model.target != nil)
  model.acknowledgeUncertain()
  #expect(model.target == nil && !model.pending)
}

@MainActor @Test func oneStepSourcesStillRequireReviewAndUseTheGlobalScope() async throws {
  let fixture = WorkItemActionFixture()
  await fixture.configure(workflow: false)
  let model = try quickActionModel(fixture)
  await model.open(try quickActionTarget(), mode: .status)
  #expect(model.selectedID == "complete" && model.canReview)
  model.prepareReview()
  let review = try #require(model.review)
  await model.confirm(review)
  let request = try #require(await fixture.requests.last)
  let input = try body(request)["input"] as! [String: Any]
  #expect(request.url?.path == "/api/integrations/fixture/actions/update")
  #expect(input["statusCategory"] as? String == "done" && input["currentStatus"] as? String == "developing")
  #expect(input["fields"] == nil && input["transitionId"] == nil)
}

@MainActor @Test func invalidationDuringVerificationStopsTheWriteAndDisconnectedReceiptsCannotRefreshAnotherSession()
  async throws
{
  let fixture = WorkItemActionFixture()
  let model = try quickActionModel(fixture)
  await model.open(try quickActionTarget())
  let staleReview = try prepareQuickAction(model)
  await fixture.configure(hold: "get")
  let checking = Task { await model.confirm(staleReview) }
  try await waitForQuickAction(fixture)
  model.invalidate()
  await fixture.release()
  await checking.value
  #expect(await fixture.count("update") == 0)
  #expect(model.stale && !model.uncertain && !model.executing)
  await model.reload()
  let reviewed = try prepareQuickAction(model)
  var received = false
  model.completed = { _ in received = true }
  await fixture.configure(hold: "update")
  let writing = Task { await model.confirm(reviewed) }
  try await waitForQuickAction(fixture)
  model.connect(nil)
  await fixture.release()
  await writing.value
  #expect(model.target == nil && model.item == nil && !model.executing && !received)
}

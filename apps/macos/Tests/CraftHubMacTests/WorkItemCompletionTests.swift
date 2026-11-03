import CraftHubMacCore
import CryptoKit
import Foundation
import Testing

@testable import CraftHubMac

actor CompletionFixture {
  var requests: [URLRequest] = []
  var account = "session"
  var workflow = false
  var writable = true
  var failWrite = false
  var rejectWrite = false
  var wrongReceipt = false
  var status = "inProgress"
  var holdWrite = false
  var waiter: CheckedContinuation<Void, Never>?
  func configure(
    account: String = "session", workflow: Bool = false, writable: Bool = true,
    failWrite: Bool = false, rejectWrite: Bool = false, wrongReceipt: Bool = false, holdWrite: Bool = false
  ) {
    self.account = account
    self.workflow = workflow
    self.writable = writable
    self.failWrite = failWrite
    self.rejectWrite = rejectWrite
    self.wrongReceipt = wrongReceipt
    self.holdWrite = holdWrite
  }
  func release() {
    waiter?.resume()
    waiter = nil
  }
  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    let action = request.url!.lastPathComponent
    var code = 200
    let json: [String: Any]
    if action == "integrations" {
      var actions: [[String: Any]] = [
        [
          "id": "connection", "title": "Connection", "operation": "connection.status", "effect": "remote-read",
          "effectiveConfirmation": "never",
        ],
        [
          "id": "status", "title": "Complete", "operation": "work-items.update-status", "effect": "remote-write",
          "effectiveConfirmation": writable ? "always" : "never",
        ],
      ]
      if workflow {
        actions.append([
          "id": "transitions", "title": "Workflow", "operation": "work-items.transitions", "effect": "remote-read",
          "effectiveConfirmation": "never",
        ])
      }
      // The shipped To Do provider has no work-items.get operation.
      json = ["integrations": [["id": "todos", "actions": actions, "views": []]], "diagnostics": []]
    } else if action == "connection" {
      json = ["version": 1, "kind": "connection", "connection": ["connected": true, "session": ["cacheKey": account]]]
    } else if action == "open" {
      json = ["destination": "application"]
    } else {
      if holdWrite { await withCheckedContinuation { waiter = $0 } }
      if failWrite { throw URLError(.timedOut) }
      if rejectWrite {
        code = 403
        json = ["error": "Write access is required"]
      } else {
        let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
        let input = body["input"] as! [String: Any]
        status = input["statusCategory"] as? String == "done" ? "completed" : input["status"] as! String
        json = [
          "version": 1, "kind": "entity",
          "entity": completionEntity(status: status, container: wrongReceipt ? "other-list" : "inbox"),
        ]
      }
    }
    return (
      try JSONSerialization.data(withJSONObject: json),
      HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: nil)!
    )
  }
  var writes: [URLRequest] { requests.filter { $0.url!.lastPathComponent == "status" } }
}

func completionEntity(status: String = "inProgress", container: String = "inbox") -> [String: Any] {
  [
    "key": "opaque", "id": "task", "title": "Review release", "active": status != "completed", "personal": true,
    "status": status, "statusCategory": status == "completed" ? "done" : "active", "statusUpdateAvailable": true,
    "sourceRef": [
      "providerId": "microsoft-todo", "instanceId": "todos", "accountId": "owner", "containerId": container,
      "kind": "task", "itemId": "task",
    ],
  ]
}

func completionTarget(readOnly: Bool = false, writable: Bool = true) throws -> WorkItemActionTarget {
  var json = completionEntity()
  json["statusUpdateAvailable"] = writable
  return WorkItemActionTarget(
    integrationId: "todos",
    item: try JSONDecoder().decode(
      IntegrationPresentation.Entity.self, from: JSONSerialization.data(withJSONObject: json)),
    readOnly: readOnly, accountKey: SHA256.hash(data: Data("owner".utf8)).map { String(format: "%02x", $0) }.joined(),
    connectionCacheKey: "session")
}

@MainActor func completionModel(_ fixture: CompletionFixture) throws -> WorkItemQuickActionsModel {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  let model = WorkItemQuickActionsModel()
  model.connect(RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) }))
  return model
}

@MainActor @Test func nativeCompletionWritesOnceWithoutOpeningASheetAndUndoRestoresNativeStatus() async throws {
  let fixture = CompletionFixture()
  let actions = try completionModel(fixture)
  let model = actions.completion
  var receipts: [String?] = []
  model.completed = { _, item, _ in receipts.append(item.status) }
  await model.complete(try completionTarget())
  #expect(actions.target == nil && model.notice?.target.item.status == "inProgress")
  #expect(receipts == ["completed"])
  let write = try #require(await fixture.writes.first)
  let body = try JSONSerialization.jsonObject(with: write.httpBody!) as! [String: Any]
  #expect(body["confirmed"] as? Bool == true)
  #expect(
    body["reviewedAction"] as? [String: String] == ["operation": "work-items.update-status", "effect": "remote-write"])
  #expect(write.url?.path == "/api/integrations/todos/actions/status")
  #expect((body["input"] as? [String: Any])?["statusCategory"] as? String == "done")
  await model.undo()
  #expect(model.notice == nil && receipts == ["completed", "inProgress"])
  #expect(await fixture.writes.count == 2)
  #expect(
    await fixture.requests.allSatisfy {
      !$0.url!.path.contains("workbench/today") && $0.url!.lastPathComponent != "get"
    })
}

@MainActor @Test func nativeCompletionRejectsReadOnlyWorkflowAndChangedAccountBeforeWriting() async throws {
  let fixture = CompletionFixture()
  let actions = try completionModel(fixture)
  let model = actions.completion
  await model.complete(try completionTarget(readOnly: true))
  await model.complete(try completionTarget(writable: false))
  #expect(await fixture.requests.isEmpty)
  for change in ["account", "workflow", "declaration"] {
    await fixture.configure(
      account: change == "account" ? "other" : "session", workflow: change == "workflow",
      writable: change != "declaration")
    await model.complete(try completionTarget())
    #expect(model.error != nil && !model.pending)
  }
  #expect(await fixture.writes.isEmpty)
}

@MainActor @Test func nativeCompletionKeepsFailedTasksAndBlocksAmbiguousRepetition() async throws {
  let fixture = CompletionFixture()
  let actions = try completionModel(fixture)
  let model = actions.completion
  await fixture.configure(rejectWrite: true)
  await model.complete(try completionTarget())
  #expect(model.error != nil && !model.pending && model.notice == nil)
  await fixture.configure(failWrite: true)
  await model.complete(try completionTarget())
  #expect(model.uncertain && actions.pending && model.notice == nil)
  await model.complete(try completionTarget())
  await model.undo()
  #expect(await fixture.writes.count == 2)
  model.acknowledgeUncertain()
  #expect(!actions.pending)
  await fixture.configure(wrongReceipt: true)
  await model.complete(try completionTarget())
  #expect(model.uncertain && model.notice == nil)
}

@MainActor @Test func nativeCompletionCoalescesClicksAndIgnoresRepliesFromAReplacedRuntime() async throws {
  let fixture = CompletionFixture()
  let actions = try completionModel(fixture)
  let model = actions.completion
  await fixture.configure(holdWrite: true)
  let target = try completionTarget()
  let first = Task { await model.complete(target) }
  for _ in 0..<100 {
    if await fixture.waiter != nil { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(model.pending && actions.pending)
  await model.complete(target)
  await actions.open(target)
  #expect(await fixture.writes.count == 1 && actions.target == nil)
  actions.connect(nil)
  await fixture.release()
  await first.value
  #expect(model.notice == nil && !model.pending)
}

@MainActor @Test func nativeTodoOpeningUsesTheFixedRuntimeShortcut() async throws {
  let fixture = CompletionFixture()
  let actions = try completionModel(fixture)
  await actions.completion.openMicrosoftTodo()
  let request = try #require(await fixture.requests.last)
  #expect(request.url?.path == "/api/applications/microsoft-todo/open" && request.httpMethod == "POST")
  #expect(try JSONSerialization.jsonObject(with: request.httpBody!) as? [String: String] == [:])
}

@MainActor @Test func nativeCompletionRetainsUndoAfterARejectedReopenAndBlocksItAfterAccountChanges() async throws {
  let fixture = CompletionFixture()
  let actions = try completionModel(fixture)
  let model = actions.completion
  await model.complete(try completionTarget())
  await fixture.configure(rejectWrite: true)
  await model.undo()
  #expect(model.notice != nil && model.error != nil && !model.pending)
  await fixture.configure(account: "other-session")
  await model.undo()
  #expect(model.notice != nil && model.error != nil && !model.pending)
  #expect(await fixture.writes.count == 2)
  await fixture.configure()
  await model.undo()
  #expect(model.notice == nil && model.error == nil)
  #expect(await fixture.status == "inProgress")
}

@MainActor @Test func nativeCompletionInvalidatedDuringAWrittenRequestRequiresSourceReconciliation() async throws {
  let fixture = CompletionFixture()
  let actions = try completionModel(fixture)
  let model = actions.completion
  var received = false
  model.completed = { _, _, _ in received = true }
  await fixture.configure(holdWrite: true)
  let target = try completionTarget()
  let write = Task { await model.complete(target) }
  for _ in 0..<100 {
    if await fixture.waiter != nil { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  actions.invalidate()
  await fixture.release()
  await write.value
  #expect(model.uncertain && model.notice == nil && !received)
  await model.complete(target)
  #expect(await fixture.writes.count == 1)
  model.acknowledgeUncertain()
  await actions.open(try completionTarget(readOnly: true))
  await model.complete(target)
  #expect(await fixture.writes.count == 1)
}

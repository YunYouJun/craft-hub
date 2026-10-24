import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private let formCatalog = #"""
  {"integrations":[{"id":"fixture-plugin","actions":[
  {"id":"save","title":"Save","operation":"resources.update","effect":"local-write","effectiveConfirmation":"always"},
  {"id":"read","title":"Read","operation":"resources.read","effect":"remote-read","effectiveConfirmation":"never"}],
  "views":[{"id":"files","title":"Files","scope":"global-and-project","blocks":[
  {"id":"form","type":"action-form","actionId":"save","fields":[{"id":"count","label":"Count","type":"number","value":2}]},
  {"id":"browser","type":"resource-browser","actionId":"read"}]}]}],"diagnostics":[]}
  """#

private actor FormFixture {
  var requests: [URLRequest] = []
  var hold: String?
  var waiter: CheckedContinuation<Void, Never>?
  var fails = false
  var needsConfirmation = true
  var expired = false
  var wrongProject = false
  func configure(
    hold: String? = nil, fails: Bool = false, needsConfirmation: Bool = true,
    expired: Bool = false, wrongProject: Bool = false
  ) {
    self.hold = hold
    self.fails = fails
    self.needsConfirmation = needsConfirmation
    self.expired = expired
    self.wrongProject = wrongProject
  }
  func release() {
    waiter?.resume()
    waiter = nil
    hold = nil
  }
  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    let operation = request.url!.lastPathComponent
    if hold == operation { await withCheckedContinuation { waiter = $0 } }
    if operation == "execute" && fails { throw URLError(.timedOut) }
    let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    if operation == "integrations" { return (Data(formCatalog.utf8), response) }
    var json: [String: Any] = ["version": 1]
    if operation == "prepare" {
      json.merge([
        "planId": "one-use", "title": "Save", "effect": needsConfirmation ? "local-write" : "remote-read",
        "operation": needsConfirmation ? "resources.update" : "resources.read",
        "requiresConfirmation": needsConfirmation,
        "expiresAt": ISO8601DateFormatter().string(from: Date().addingTimeInterval(expired ? -1 : 600)),
        "fields": [["label": "Count", "value": "200"]],
      ]) { _, next in next }
      if request.url!.path.contains("/projects/") || wrongProject {
        json["project"] = ["id": wrongProject ? "other" : "project-123", "name": "Fixture", "trust": "trusted"]
      }
    } else if operation == "execute" || operation == "read" {
      json.merge([
        "kind": "resources",
        "resources": [
          "kind": "resource-page", "title": "Files", "input": ["resource": "files"],
          "forms": [
            [
              "id": "save", "title": "Save", "effect": "update", "input": ["operation": "save"],
              "fields": [["id": "content", "label": "Content", "type": "textarea", "value": "original"]],
            ]
          ],
        ],
      ]) { _, next in next }
    }
    return (try JSONSerialization.data(withJSONObject: json), response)
  }
}

private func formClient(_ fixture: FormFixture) throws -> RuntimeAPIClient {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  return RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) })
}
@MainActor private func openForm(_ fixture: FormFixture, project: String? = nil) async throws -> IntegrationFormModel {
  let model = IntegrationFormModel()
  await model.open(
    client: try formClient(fixture), integration: "fixture-plugin", project: project,
    selector: .init(viewId: "files", blockId: "form"))
  return model
}
private func waitForForm(_ fixture: FormFixture) async throws {
  for _ in 0..<100 {
    if await fixture.waiter != nil { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("Form request was not held")
}
private func formBody(_ request: URLRequest) throws -> [String: Any] {
  try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
}

@MainActor @Test func nativeFormReviewsFreezeInputAndExecuteOnlyAfterConfirmation() async throws {
  let fixture = FormFixture()
  let model = try await openForm(fixture)
  #expect(await fixture.requests.map { $0.url!.lastPathComponent } == ["integrations"])
  let field = try #require(model.fields.first)
  model.edit(field, value: "2e2")
  await model.prepare()
  let plan = try #require(model.plan)
  #expect(model.result == nil && !model.canPrepare)
  let prepared = try #require(await fixture.requests.last)
  #expect(try formBody(prepared)["values"] as? [String: String] == ["count": "2e2"])
  model.edit(field, value: "999")
  #expect(model.value(field) == "2e2")
  await model.execute(plan)
  await model.execute(plan)
  let writes = await fixture.requests.filter { $0.url!.lastPathComponent == "execute" }
  #expect(writes.count == 1)
  #expect(try formBody(writes[0])["planId"] as? String == "one-use")
  #expect(try formBody(writes[0])["input"] == nil)
  #expect(model.result?.kind == "resources" && !model.pending)
}

@MainActor @Test func nativeFormCancellationAndInvalidationNeverSubmitAndDiscardLateReviews() async throws {
  let fixture = FormFixture()
  let model = try await openForm(fixture)
  await model.prepare()
  let cancelled = try #require(model.plan)
  model.cancelReview()
  await model.execute(cancelled)
  await fixture.configure(hold: "prepare")
  let preparing = Task { await model.prepare() }
  try await waitForForm(fixture)
  model.invalidate()
  await fixture.release()
  await preparing.value
  #expect(model.plan == nil && model.stale && !model.canPrepare)
  #expect(await fixture.requests.allSatisfy { $0.url!.lastPathComponent != "execute" })
  #expect(await fixture.requests.contains { $0.url!.lastPathComponent == "discard" })
}

@MainActor @Test func nativeFormUnknownWritesCannotRetryOrDismissUntilAcknowledged() async throws {
  let fixture = FormFixture()
  let model = try await openForm(fixture)
  await model.prepare()
  let plan = try #require(model.plan)
  await fixture.configure(fails: true)
  await model.execute(plan)
  #expect(model.uncertain && model.pending && model.stale)
  model.close()
  await model.reload()
  await model.prepare()
  await model.execute(plan)
  #expect(model.isPresented)
  #expect(await fixture.requests.filter { $0.url!.lastPathComponent == "execute" }.count == 1)
  model.acknowledgeUncertain()
  #expect(!model.pending && model.stale && !model.canPrepare)
  model.close()
  #expect(!model.isPresented)
}

@MainActor @Test func nativeResourceFormUsesCurrentProjectAndUpdatesParentAfterReceipt() async throws {
  let fixture = FormFixture()
  let model = IntegrationFormModel()
  await model.open(
    client: try formClient(fixture), integration: "fixture-plugin", project: "project-123",
    selector: .init(viewId: "files", blockId: "browser", resourceInput: ["resource": .string("files")], formId: "save"))
  #expect(await fixture.requests.map { $0.url!.lastPathComponent } == ["integrations", "read"])
  let field = try #require(model.fields.first)
  #expect(field.type == "textarea" && model.value(field) == "original")
  model.edit(field, value: "\n  draft\n")
  var returned = false
  model.completed = { returned = $0.resources?.title == "Files" }
  await model.prepare()
  await model.execute(try #require(model.plan))
  #expect(returned)
  let writes = await fixture.requests.filter { $0.url!.lastPathComponent == "execute" }
  #expect(writes.first?.url!.path == "/api/projects/project-123/integrations/fixture-plugin/forms/execute")
}

@MainActor @Test func nativeFormReadOnlySubmissionNeedsAnExplicitContinueAndStalePlansCannotRun() async throws {
  let fixture = FormFixture()
  await fixture.configure(needsConfirmation: false)
  let model = try await openForm(fixture)
  #expect(model.result == nil)
  await model.prepare()
  #expect(model.result?.kind == "resources")
  let writes = await fixture.requests.filter { $0.url!.lastPathComponent == "execute" }
  #expect(writes.count == 1)
  let request = try #require(writes.first)
  #expect(try formBody(request)["confirmed"] as? Bool == false)
  await fixture.configure(expired: true)
  await model.reload()
  await model.prepare()
  await model.execute(try #require(model.plan))
  #expect(model.stale && model.plan == nil)
  #expect(await fixture.requests.filter { $0.url!.lastPathComponent == "execute" }.count == 1)
  await fixture.configure(wrongProject: true)
  await model.reload()
  await model.prepare()
  #expect(model.plan == nil && model.error != nil)
}

@MainActor @Test func nativeFormResetRejectsLateWriteReceipts() async throws {
  let fixture = FormFixture()
  let model = try await openForm(fixture)
  await model.prepare()
  let plan = try #require(model.plan)
  await fixture.configure(hold: "execute")
  let writing = Task { await model.execute(plan) }
  try await waitForForm(fixture)
  model.reset()
  await fixture.release()
  await writing.value
  #expect(!model.isPresented && model.result == nil && !model.pending)
}

@MainActor @Test func nativeFormInvalidationAcknowledgesReceiptWithoutRestoringOldAccountData() async throws {
  let fixture = FormFixture()
  let model = try await openForm(fixture)
  await model.prepare()
  let plan = try #require(model.plan)
  var returned = false
  model.completed = { _ in returned = true }
  await fixture.configure(hold: "execute")
  let writing = Task { await model.execute(plan) }
  try await waitForForm(fixture)
  model.invalidate()
  await fixture.release()
  await writing.value
  #expect(model.receiptNeedsRefresh && model.stale && !model.pending && !returned)
  #expect(model.result == nil && !model.canPrepare)
  model.close()
  #expect(!model.isPresented)
}

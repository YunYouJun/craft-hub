import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private let connectionCatalog = #"""
  {"integrations":[{"id":"fixture","actions":[
  {"id":"status","title":"Status","operation":"connection.status","effect":"remote-read","effectiveConfirmation":"never"},
  {"id":"connect","title":"Connect","operation":"connection.update","effect":"local-write","effectiveConfirmation":"always"}],
  "views":[{"id":"view","title":"Fixture","scope":"global-and-project","blocks":[{"id":"connection","type":"connection-status","actionId":"status"}]}]}],"diagnostics":[]}
  """#

private actor NativeConnectionFixture {
  var requests: [URLRequest] = []
  var connected = false
  var writable = false
  var pending = false
  var method = "token"
  var fail = false
  var hold: String?
  var waiter: CheckedContinuation<Void, Never>?
  let expiry = "2030-01-01T00:01:00Z"
  func configure(
    connected: Bool = false, writable: Bool = false, pending: Bool = false,
    method: String = "token", fail: Bool = false, hold: String? = nil
  ) {
    self.connected = connected
    self.writable = writable
    self.pending = pending
    self.method = method
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
    let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    if action == "integrations" { return (Data(connectionCatalog.utf8), response) }
    if hold == action { await withCheckedContinuation { waiter = $0 } }
    if fail { throw RuntimeAPIError.rejected(500, "provider echoed fixture-secret") }
    var status: [String: Any] = [
      "connected": connected, "capabilities": ["create": writable], "reviewRevision": "revision",
      "forms": [
        [
          "id": method, "title": "Connect", "submitLabel": "Submit",
          "fields": method == "token"
            ? [
              ["id": "token", "label": "Token", "type": "password", "required": true, "value": "must-not-prefill"],
              ["id": "account", "label": "Account", "type": "text", "value": "fixture"],
            ] : [],
        ]
      ],
    ]
    if action == "connect" {
      status["reviewRevision"] = "after"
      if method == "oauth" { status["authorizationUrl"] = "https://example.com/authorize?state=fixture" }
      if method == "token" { status["connected"] = true }
    }
    if pending || (action == "connect" && method == "device-code") {
      status["deviceAuthorization"] = [
        "verificationUrl": "https://example.com/device", "userCode": "TEST1234", "expiresAt": expiry,
      ]
    }
    return (
      try JSONSerialization.data(withJSONObject: ["version": 1, "kind": "connection", "connection": status]), response
    )
  }
}

@MainActor private func openConnection(_ model: IntegrationConnectionModel, _ fixture: NativeConnectionFixture)
  async throws
{
  let catalog = try JSONDecoder().decode(NativeIntegrationCatalog.self, from: Data(connectionCatalog.utf8))
  let contribution = catalog.integrations[0]
  let entry = IntegrationWorkbenchModel.Entry(contribution: contribution, view: contribution.views[0])
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  await model.open(
    client: RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) }),
    entry: entry, block: entry.view.blocks[0], project: "reviewed-project")
}
private func waitForConnection(_ fixture: NativeConnectionFixture) async throws {
  for _ in 0..<100 {
    if await fixture.waiter != nil { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("Connection request was not held")
}

@MainActor @Test func nativeConnectionReviewFreezesScopeMasksCredentialsAndNeverSubmitsOnCancel() async throws {
  let fixture = NativeConnectionFixture()
  let model = IntegrationConnectionModel(
    automaticallyPoll: false,
    openExternal: { _ in
      Issue.record("Unexpected URL")
      return false
    })
  try await openConnection(model, fixture)
  let form = try #require(model.snapshot?.forms?.first)
  let token = form.fields[0]
  #expect(model.value(form, token).isEmpty && !model.canSubmit(form))
  model.edit(form, token, "fixture-secret")
  model.prepare(form)
  let cancelled = try #require(model.review)
  #expect(!cancelled.fields.contains { $0.value.contains("fixture-secret") })
  model.cancelReview()
  #expect(model.value(form, token).isEmpty)
  await model.confirm(cancelled)
  #expect(await fixture.requests.count == 1)
  model.edit(form, token, "fixture-secret")
  model.prepare(form)
  let review = try #require(model.review)
  model.edit(form, token, "changed-after-review")
  await model.confirm(review)
  await model.confirm(review)
  #expect(model.values.isEmpty && model.review == nil && !model.uncertain)
  let writes = await fixture.requests.filter { $0.url?.lastPathComponent == "connect" }
  #expect(
    writes.count == 1 && writes[0].url?.path == "/api/projects/reviewed-project/integrations/fixture/actions/connect")
  let body = try JSONSerialization.jsonObject(with: writes[0].httpBody!) as! [String: Any]
  #expect((body["input"] as? [String: Any])?["token"] as? String == "fixture-secret")
  #expect(body["reviewedConnection"] as? String == "revision" && body["confirmed"] as? Bool == true)
  #expect(body["reviewedAction"] as? [String: String] == ["operation": "connection.update", "effect": "local-write"])
  model.close()
  #expect(!model.isPresented && model.snapshot == nil)
}

@MainActor @Test func connectionFailuresDoNotExposeSecretsOrRetryAndRequireFreshStatus() async throws {
  let fixture = NativeConnectionFixture()
  let model = IntegrationConnectionModel(automaticallyPoll: false)
  try await openConnection(model, fixture)
  let form = try #require(model.snapshot?.forms?.first)
  model.edit(form, form.fields[0], "fixture-secret")
  model.prepare(form)
  await fixture.configure(fail: true)
  await model.confirm(try #require(model.review))
  #expect(model.uncertain && model.pending && model.value(form, form.fields[0]).isEmpty)
  #expect(model.error?.contains("fixture-secret") == false)
  model.close()
  #expect(model.isPresented)
  model.prepare(form)
  #expect(model.review == nil)
  await fixture.configure()
  await model.load()
  #expect(!model.uncertain && !model.stale)
  #expect(await fixture.requests.filter { $0.url?.lastPathComponent == "connect" }.count == 1)
  model.edit(form, form.fields[0], "fixture-secret")
  model.prepare(form)
  await fixture.configure(fail: true)
  await model.confirm(try #require(model.review))
  model.acknowledgeUncertain()
  #expect(!model.pending && model.stale && !model.canSubmit(form))
  model.close()
  #expect(!model.isPresented)
}

@MainActor @Test func deviceAuthorizationPreservesPendingWriteGrantsAndStopsOnCompletionExpiryOrUserPause() async throws
{
  let fixture = NativeConnectionFixture()
  var now = ISO8601DateFormatter().date(from: "2030-01-01T00:00:00Z")!
  var opened: [URL] = []
  let model = IntegrationConnectionModel(
    automaticallyPoll: false, now: { now },
    openExternal: {
      opened.append($0)
      return true
    })
  await fixture.configure(connected: true, method: "device-code")
  try await openConnection(model, fixture)
  model.prepare(try #require(model.snapshot?.forms?.first))
  await model.confirm(try #require(model.review))
  #expect(model.authorization?.code == "TEST1234" && model.watching)
  #expect(opened.map(\.absoluteString) == ["https://example.com/device"])
  await model.poll()
  // A still-read-only status without the pending code is not a completed write grant.
  #expect(model.authorization != nil)
  model.stopWatching(userInitiated: true)
  let count = await fixture.requests.count
  await model.poll()
  #expect(await fixture.requests.count == count)
  await fixture.configure(connected: true, pending: true, method: "device-code")
  await model.load()
  #expect(!model.watching)
  model.startWatching(userInitiated: true)
  await fixture.configure(connected: true, writable: true, method: "device-code")
  await model.poll()
  #expect(model.authorization == nil && !model.watching)
  await fixture.configure(pending: true, method: "device-code")
  await model.load()
  #expect(model.watching)
  now = now.addingTimeInterval(61)
  await model.poll()
  #expect(!model.watching && model.authorization == nil && model.stale)
  #expect(opened.count == 1)  // Reads never reopen authorization automatically.
}

@MainActor @Test func connectionInvalidationAndReplacementDiscardReviewsSecretsAndLateAuthorization() async throws {
  let fixture = NativeConnectionFixture()
  var opened: [URL] = []
  let model = IntegrationConnectionModel(
    automaticallyPoll: false,
    openExternal: {
      opened.append($0)
      return true
    })
  try await openConnection(model, fixture)
  let form = try #require(model.snapshot?.forms?.first)
  model.edit(form, form.fields[0], "fixture-secret")
  model.prepare(form)
  let old = try #require(model.review)
  model.invalidate(hard: true)
  #expect(model.value(form, form.fields[0]).isEmpty)
  await model.confirm(old)
  #expect(await fixture.requests.count == 1)
  await fixture.configure(method: "oauth")
  await model.load()
  model.prepare(try #require(model.snapshot?.forms?.first))
  let review = try #require(model.review)
  await fixture.configure(method: "oauth", hold: "connect")
  let pending = Task { await model.confirm(review) }
  try await waitForConnection(fixture)
  model.reset()
  await fixture.release()
  await pending.value
  #expect(!model.isPresented && !model.busy && model.authorization == nil && opened.isEmpty)
}

@MainActor @Test func changedPluginMetadataCannotOpenAnOldOAuthResponseAndFreshReadRecovers() async throws {
  let fixture = NativeConnectionFixture()
  var opened: [URL] = []
  let model = IntegrationConnectionModel(
    automaticallyPoll: false,
    openExternal: {
      opened.append($0)
      return true
    })
  await fixture.configure(method: "oauth")
  try await openConnection(model, fixture)
  model.prepare(try #require(model.snapshot?.forms?.first))
  let review = try #require(model.review)
  await fixture.configure(method: "oauth", hold: "connect")
  let pending = Task { await model.confirm(review) }
  try await waitForConnection(fixture)
  model.invalidate(hard: true)
  await fixture.release()
  await pending.value
  #expect(model.uncertain && model.authorization == nil && opened.isEmpty)
  await model.load()
  #expect(!model.uncertain && !model.stale)
  #expect(await fixture.requests.contains { $0.url?.lastPathComponent == "integrations" })
  model.prepare(try #require(model.snapshot?.forms?.first))
  await model.confirm(try #require(model.review))
  #expect(opened.map(\.absoluteString) == ["https://example.com/authorize?state=fixture"])
  #expect(model.watching && model.authorization?.code == nil)
  await fixture.configure(connected: true, method: "oauth")
  await model.poll()
  #expect(model.authorization == nil && !model.watching)
}

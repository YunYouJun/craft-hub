import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private let sourceJSON =
  #"{"id":"012345678901234567890123","title":"Fixture","repository":"https://example.com/repo","mode":"remote","branch":"main","catalogPath":"software.config.ts","checkedAt":"2026-10-23T00:00:00Z","cache":{"readFrom":"remote","savedAt":"2026-10-23T00:00:00Z","revision":"catalog-1","itemCount":1}}"#
private func sourcesJSON(_ revision: String) -> String {
  "{\"version\":1,\"revision\":\"\(revision)\",\"localAvailable\":true,\"sources\":[\(sourceJSON)]}"
}
private let previewJSON = """
  {"previewId":"reviewed-token","source":\(sourceJSON),"catalog":{"version":1,"revision":"catalog-1","items":[{"id":"tool","title":{"en":"Tool"},"installation":{"kind":"manual"}}]}}
  """
private actor SourceFixture {
  var requests: [URLRequest] = []
  var revision = "sources-1"
  var hold = ""
  var rejectMutation = false
  var waiter: CheckedContinuation<Void, Never>?
  private let heldRequests = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
  func configure(hold: String = "", reject: Bool = false) {
    self.hold = hold
    rejectMutation = reject
  }
  func release() {
    waiter?.resume()
    waiter = nil
    hold = ""
  }
  func waitUntilHeld() async throws {
    try await requireHeldResponse(heldRequests.stream) { await self.release() }
  }
  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    #expect(request.url?.path == "/api/software-sources")
    let body = try request.httpBody.map { try JSONSerialization.jsonObject(with: $0) as! [String: Any] }
    let operation = body?["operation"] as? String ?? "get"
    let json: String
    var status = 200
    if operation == "preview" {
      json = previewJSON
    } else if operation == "get" {
      json = sourcesJSON(revision)
    } else if rejectMutation {
      status = 409
      json = #"{"error":"Source revision changed. Reload before retrying."}"#
    } else {
      revision = "sources-2"
      json = sourcesJSON(revision)
    }
    if operation == hold {
      await withCheckedContinuation {
        waiter = $0
        heldRequests.continuation.yield(())
      }
    }
    return (
      Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    )
  }
}
@MainActor private func makeSources(_ fixture: SourceFixture) throws -> SoftwareSourcesModel {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  return SoftwareSourcesModel(
    client: RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) }))
}
@MainActor @Test func softwareSourceEditsInvalidateApprovalAndOnlyTheReviewedTokenCanBeApplied() async throws {
  let fixture = SourceFixture()
  let model = try makeSources(fixture)
  await model.load()
  #expect(await fixture.requests.map(\.httpMethod) == ["GET"])
  model.edit()
  model.draft.repository = "https://example.com/repo"
  await model.inspect()
  #expect(model.preview?.previewId == "reviewed-token")
  model.draft.branch = "next"
  #expect(model.preview == nil)
  await model.apply()
  #expect(await fixture.requests.count == 2)
  await model.inspect()
  await model.apply()
  let last = try #require(await fixture.requests.last?.httpBody)
  let body = try JSONSerialization.jsonObject(with: last) as! [String: String]
  #expect(body == ["operation": "apply", "previewId": "reviewed-token"])
  #expect(!model.editing && model.preview == nil && model.snapshot?.revision == "sources-2")
}

@MainActor @Test func changedOrDisconnectedSoftwareSourceDraftCannotReceiveALatePreview() async throws {
  let fixture = SourceFixture()
  let model = try makeSources(fixture)
  model.edit()
  model.draft.repository = "https://example.com/repo"
  await fixture.configure(hold: "preview")
  let first = Task { await model.inspect() }
  try await fixture.waitUntilHeld()
  model.draft.localPath = "/fixture/checkout"
  await fixture.release()
  await first.value
  #expect(model.preview == nil)
  await fixture.configure(hold: "preview")
  let second = Task { await model.inspect() }
  try await fixture.waitUntilHeld()
  model.disconnect()
  await fixture.release()
  await second.value
  #expect(model.preview == nil && !model.editing && !model.busy)
}

@MainActor @Test(arguments: [Duration.zero, .seconds(1)])
func oldSoftwareSourceReadCannotReplaceANewerMutationReceipt(requestDelay: Duration) async throws {
  let fixture = SourceFixture()
  let model = try makeSources(fixture)
  await model.load()
  await fixture.configure(hold: "get")
  let old = Task {
    try? await Task.sleep(for: requestDelay)
    await model.load(force: true)
  }
  try await fixture.waitUntilHeld()
  let saved = await model.configure("012345678901234567890123", revision: "sources-1", policy: .init(mode: "manual"))
  #expect(saved && model.snapshot?.revision == "sources-2")
  await fixture.release()
  await old.value
  #expect(model.snapshot?.revision == "sources-2")
}

@MainActor @Test func softwareRefreshAndRemovalUseTheExplicitlyReviewedRevisionAndPreserveDraftOnConflict() async throws
{
  let fixture = SourceFixture()
  let model = try makeSources(fixture)
  await model.load()
  model.edit()
  model.draft.branch = "kept-draft"
  await fixture.configure(reject: true)
  let saved = await model.configure(
    "012345678901234567890123", revision: "reviewed-revision",
    policy: .init(mode: "daily", time: "09:30", timeZone: "UTC"))
  #expect(!saved && model.error != nil && model.draft.branch == "kept-draft")
  let source = try #require(model.snapshot?.sources.first)
  await model.remove(source, revision: "removal-revision")
  let bodies = try await fixture.requests.compactMap(\.httpBody).map {
    try JSONSerialization.jsonObject(with: $0) as! [String: Any]
  }
  #expect(bodies[0]["revision"] as? String == "reviewed-revision")
  #expect(bodies[1]["revision"] as? String == "removal-revision")
  let policy = try #require(bodies[0]["refreshPolicy"] as? [String: String])
  #expect(policy == ["mode": "daily", "time": "09:30", "timeZone": "UTC"])
  #expect(model.snapshot?.revision == "sources-1")
}

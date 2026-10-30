import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private let profileSoftware =
  #"{"sourceId":"fixture","softwareId":"tool","title":{"en":"Tool","zh":"工具"},"url":"https://example.com/tool","installation":{"kind":"brew-formula","packageId":"fixture-tool"}}"#
private let profileConfiguration =
  #"{"integrationId":"fixture","itemId":"terminal","title":"Terminal","kind":"terminal","origin":"private","sourceDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#
private let profileJSON = """
  {"version":1,"platform":"darwin","name":"Fixture","software":[\(profileSoftware)],"configurations":[\(profileConfiguration)]}
  """
private actor ProfileFixture {
  var requests: [URLRequest] = []
  var version = "revision-1"
  var setupRevision: String?
  var hold = ""
  var reject = ""
  var waiter: CheckedContinuation<Void, Never>?
  private let heldRequests = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
  func configure(version: String? = nil, setupRevision: String? = nil, hold: String = "", reject: String = "") {
    if let version { self.version = version }
    self.setupRevision = setupRevision
    self.hold = hold
    self.reject = reject
  }
  func release() {
    waiter?.resume()
    waiter = nil
    hold = ""
  }
  func waitForHeldRequest() async -> Bool {
    var iterator = heldRequests.stream.makeAsyncIterator()
    return await iterator.next() != nil
  }
  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    let body = try request.httpBody.map { try JSONSerialization.jsonObject(with: $0) as! [String: Any] }
    let operation = request.url?.path == "/api/environment/setup" ? "setup" : (body?["operation"] as? String ?? "get")
    let json: String
    var status = 200
    func snapshot() -> String { "{\"version\":1,\"revision\":\"\(version)\",\"profile\":\(profileJSON)}" }
    if operation == reject {
      json = #"{"error":"Profile changed or import invalid. Reload and review."}"#
      status = 409
    } else {
      switch operation {
      case "inventory":
        json =
          "{\"software\":[{\"reference\":\(profileSoftware),\"status\":\"unknown\",\"canInstall\":false}],\"configurations\":[{\"reference\":\(profileConfiguration),\"status\":\"synced\",\"href\":\"/integrations/fixture\"}],\"unavailableIntegrations\":[]}"
      case "review":
        json =
          "{\"snapshot\":\(snapshot()),\"software\":[{\"reference\":\(profileSoftware),\"state\":\"unknown\",\"canInstall\":false}],\"configurations\":[{\"reference\":\(profileConfiguration),\"state\":\"review\",\"href\":\"/integrations/fixture\"}]}"
      case "setup":
        json =
          "{\"version\":1,\"profileRevision\":\"\(setupRevision ?? version)\",\"checkedAt\":\"2026-10-23T00:00:00Z\",\"platform\":\"darwin\",\"steps\":[{\"id\":\"git\",\"title\":{\"en\":\"Git\"},\"description\":{\"en\":\"Check tools\"},\"state\":\"unknown\",\"dependsOn\":[],\"actions\":[{\"kind\":\"copy\",\"title\":{\"en\":\"Copy\"},\"text\":\"fixture --install\"}]}],\"prerequisitesReady\":false}"
      case "save", "import":
        version = "revision-2"
        json = snapshot()
      default: json = snapshot()
      }
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
private func profileClient(_ fixture: ProfileFixture) throws -> RuntimeAPIClient {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  return RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) })
}
private func held(_ fixture: ProfileFixture) async throws {
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
  try #require(held, "Profile request was not held")
}

@MainActor @Test func environmentProfileSaveUsesSelectionsAndTheExplicitDraftRevision() async throws {
  let fixture = ProfileFixture()
  let model = EnvironmentProfileModel(client: try profileClient(fixture))
  await model.load()
  model.name = "My draft"
  await fixture.configure(version: "external-revision")
  await model.load(force: true)
  #expect(model.name == "My draft" && model.draftRevision == "revision-1" && !model.canSave)
  let count = await fixture.requests.count
  await model.save()
  #expect(await fixture.requests.count == count)
  model.acceptCurrentRevision()
  await model.save()
  let request = try #require(await fixture.requests.last?.httpBody)
  let body = try JSONSerialization.jsonObject(with: request) as! [String: Any]
  #expect(Set(body.keys) == Set(["operation", "revision", "name", "software", "configurations"]))
  #expect(body["revision"] as? String == "external-revision")
  #expect(body["name"] as? String == "My draft")
  #expect(body["software"] as? [[String: String]] == [["sourceId": "fixture", "softwareId": "tool"]])
  #expect(body["configurations"] as? [[String: String]] == [["integrationId": "fixture", "itemId": "terminal"]])
  #expect(model.snapshot?.revision == "revision-2")
}

@MainActor @Test func environmentProfileImportPreservesUnknownFieldsForRuntimeRejectionAndRequiresFreshRecovery()
  async throws
{
  let fixture = ProfileFixture()
  let model = EnvironmentProfileModel(client: try profileClient(fixture))
  await model.load()
  model.imported = #"{"version":1,"machinePath":"/fixture/private"}"#
  await fixture.configure(reject: "import")
  #expect(await !model.importProfile(json: model.imported, revision: "revision-1"))
  let body = try JSONSerialization.jsonObject(with: #require(await fixture.requests.last?.httpBody)) as! [String: Any]
  #expect((body["profile"] as? [String: Any])?["machinePath"] as? String == "/fixture/private")
  #expect(model.uncertain && model.stale && !model.canSave && !model.imported.isEmpty)
  let count = await fixture.requests.count
  #expect(await !model.importProfile(json: model.imported, revision: "revision-1"))
  await model.save()
  #expect(await fixture.requests.count == count)
  await fixture.configure()
  await model.load(force: true)
  #expect(!model.uncertain && !model.stale && !model.imported.isEmpty)
  // Confirmation from before an external edit cannot silently use the newly loaded revision.
  await fixture.configure(version: "external-revision")
  await model.load(force: true)
  #expect(await !model.importProfile(json: profileJSON, revision: "revision-1"))
  #expect(
    await fixture.requests.last?.httpBody.flatMap { String(data: $0, encoding: .utf8) }?.contains("inventory") == true)
}

@MainActor @Test func environmentReadinessRequiresMatchingProfileRevisionsAndNeverExecutesGuidance() async throws {
  let fixture = ProfileFixture()
  let model = EnvironmentProfileModel(client: try profileClient(fixture))
  await model.load()
  await fixture.configure(setupRevision: "different-profile")
  await model.check()
  #expect(model.review == nil && model.setup == nil && model.error != nil)
  await fixture.configure()
  await model.check()
  #expect(model.review?.software.first?.state == "unknown" && model.setup?.prerequisitesReady == false)
  #expect(model.setup?.steps.first?.actions.first?.text == "fixture --install")
  let operations = try await fixture.requests.compactMap(\.httpBody).map {
    try JSONSerialization.jsonObject(with: $0) as! [String: String]
  }
  #expect(operations.allSatisfy { ["inventory", "review"].contains($0["operation"] ?? "") })
  await fixture.configure(reject: "get")
  await model.load(force: true)
  #expect(model.stale && model.review == nil && model.setup == nil)
}

@MainActor @Test(arguments: [Duration.zero, .seconds(1)])
func environmentInvalidationAndDisconnectDiscardLateObservations(requestDelay: Duration) async throws {
  let fixture = ProfileFixture()
  let model = EnvironmentProfileModel(client: try profileClient(fixture))
  await model.load()
  await fixture.configure(hold: "setup")
  let checking = Task {
    try? await Task.sleep(for: requestDelay)
    await model.check()
  }
  try await held(fixture)
  model.invalidate()
  await fixture.release()
  await checking.value
  #expect(model.stale && model.review == nil && model.setup == nil)
  await fixture.configure(hold: "get")
  let loading = Task { await model.load(force: true) }
  try await held(fixture)
  model.disconnect()
  await fixture.release()
  await loading.value
  #expect(model.stale && !model.busy && !model.canSave)
}

@Test func portableEnvironmentProfileExportRoundTripsAndOversizedImportNeverSends() async throws {
  let profile = try JSONDecoder().decode(EnvironmentProfile.self, from: Data(profileJSON.utf8))
  let exported = try JSONSerialization.jsonObject(with: profile.exported()) as! NSDictionary
  #expect(exported == (try JSONSerialization.jsonObject(with: Data(profileJSON.utf8)) as! NSDictionary))
  let fixture = ProfileFixture()
  let client = try profileClient(fixture)
  do {
    _ = try await client.importEnvironmentProfile(Data(repeating: 32, count: 256 * 1024 + 1), revision: "revision-1")
    Issue.record("Oversized import was accepted")
  } catch {}
  #expect(await fixture.requests.isEmpty)
}

@MainActor @Test func environmentProfileReadRechecksAnInvalidationThatArrivesDuringLoading() async throws {
  let fixture = ProfileFixture()
  let model = EnvironmentProfileModel(client: try profileClient(fixture))
  await fixture.configure(hold: "get")
  let loading = Task { await model.load() }
  try await held(fixture)
  await fixture.configure(version: "new-revision")
  model.invalidate()
  await fixture.release()
  await loading.value
  #expect(!model.stale && model.snapshot?.revision == "new-revision")
  #expect(model.draftRevision == "new-revision")
  #expect(await fixture.requests.filter { $0.httpMethod == "GET" }.count == 2)
}

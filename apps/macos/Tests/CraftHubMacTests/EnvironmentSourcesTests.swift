import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private actor ConnectionFixture {
  var requests: [URLRequest] = []
  var state = ""
  var phase = "cloning"
  var hold = ""
  var fail = ""
  var waiter: CheckedContinuation<Void, Never>?
  let jobID = "11111111-1111-4111-8111-111111111111"
  func configure(state: String? = nil, phase: String = "cloning", hold: String = "", fail: String = "") {
    if let state { self.state = state }
    self.phase = phase
    self.hold = hold
    self.fail = fail
  }
  func release() {
    waiter?.resume()
    waiter = nil
    hold = ""
  }
  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    #expect(request.url?.path == "/api/environment/sources")
    requests.append(request)
    let body = try request.httpBody.map { try JSONSerialization.jsonObject(with: $0) as! [String: Any] }
    let operation = body?["operation"] as? String ?? "get"
    if operation == fail { throw NSError(domain: "fixture-secret-must-not-appear", code: 1) }
    if operation == "connect" { state = "authentication-required" }
    if operation == "authenticate" { state = "connecting" }
    if operation == "cancel" { state = "cancelled" }
    let jobs =
      state.isEmpty
      ? ""
      : """
      {"id":"\(jobID)","providerId":"fixture","repository":"https://example.com/config.git","kind":"private","state":"\(state)","phase":"\(phase)","expiresAt":"2026-10-24T00:00:00Z"}
      """
    let json =
      "{\"providers\":[{\"id\":\"fixture\",\"name\":\"Fixture\",\"kinds\":[\"public\",\"private\"]}],\"connections\":[\(jobs)]}"
    if operation == hold { await withCheckedContinuation { waiter = $0 } }
    return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
}
@MainActor private func connectionModel(_ fixture: ConnectionFixture) throws -> EnvironmentSourcesModel {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  return EnvironmentSourcesModel(
    client: RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) }))
}
private func held(_ fixture: ConnectionFixture) async throws {
  for _ in 0..<100 {
    if await fixture.waiter != nil { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("The connection fixture did not hold its response")
}

@MainActor @Test func environmentConnectionOnlyStartsExplicitlyAndAuthenticationTargetsTheReviewedJob() async throws {
  let fixture = ConnectionFixture()
  let model = try connectionModel(fixture)
  await model.load()
  #expect(await fixture.requests.map(\.httpMethod) == ["GET"])
  model.repository = "https://example.com/config.git"
  await model.connect()
  let job = try #require(model.active)
  let requests = await fixture.requests
  let connect = try JSONSerialization.jsonObject(with: #require(requests.last?.httpBody)) as! [String: String]
  #expect(
    connect == [
      "operation": "connect", "providerId": "fixture", "kind": "private",
      "repository": "https://example.com/config.git",
    ])
  #expect(!model.canConnect && model.pending)
  await model.authenticate(job, username: "fixture-user", token: "fixture-token")
  let body = try JSONSerialization.jsonObject(with: #require(await fixture.requests.last?.httpBody)) as! [String: Any]
  #expect(Set(body.keys) == Set(["operation", "id", "credentials"]))
  #expect(body["id"] as? String == job.id)
  #expect(body["credentials"] as? [String: String] == ["username": "fixture-user", "token": "fixture-token"])
  let count = await fixture.requests.count
  await model.authenticate(job, username: "fixture-user", token: "fixture-token")
  #expect(await fixture.requests.count == count)
}

@MainActor @Test func environmentConnectionUncertainResultMustRefreshAndDoesNotExposeCredentialErrors() async throws {
  let fixture = ConnectionFixture()
  let model = try connectionModel(fixture)
  await fixture.configure(state: "authentication-required", fail: "authenticate")
  await model.load()
  let job = try #require(model.active)
  await model.authenticate(job, username: "fixture-user", token: "fixture-token")
  #expect(model.uncertain && model.error != nil && !model.error!.contains("fixture-secret"))
  let count = await fixture.requests.count
  await model.authenticate(job, username: "fixture-user", token: "fixture-token")
  await model.cancel(job)
  #expect(await fixture.requests.count == count)
  await fixture.configure(fail: "get")
  await model.load()
  #expect(model.uncertain)
  await fixture.configure()
  await model.load()
  #expect(!model.uncertain)
  await model.cancel(job)
  #expect(model.active?.state == "cancelled")
}

@MainActor @Test func oldEnvironmentConnectionReadCannotOverwriteAuthenticationAcknowledgement() async throws {
  let fixture = ConnectionFixture()
  let model = try connectionModel(fixture)
  await fixture.configure(state: "authentication-required")
  await model.load()
  let job = try #require(model.active)
  await fixture.configure(hold: "get")
  let old = Task { await model.load() }
  try await held(fixture)
  await model.authenticate(job, username: "fixture-user", token: "fixture-token")
  #expect(model.active?.state == "connecting")
  await fixture.release()
  await old.value
  #expect(model.active?.state == "connecting")
  await fixture.configure(phase: "binding")
  await model.load()
  let count = await fixture.requests.count
  await model.cancel(try #require(model.active))
  #expect(await fixture.requests.count == count)
}

@MainActor @Test func environmentConnectionDisconnectDropsLateMutationAndConnectedNotificationsAreIdempotent()
  async throws
{
  let fixture = ConnectionFixture()
  let model = try connectionModel(fixture)
  var notifications = 0
  model.connected = { notifications += 1 }
  await fixture.configure(state: "connected")
  await model.load()
  await model.load()
  #expect(notifications == 1)
  model.repository = "https://example.com/config.git"
  await fixture.configure(hold: "connect")
  let connect = Task { await model.connect() }
  try await held(fixture)
  model.disconnect()
  await fixture.release()
  await connect.value
  #expect(model.snapshot == nil && !model.busy && !model.canConnect)
}

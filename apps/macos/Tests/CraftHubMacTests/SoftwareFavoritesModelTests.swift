import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private func favoriteSnapshot(_ revision: String, saved: Bool) throws -> SoftwareFavoritesSnapshot {
  try JSONDecoder().decode(
    SoftwareFavoritesSnapshot.self,
    from: JSONSerialization.data(withJSONObject: [
      "version": 1, "revision": revision,
      "tools": saved ? [["id": "saved", "title": "Fixture", "group": "Tools", "url": "https://example.com"]] : [],
      "matches": saved ? [["sourceId": "fixture", "softwareId": "editor", "toolId": "saved"]] : [],
    ]))
}
private actor FavoriteFixture {
  var requests: [URLRequest] = []
  var fail = false
  var hold = false
  var waiting: CheckedContinuation<Void, Never>?
  func configure(fail: Bool = false, hold: Bool = false) {
    self.fail = fail
    self.hold = hold
  }
  func release() {
    waiting?.resume()
    waiting = nil
    hold = false
  }
  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    if hold { await withCheckedContinuation { waiting = $0 } }
    if fail { throw URLError(.timedOut) }
    let json: [String: Any] =
      request.url?.path == "/api/native-host/open-workbench-tool"
      ? ["destination": "website"]
      : [
        "version": 1, "revision": "saved-revision",
        "tools": [["id": "saved", "title": "Fixture", "group": "Tools", "url": "https://example.com"]],
        "matches": [["sourceId": "fixture", "softwareId": "editor", "toolId": "saved"]],
      ]
    return (
      try JSONSerialization.data(withJSONObject: json),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
}
@MainActor private func favoriteModel(_ fixture: FavoriteFixture) throws -> SoftwareFavoritesModel {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43190/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  let model = SoftwareFavoritesModel(
    client: RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) }))
  model.receive(try favoriteSnapshot("initial", saved: false), version: model.readVersion)
  return model
}
private func favoriteHeld(_ fixture: FavoriteFixture) async throws {
  for _ in 0..<100 {
    if await fixture.waiting != nil { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("Favorite response was not held")
}

@MainActor @Test func favoriteSaveUsesOnlyCatalogIDsAndProtectsAgainstLateReads() async throws {
  let fixture = FavoriteFixture()
  let model = try favoriteModel(fixture)
  await fixture.configure(hold: true)
  let pending = Task { await model.add(source: "fixture", item: "editor") }
  try await favoriteHeld(fixture)
  let readingDuringWrite = model.readVersion
  await fixture.release()
  await pending.value
  let body =
    try JSONSerialization.jsonObject(with: #require(await fixture.requests.last?.httpBody)) as! [String: String]
  #expect(Set(body.keys) == ["action", "revision", "sourceId", "softwareId", "locale"])
  #expect(body["revision"] == "initial" && body["action"] == "add")
  model.receive(try favoriteSnapshot("late-old-read", saved: false), version: readingDuringWrite)
  #expect(model.favorite(source: "fixture", item: "editor") && model.snapshot?.revision == "saved-revision")
  await model.add(source: "fixture", item: "editor")
  #expect(await fixture.requests.count == 1)
}

@MainActor @Test func uncertainFavoritesNeedFreshSnapshotAndRemovalKeepsItsInspectedRevision() async throws {
  let fixture = FavoriteFixture()
  let model = try favoriteModel(fixture)
  await fixture.configure(fail: true)
  let old = model.readVersion
  await model.add(source: "fixture", item: "editor")
  #expect(model.uncertain && !model.canChange)
  model.receive(try favoriteSnapshot("old", saved: false), version: old)
  #expect(model.uncertain)
  model.receive(try favoriteSnapshot("latest", saved: true), version: model.readVersion)
  #expect(!model.uncertain && model.canChange)
  await model.remove("saved", revision: "initial")
  #expect(await fixture.requests.count == 1)
  await fixture.configure()
  await model.remove("saved", revision: "latest")
  let body =
    try JSONSerialization.jsonObject(with: #require(await fixture.requests.last?.httpBody)) as! [String: String]
  #expect(body == ["action": "remove", "toolId": "saved", "revision": "latest"])
}

@MainActor @Test func favoriteDisconnectDropsLateMutationAndIncompatibleSnapshotsCannotEnableWrites() async throws {
  let fixture = FavoriteFixture()
  let model = try favoriteModel(fixture)
  model.receive(nil, version: model.readVersion)
  #expect(!model.canChange)
  model.receive(try favoriteSnapshot("initial", saved: false), version: model.readVersion)
  await fixture.configure(hold: true)
  let pending = Task { await model.add(source: "fixture", item: "editor") }
  try await favoriteHeld(fixture)
  model.disconnect()
  await fixture.release()
  await pending.value
  #expect(model.snapshot == nil && !model.busy && !model.canChange)
}

@MainActor @Test func nativeFavoriteOpeningUsesSavedIdentifierAndReportsWebsiteFallback() async throws {
  let fixture = FavoriteFixture()
  let model = try favoriteModel(fixture)
  model.receive(try favoriteSnapshot("ready", saved: true), version: model.readVersion)
  await model.open("missing")
  #expect(await fixture.requests.isEmpty)
  await model.open("saved")
  let request = try #require(await fixture.requests.last)
  #expect(request.url?.path == "/api/native-host/open-workbench-tool")
  #expect(
    try JSONSerialization.jsonObject(with: #require(request.httpBody)) as? [String: String] == ["toolId": "saved"])
  #expect(request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true)
  #expect(model.opening == nil && model.notice != nil && model.error == nil)
}

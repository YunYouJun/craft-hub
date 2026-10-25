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
  var statusCode = 200
  var hold = false
  var waiting: CheckedContinuation<Void, Never>?
  func configure(fail: Bool = false, hold: Bool = false, statusCode: Int = 200) {
    self.statusCode = statusCode
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
      try JSONSerialization.data(
        withJSONObject: request.url?.path == "/api/software" ? ["version": 1, "sources": [], "favorites": json] : json),
      HTTPURLResponse(url: request.url!, statusCode: statusCode, httpVersion: nil, headerFields: nil)!
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

@MainActor @Test func toolEditorRoundTripsLaunchArtworkAndOrderAtItsOriginalRevision() async throws {
  let fixture = FavoriteFixture()
  let model = try favoriteModel(fixture)
  let toolData = Data(
    #"{"version":1,"revision":"custom","matches":[],"tools":[{"id":"command","title":"Command","group":"Tools","url":"https://example.com","macosIconUrl":"https://example.com/mac.png","iconStyle":"rounded","iconScale":1.2,"launch":{"application":"raycast","commandUrl":"raycast://extensions/owner/extension/command"}}]}"#
      .utf8)
  model.receive(try JSONDecoder().decode(SoftwareFavoritesSnapshot.self, from: toolData), version: model.readVersion)
  model.beginEditing()
  model.appendTool()
  model.draft[1].title = "Website"
  model.draft[1].url = "https://example.org"
  model.draft.swapAt(0, 1)
  await model.saveDraft()
  let request = try #require(await fixture.requests.last)
  let body = try JSONSerialization.jsonObject(with: #require(request.httpBody)) as! [String: Any]
  #expect(body["action"] as? String == "replace")
  #expect(body["revision"] as? String == "custom")
  let tools = try #require(body["tools"] as? [[String: Any]])
  #expect(tools[0]["title"] as? String == "Website")
  #expect(tools[1]["macosIconUrl"] as? String == "https://example.com/mac.png")
  #expect(tools[1]["iconScale"] as? Double == 1.2)
  #expect((tools[1]["launch"] as? [String: String])?["commandUrl"] == "raycast://extensions/owner/extension/command")
  #expect(!model.editing && !model.busy && model.notice != nil)
}

@MainActor @Test func toolEditorRetainsDraftOnFailureAndRequiresExplicitReloadAdoption() async throws {
  let fixture = FavoriteFixture()
  let model = try favoriteModel(fixture)
  model.beginEditing()
  model.appendTool()
  model.draft[0].title = "Keep this draft"
  await fixture.configure(fail: true)
  await model.saveDraft()
  #expect(model.editing && model.uncertain && !model.canSave)
  #expect(model.draft.first?.title == "Keep this draft" && model.editorError != nil)
  model.receive(try favoriteSnapshot("newer", saved: true), version: model.readVersion)
  #expect(model.draft.first?.title == "Keep this draft" && !model.canSave)
  await model.saveDraft()
  #expect(await fixture.requests.count == 1)
  model.beginEditing()
  #expect(model.draft.first?.title == "Fixture" && model.canSave)
}

@MainActor @Test func toolEditorInvalidationPreventsSavingAnOldDraftAndDisconnectDropsLateSave() async throws {
  let fixture = FavoriteFixture()
  let model = try favoriteModel(fixture)
  model.beginEditing()
  model.invalidate()
  await model.saveDraft()
  #expect(await fixture.requests.isEmpty)
  model.receive(try favoriteSnapshot("newer", saved: true), version: model.readVersion)
  #expect(!model.canSave)
  model.beginEditing()
  await fixture.configure(hold: true)
  let pending = Task { await model.saveDraft() }
  try await favoriteHeld(fixture)
  model.disconnect()
  await fixture.release()
  await pending.value
  #expect(model.snapshot == nil && !model.canSave && !model.busy)
}

@MainActor @Test func toolsLoadCachedMetadataAndReplayInvalidationDuringRead() async throws {
  let fixture = FavoriteFixture()
  let model = try favoriteModel(fixture)
  await fixture.configure(hold: true)
  let loading = Task { await model.load(force: true) }
  try await favoriteHeld(fixture)
  #expect(model.loading && !model.canChange)
  model.invalidate()
  await fixture.release()
  await loading.value
  let requests = await fixture.requests
  #expect(requests.count == 2)
  #expect(
    requests.allSatisfy {
      $0.url?.path == "/api/software" && $0.url?.query == "discovery=none" && $0.httpMethod == "GET"
    })
  #expect(model.snapshot?.revision == "saved-revision" && !model.stale && !model.loading && model.canChange)
}

@MainActor @Test func invalidToolDraftCanBeCorrectedWithoutDiscardingItsFields() async throws {
  let fixture = FavoriteFixture()
  let model = try favoriteModel(fixture)
  model.beginEditing()
  model.appendTool()
  await fixture.configure(statusCode: 400)
  await model.saveDraft()
  #expect(model.editorError != nil && model.editing && !model.uncertain && model.canSave)
  model.draft[0].title = "Corrected"
  model.draft[0].url = "https://example.com"
  await fixture.configure()
  await model.saveDraft()
  #expect(!model.editing && model.snapshot?.revision == "saved-revision")
}

@MainActor @Test func toolsReuseCatalogArtworkWithoutOverwritingCustomIconsOrPersistingEnrichment() throws {
  let fixture = FavoriteFixture()
  let model = try favoriteModel(fixture)
  let catalog = try JSONDecoder().decode(
    SoftwareSnapshot.self,
    from: Data(
      #"{"version":1,"sources":[{"id":"fixture","title":"Fixture","items":[{"id":"app","title":{"en":"App"},"group":{"id":"tools","title":{"en":"Tools"}},"url":"https://example.com/","status":"unknown","iconUrl":"https://example.com/icon.png","macosIconUrl":"https://example.com/mac.png","iconScale":1.2}]}],"favorites":{"version":1,"revision":"artwork","tools":[{"id":"saved","title":"App","group":"Tools","url":"https://example.com/#home"}],"matches":[]}}"#
        .utf8))
  model.receiveCatalog(catalog, version: model.readVersion)
  var tool = try #require(model.snapshot?.tools.first)
  #expect(model.artwork(tool).sources.first?.url.absoluteString == "https://example.com/mac.png")
  #expect(model.artwork(tool).sources.first?.scale == 1.2)
  model.beginEditing()
  #expect(model.draft.first?.macosIconUrl == nil && model.draft.first?.iconUrl == nil)
  tool.iconUrl = "https://example.org/custom.png"
  #expect(model.artwork(tool).sources.first?.url.absoluteString == "https://example.org/custom.png")
  #expect(model.artwork(tool).sources.first?.scale == 1)
}

@MainActor @Test func favoritesDoNotLoseSettingsEventsThatArriveDuringASave() async throws {
  let fixture = FavoriteFixture()
  let model = try favoriteModel(fixture)
  model.beginEditing()
  await fixture.configure(hold: true)
  let saving = Task { await model.saveDraft() }
  try await favoriteHeld(fixture)
  model.invalidate()
  await fixture.release()
  await saving.value
  #expect(model.stale && !model.canChange)
  await model.load()
  #expect(!model.stale && model.canChange)
  #expect(await fixture.requests.count == 2)
}

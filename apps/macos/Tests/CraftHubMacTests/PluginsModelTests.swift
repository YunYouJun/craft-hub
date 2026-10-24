import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private let pluginName = "@example/craft-hub-plugin-test"
private let metadata =
  #"{"displayName":"Fixture","description":"Fixture plugin","permissions":["commands"],"includesPlugins":[],"requiresPlugins":[],"contributes":{"commands":[]}}"#
private var installedJSON: String {
  "{\"package\":\"\(pluginName)\",\"sourceId\":\"fixture\",\"version\":\"1.0.0\",\"enabled\":true,\"packagePath\":\"/fixture\",\"manifest\":\(metadata)}"
}
private func planJSON(changed: Bool = false) -> String {
  "{\"sourceId\":\"fixture\",\"rootPackage\":\"\(pluginName)\",\"permissions\":[\"commands\"],\"items\":[{\"package\":\"\(pluginName)\",\"version\":\"1.0.0\",\"displayName\":\"Fixture\",\"sourceId\":\"fixture\",\"permissions\":[\"commands\"],\"action\":\"\(changed ? "enable" : "install")\",\"root\":true}]}"
}
private var overviewJSON: String {
  let fields = metadata.dropFirst().dropLast()
  return
    "{\"version\":1,\"catalog\":[{\(fields),\"package\":\"\(pluginName)\",\"version\":\"1.0.0\",\"sourceId\":\"fixture\",\"sourceName\":\"Fixture\",\"sourceKind\":\"builtin\",\"publisher\":\"Fixture\",\"status\":\"active\",\"action\":\"install\",\"preferred\":true,\"included\":false}],\"installed\":[\(installedJSON)],\"sources\":[]}"
}
private func pluginConnection() throws -> RuntimeConnection {
  let token = String(repeating: "a", count: 64)
  return try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
}

private func changeOverview() throws -> Data {
  var object = try #require(try JSONSerialization.jsonObject(with: Data(overviewJSON.utf8)) as? [String: Any])
  var installed = try #require(object["installed"] as? [[String: Any]])
  installed[0]["previousVersion"] = "0.9.0"
  object["installed"] = installed
  object["sources"] = [
    [
      "id": "custom", "name": "Custom Source", "kind": "user", "enabled": true,
      "catalogUrl": "https://example.com/catalog.json",
    ]
  ]
  return try JSONSerialization.data(withJSONObject: object)
}

@MainActor private func requestChange(_ kind: String, model: PluginsModel) {
  switch kind {
  case "rollback": model.reviewRollback(pluginName)
  case "source": model.reviewSourceRemoval("custom")
  default: model.reviewRemoval(pluginName)
  }
}

@MainActor @Test(arguments: ["remove", "rollback", "source"])
func pluginChangeConfirmationCannotSurviveReconnectInvalidationRefreshOrNavigation(kind: String) async throws {
  let data = try changeOverview()
  var calls: [URLRequest] = []
  let client = RuntimeAPIClient(connection: try pluginConnection()) { request in
    calls.append(request)
    return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
  let model = PluginsModel()
  model.connect(client)
  await model.load()
  for boundary in ["reconnect", "invalidate", "refresh", "navigate", "cancel", "replace"] {
    requestChange(kind, model: model)
    let review = try #require(model.changeReview)
    switch boundary {
    case "reconnect":
      model.connect(nil)
      model.connect(client)
      await model.load()
    case "invalidate":
      model.invalidate([.plugins])
      requestChange(kind, model: model)
      #expect(model.changeReview == nil)
      await model.load()
    case "refresh": await model.load(force: true)
    case "navigate": model.tab = .installed
    case "cancel": model.cancelChange()
    default: requestChange(kind, model: model)
    }
    let currentID = model.changeReview?.id
    #expect(model.confirmChange(review) == nil)
    #expect(model.changeReview?.id == currentID)
    model.cancelChange()
  }
  #expect(calls.allSatisfy { $0.httpMethod == "GET" && $0.url?.path == "/api/marketplace/overview" })
}

@MainActor @Test(arguments: ["remove", "rollback", "source"])
func pluginChangeRequiresFreshReviewAfterAnUncertainWrite(kind: String) async throws {
  let data = try changeOverview()
  var calls: [URLRequest] = []
  var failing = true
  let model = PluginsModel()
  model.connect(
    RuntimeAPIClient(connection: try pluginConnection()) { request in
      calls.append(request)
      if request.httpMethod != "GET" && failing { throw URLError(.networkConnectionLost) }
      let result =
        request.httpMethod == "GET"
        ? data : Data((kind == "rollback" ? installedJSON : #"{"deleted":true,"unlinked":true}"#).utf8)
      return (result, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    })
  await model.load()
  requestChange(kind, model: model)
  let review = try #require(model.changeReview)
  let task = try #require(model.confirmChange(review))
  #expect(model.changeReview == nil && model.confirmChange(review) == nil)
  await task.value
  #expect(model.error != nil && model.stale && model.confirmChange(review) == nil)
  requestChange(kind, model: model)
  #expect(model.changeReview == nil)
  await model.load()
  requestChange(kind, model: model)
  #expect(model.changeReview != nil && model.changeReview?.id != review.id)
  let writes = calls.filter { $0.httpMethod != "GET" }
  #expect(writes.count == 1)
  let write = try #require(writes.first)
  if kind == "rollback" {
    #expect(write.httpMethod == "POST" && write.url?.path.hasSuffix("/rollback") == true)
  } else {
    #expect(write.httpMethod == "DELETE")
    if kind == "source" { #expect(write.url?.path == "/api/marketplace/sources/custom") }
  }
  failing = false
  let freshReview = try #require(model.changeReview)
  let retry = try #require(model.confirmChange(freshReview))
  await retry.value
  #expect(model.changeReview == nil && model.error == nil && !model.stale)
  #expect(calls.filter { $0.httpMethod != "GET" }.count == 2)
}

@MainActor @Test func queuedPluginConfirmationCannotUseAReplacementRuntimeOrAnInvalidatedCatalog() async throws {
  let data = try changeOverview()
  var writes = 0
  let client = RuntimeAPIClient(connection: try pluginConnection()) { request in
    if request.httpMethod != "GET" { writes += 1 }
    return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
  let model = PluginsModel()
  for reconnect in [true, false] {
    model.connect(client)
    await model.load()
    model.reviewRemoval(pluginName)
    let review = try #require(model.changeReview)
    let task = try #require(model.confirmChange(review))
    if reconnect { model.connect(client) } else { model.invalidate([.plugins]) }
    await task.value
  }
  #expect(writes == 0)
}
private actor PluginFixture {
  var requests: [URLRequest] = []
  var changed = false
  var holdPreview = false
  var previewWaiter: CheckedContinuation<Void, Never>?
  func setChanged() { changed = true }
  func hold() { holdPreview = true }
  func release() {
    previewWaiter?.resume()
    previewWaiter = nil
  }
  func response(_ request: URLRequest) async -> (Data, URLResponse) {
    requests.append(request)
    let json: String
    switch request.url!.path {
    case "/api/marketplace/overview": json = overviewJSON
    case "/api/plugins/install/preview":
      if holdPreview { await withCheckedContinuation { previewWaiter = $0 } }
      json = planJSON(changed: changed)
    case "/api/plugins/install": json = installedJSON
    case "/api/marketplace/sources/preview":
      json =
        "{\"name\":\"Resolved Name\",\"catalogUrl\":\"https://example.com/catalog.json\",\"finalCatalogUrl\":\"https://example.com/current.json\",\"catalog\":{\"name\":\"Resolved Name\",\"plugins\":[{\"package\":\"\(pluginName)\",\"version\":\"1.0.0\",\"displayName\":\"Fixture\"}]}}"
    default: json = #"{"deleted":true,"unlinked":true}"#
    }
    return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
}

@MainActor @Test func nativePluginPreviewDoesNotInstallUntilExplicitConfirmationAndCancellationClearsApproval()
  async throws
{
  let fixture = PluginFixture()
  let model = PluginsModel()
  model.connect(RuntimeAPIClient(connection: try pluginConnection(), transport: { await fixture.response($0) }))
  await model.load()
  #expect(await fixture.requests.map(\.httpMethod) == ["GET"])
  let plugin = try #require(model.catalog.first)
  await model.preview(plugin)
  #expect(model.installReview?.plan.permissions == ["commands"])
  model.cancelPreview()
  await model.confirmInstall()
  #expect(await fixture.requests.filter { $0.url?.path == "/api/plugins/install" }.isEmpty)
  await model.preview(plugin)
  await model.confirmInstall()
  let installs = await fixture.requests.filter { $0.url?.path == "/api/plugins/install" }
  #expect(installs.count == 1)
  let body = try #require(try JSONSerialization.jsonObject(with: installs[0].httpBody!) as? [String: Any])
  #expect(body["version"] as? String == "1.0.0")
  #expect(body["package"] as? String == pluginName)
  #expect((body["reviewedPlan"] as? [String: Any])?["permissions"] as? [String] == ["commands"])
  #expect(model.installReview == nil && !model.busy)
  #expect(
    await fixture.requests.allSatisfy {
      !$0.url!.path.contains("/run") && !$0.url!.path.contains("/trust")
        && $0.value(forHTTPHeaderField: "Cookie") == nil
    })
}

@MainActor @Test func changedPluginPlanRequiresASecondReviewInsteadOfInstalling() async throws {
  let fixture = PluginFixture()
  let model = PluginsModel()
  model.connect(RuntimeAPIClient(connection: try pluginConnection(), transport: { await fixture.response($0) }))
  await model.load()
  await model.preview(try #require(model.catalog.first))
  await fixture.setChanged()
  await model.confirmInstall()
  #expect(model.installReview?.plan.items.first?.action == "enable")
  #expect(model.message != nil)
  #expect(await fixture.requests.filter { $0.url?.path == "/api/plugins/install" }.isEmpty)
  await model.confirmInstall()
  #expect(await fixture.requests.filter { $0.url?.path == "/api/plugins/install" }.count == 1)
}

@MainActor @Test func latePluginPreviewCannotRestoreApprovalAfterRuntimeDisconnect() async throws {
  let fixture = PluginFixture()
  let model = PluginsModel()
  model.connect(RuntimeAPIClient(connection: try pluginConnection(), transport: { await fixture.response($0) }))
  await model.load()
  let plugin = try #require(model.catalog.first)
  await fixture.hold()
  let task = Task { await model.preview(plugin) }
  for _ in 0..<100 {
    if await fixture.previewWaiter != nil { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(model.busy)
  model.connect(nil)
  await fixture.release()
  await task.value
  #expect(model.installReview == nil && model.snapshot == nil && !model.busy)
}

@MainActor @Test func sourcePreviewUsesResolvedMetadataAndCancelNeverAddsASource() async throws {
  let fixture = PluginFixture()
  let model = PluginsModel()
  model.connect(RuntimeAPIClient(connection: try pluginConnection(), transport: { await fixture.response($0) }))
  await model.previewSource(.init(name: "", catalogUrl: "https://example.com/catalog.json", registry: nil))
  #expect(model.sourceReview?.input.name == "Resolved Name")
  #expect(model.sourceReview?.preview.catalog.plugins.first?.package == pluginName)
  model.cancelPreview()
  await model.confirmSource()
  #expect(await fixture.requests.count == 1)
}

@Test func pluginRemovalPreservesUserDataAndScopedPackageIsOneURLSegment() async throws {
  let fixture = PluginFixture()
  let client = RuntimeAPIClient(connection: try pluginConnection(), transport: { await fixture.response($0) })
  try await client.removePlugin(pluginName, local: false)
  try await client.removePlugin(pluginName, local: true)
  let requests = await fixture.requests
  #expect(requests.allSatisfy { $0.httpMethod == "DELETE" && $0.url!.absoluteString.contains("%2F") })
  for request in requests {
    let body = try #require(try JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Bool])
    #expect(body["deleteData"] == false)
  }
  await #expect(throws: RuntimeAPIError.self) { try await client.removePlugin("..", local: false) }
  #expect(await fixture.requests.count == 2)
}

@MainActor @Test func nativeSourceImportOnlyFillsAPersistentDraftAndInvalidatesOldApproval() async throws {
  let fixture = PluginFixture()
  let model = PluginsModel()
  model.connect(RuntimeAPIClient(connection: try pluginConnection(), transport: { await fixture.response($0) }))
  await model.previewSource(.init(name: "Old", catalogUrl: "https://example.com/old.json", registry: nil))
  #expect(model.sourceReview != nil)
  model.sourceName = "Old"
  model.sourceRegistry = "https://example.com/registry/"
  model.prepareSourceImport("https://example.com/new.json")
  #expect(model.tab == .sources && model.sourceReview == nil && model.installReview == nil)
  #expect(model.sourceInput.catalogUrl == "https://example.com/new.json")
  #expect(model.sourceInput.name.isEmpty && model.sourceInput.registry == nil)
  await model.confirmSource()
  #expect(await fixture.requests.count == 1)
  model.tab = .discover
  model.tab = .sources
  model.connect(nil)
  #expect(model.sourceCatalogURL == "https://example.com/new.json" && model.sourceReview == nil)
  #expect(await fixture.requests.count == 1)
}

@MainActor @Test func nativePluginSearchTrimsWhitespaceAcrossTabsAndFailedRefreshMarksCatalogStale() async throws {
  var failing = false
  let model = PluginsModel()
  model.connect(
    RuntimeAPIClient(connection: try pluginConnection()) { request in
      if failing { throw URLError(.timedOut) }
      let json = overviewJSON.replacingOccurrences(
        of: "\"sources\":[]",
        with: #""sources":[{"id":"fixture","name":"Fixture Source","kind":"user","enabled":true}]"#)
      return (
        Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
      )
    })
  await model.load()
  model.query = "  fixture  "
  #expect(model.catalog.count == 1 && model.installed.count == 1 && model.sources.count == 1)
  model.query = " \n "
  #expect(model.catalog.count == 1 && model.installed.count == 1 && model.sources.count == 1)
  #expect(!model.stale)
  failing = true
  await model.load(force: true)
  #expect(model.stale && model.error != nil && model.installed.count == 1)
  failing = false
  await model.load()
  #expect(!model.stale && model.error == nil)
  model.connect(nil)
  #expect(!model.stale && model.snapshot == nil)
}

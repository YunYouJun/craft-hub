import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private actor ManagementFixture {
  var requests: [URLRequest] = []
  var failUpdates = false
  var heldPath: String?
  var waiter: CheckedContinuation<Void, Never>?
  var hostEnabled = false
  func hold(_ path: String) { heldPath = path }
  func failNextUpdateCheck() { failUpdates = true }
  func release() {
    heldPath = nil
    waiter?.resume()
    waiter = nil
  }
  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    let path = request.url!.path
    let json: String
    switch path {
    case "/api/native-host/extensions":
      if request.httpMethod == "PUT" { hostEnabled = true }
      json = """
        {"bundledExtensions":[{"id":"fixture","name":"Fixture","version":"1","optional":true,"enabled":\(hostEnabled)}],
        "extensions":[],"diagnostics":[],"restartRequired":\(hostEnabled)}
        """
    case "/api/plugins/updates":
      if request.httpMethod == "GET", failUpdates { throw URLError(.timedOut) }
      json =
        request.httpMethod == "POST"
        ? #"{"updated":[],"skipped":[],"failures":[]}"#
        : #"[{"package":"fixture","sourceId":"fixture","currentVersion":"1","targetVersion":"2","automatic":true}]"#
    default: json = #"{"version":1,"catalog":[],"installed":[],"sources":[]}"#
    }
    if heldPath == path { await withCheckedContinuation { waiter = $0 } }
    return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
}

@MainActor private func managementModel(_ fixture: ManagementFixture) throws -> PluginsModel {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  let model = PluginsModel()
  model.connect(RuntimeAPIClient(connection: connection) { try await fixture.response($0) })
  return model
}

private func awaitHeld(_ fixture: ManagementFixture) async throws {
  for _ in 0..<200 {
    if await fixture.waiter != nil { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("The fixture request was not suspended")
}

@MainActor @Test func failedUpdateCheckCannotOfferPreviousUpdatesAndChangesRequireRechecking() async throws {
  let fixture = ManagementFixture()
  let model = try managementModel(fixture)
  await model.checkUpdates()
  #expect(model.updatesPresented && model.canApplyUpdates)
  model.invalidate([.plugins])
  #expect(model.updatesStale && !model.canApplyUpdates)
  await model.updateAll()
  #expect(await fixture.requests.allSatisfy { $0.httpMethod == "GET" })
  await model.checkUpdates()
  #expect(model.canApplyUpdates)
  await fixture.failNextUpdateCheck()
  await model.checkUpdates()
  #expect(model.updates.isEmpty && !model.updatesChecked && model.updatesError != nil && !model.canApplyUpdates)
  await model.updateAll()
  #expect(await fixture.requests.allSatisfy { $0.httpMethod == "GET" })
}

@MainActor @Test func updatePresentationStartsBeforeTheResponseAndDisconnectCannotReopenIt() async throws {
  let fixture = ManagementFixture()
  let model = try managementModel(fixture)
  await fixture.hold("/api/plugins/updates")
  let pending = Task { await model.checkUpdates() }
  try await awaitHeld(fixture)
  #expect(model.updatesPresented && model.updatesLoading && !model.canApplyUpdates)
  model.connect(nil)
  await fixture.release()
  await pending.value
  #expect(!model.updatesPresented && !model.updatesLoading && model.updates.isEmpty && !model.busy)
}

@MainActor @Test func applyingUpdatesConsumesTheCheckAndRequiresAnExplicitRecheck() async throws {
  let fixture = ManagementFixture()
  let model = try managementModel(fixture)
  await model.checkUpdates()
  await model.updateAll()
  #expect(model.updateResult != nil && !model.canApplyUpdates && !model.updatesChecked)
  await model.updateAll()
  #expect(await fixture.requests.filter { $0.httpMethod == "POST" }.count == 1)
}

@MainActor @Test func lateHostReadCannotOverwriteTheEnabledStateReturnedByAMutation() async throws {
  let fixture = ManagementFixture()
  let model = try managementModel(fixture)
  await model.hostComponents.load()
  let host = try #require(model.hostComponents.snapshot?.bundledExtensions?.first)
  await fixture.hold("/api/native-host/extensions")
  let oldRead = Task { await model.hostComponents.load() }
  try await awaitHeld(fixture)
  // Hold only the GET that already captured the old state; the PUT must complete first.
  await fixture.hold("/unused")
  await model.hostComponents.setBundled(host)
  #expect(
    model.hostComponents.snapshot?.bundledExtensions?.first?.enabled == true
      && model.hostComponents.snapshot?.restartRequired == true)
  await fixture.release()
  await oldRead.value
  #expect(model.hostComponents.snapshot?.bundledExtensions?.first?.enabled == true && !model.hostComponents.loading)
}

@MainActor @Test func pluginNavigationCannotChangeAReconnectedOrAbandonedPage() async throws {
  let fixture = ManagementFixture()
  let model = try managementModel(fixture)
  await fixture.hold("/api/marketplace/overview")
  let pending = Task { await model.show(package: "old-plugin", source: "old-source") }
  try await awaitHeld(fixture)
  model.cancelNavigation()
  model.query = "keep-search"
  model.tab = .installed
  await fixture.release()
  await pending.value
  #expect(model.query == "keep-search" && model.tab == .installed && model.detail == nil)
  model.connect(nil)
  await model.show(package: "old-plugin", source: nil, isCurrent: { false })
  #expect(model.query == "keep-search")
}

@Test func nativePluginRouteDecodesScopedPackagesWithoutAcceptingOtherDestinations() throws {
  let route = try #require(PluginRoute(path: "/marketplace/plugins/source%20name/%40example%2Fplugin"))
  #expect(route.source == "source name" && route.package == "@example/plugin")
  for path in [
    "https://example.com/marketplace/plugins/a/b", "//marketplace/plugins/a/b", "/marketplace/plugins/a/b/extra",
    "/marketplace/plugins/a%2Fb/c", "/marketplace/plugins/a/%00", "/marketplace/plugins/a/%ZZ",
    "/marketplace/plugins/a/..", "/marketplace/plugins/a/b?other=1", "/marketplace/plugins/a/b#fragment",
  ] { #expect(PluginRoute(path: path) == nil) }
}

@MainActor @Test func visibleWebPluginDetailsEnterNativeManagementButLateHiddenRoutesDoNot() {
  let suite = "craft-hub-plugin-routing-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = WorkbenchModel(defaults: defaults)
  model.routeChanged("/overview")
  model.showIntegrationWeb("/tools")
  model.routeChanged("/marketplace/plugins/fixture/%40example%2Fplugin")
  #expect(model.selection == .marketplace && model.presentsNativeContent)
  model.selection = .diagnostics
  model.select(.diagnostics)
  model.routeChanged("/marketplace/plugins/fixture/%40example%2Fplugin")
  #expect(model.selection == .diagnostics && model.presentsNativeContent)
}

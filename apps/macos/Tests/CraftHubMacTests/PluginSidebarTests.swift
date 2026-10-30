import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private actor PluginSidebarFixture {
  var requests: [URLRequest] = []
  var empty = false
  var fail = false
  var hold = false
  var waiting: CheckedContinuation<Void, Never>?

  func configure(empty: Bool = false, fail: Bool = false, hold: Bool = false) {
    self.empty = empty
    self.fail = fail
    self.hold = hold
  }

  func release() {
    hold = false
    waiting?.resume()
    waiting = nil
  }

  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    let chinese = request.url?.query == "locale=zh-CN"
    let failed = fail
    let data = try JSONSerialization.data(
      withJSONObject: empty
        ? []
        : [
          [
            "id": "team", "pluginId": "@example/links", "title": chinese ? "团队导航" : "Team links",
            "icon": "builtin:team",
          ],
          ["id": "team", "pluginId": "@example/company", "title": chinese ? "公司工作台" : "Company tools"],
        ])
    if hold { await withCheckedContinuation { waiting = $0 } }
    if failed { throw URLError(.timedOut) }
    return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
}

private func pluginSidebarClient(_ fixture: PluginSidebarFixture) throws -> RuntimeAPIClient {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43190/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  return RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) })
}

private func pluginSidebarHeld(_ fixture: PluginSidebarFixture) async throws {
  for _ in 0..<100 {
    if await fixture.waiting != nil { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("Plugin sidebar response was not held")
}

@MainActor @Test func pluginSidebarShowsLocalizedWorkbenchesAndOpensTheDeclaredScopedRoute() async throws {
  let fixture = PluginSidebarFixture()
  let suite = "craft-hub-plugin-sidebar-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = WorkbenchModel(defaults: defaults)
  model.pluginNavigation.connect(try pluginSidebarClient(fixture))
  await model.pluginNavigation.load(locale: "zh-CN")
  await model.pluginNavigation.load(locale: "zh-CN")
  let entries = model.pluginNavigation.workbenches
  #expect(entries.map(\.title) == ["团队导航", "公司工作台"])
  #expect(Set(entries.map(\.id)).count == 2)
  let first = try #require(entries.first)
  #expect(first.path == "/workbenches/%40example%2Flinks/team")
  #expect(!model.webContentRequested && model.webView == nil)
  model.selectSidebar(.pluginWorkbench(first.path))
  #expect(model.sidebarSelection == .pluginWorkbench(first.path))
  #expect(model.navigationTitle == "团队导航")
  #expect(model.webContentRequested && !model.presentsNativeContent)
  model.routeChanged(first.path)
  #expect(model.sidebarSelection == .pluginWorkbench(first.path))
  // Returning to a built-in page must survive a late callback from the hidden web session.
  model.selectSidebar(.builtin(.tools))
  model.routeChanged(first.path)
  #expect(model.sidebarSelection == .builtin(.tools) && model.presentsNativeContent)
  let requests = await fixture.requests
  #expect(requests.count == 1)
  #expect(requests[0].url?.path == "/api/workbenches" && requests[0].url?.query == "locale=zh-CN")
  #expect(requests[0].httpMethod == "GET" && requests[0].httpBody == nil)
}

@MainActor @Test func pluginSidebarRemovalReturnsToTheNativeWorkbenchList() async throws {
  let fixture = PluginSidebarFixture()
  let suite = "craft-hub-plugin-sidebar-removal-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = WorkbenchModel(defaults: defaults)
  model.pluginNavigation.connect(try pluginSidebarClient(fixture))
  await model.loadPluginNavigation(locale: "en")
  let entry = try #require(model.pluginNavigation.workbenches.first)
  model.navigateToWebPath(entry.path)
  #expect(model.sidebarSelection == .pluginWorkbench(entry.path))
  await fixture.configure(empty: true)
  model.invalidate([.plugins])
  await model.loadPluginNavigation(locale: "en")
  #expect(model.pluginNavigation.workbenches.isEmpty)
  #expect(model.sidebarSelection == .builtin(.workbenches) && model.presentsNativeContent)
  model.routeChanged(entry.path)
  #expect(model.sidebarSelection == .builtin(.workbenches) && model.presentsNativeContent)
  model.selectSidebar(.pluginWorkbench(entry.path))
  #expect(model.presentsNativeContent)
}

@MainActor @Test func pluginSidebarRefreshesOnPluginChangesAndDisablesStaleEntriesOnFailure() async throws {
  let fixture = PluginSidebarFixture()
  let model = PluginNavigationModel()
  model.connect(try pluginSidebarClient(fixture))
  await model.load(locale: "en")
  model.invalidate([.runs])
  await model.load(locale: "en")
  #expect(await fixture.requests.count == 1)
  model.invalidate([.plugins])
  #expect(!model.canOpen)
  await fixture.configure(fail: true)
  await model.load(locale: "en")
  #expect(model.workbenches.count == 2 && model.error != nil && !model.canOpen)
  await fixture.configure(empty: true)
  await model.load(locale: "en")
  #expect(model.workbenches.isEmpty && model.error == nil && model.canOpen)
}

@MainActor @Test func pluginSidebarRetriesChangedLanguageAndRejectsAnOldConnectionsLateResponse() async throws {
  let old = PluginSidebarFixture()
  let fresh = PluginSidebarFixture()
  let model = PluginNavigationModel()
  model.connect(try pluginSidebarClient(old))
  await old.configure(hold: true)
  let first = Task { await model.load(locale: "en") }
  try await pluginSidebarHeld(old)
  let localized = Task { await model.load(locale: "zh-CN") }
  await Task.yield()
  model.invalidate([.pluginUpdate])
  await old.release()
  await first.value
  await localized.value
  #expect(model.workbenches.first?.title == "团队导航" && model.canOpen)
  #expect(await old.requests.count == 2)
  await old.configure(hold: true)
  let obsolete = Task { await model.load(locale: "en") }
  try await pluginSidebarHeld(old)
  model.connect(try pluginSidebarClient(fresh))
  await fresh.configure(empty: true)
  await model.load(locale: "zh-CN")
  await old.release()
  await obsolete.value
  #expect(model.workbenches.isEmpty && model.canOpen && !model.loading)
  model.connect(nil)
  #expect(model.workbenches.isEmpty && !model.canOpen)
}

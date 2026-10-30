import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private func directoryData(
  title: String = "Resources", plugin: String = "@example/links", url: String = "https://example.com/docs"
) throws -> Data {
  try JSONSerialization.data(withJSONObject: [
    [
      "id": "shared", "pluginId": plugin, "pluginName": "Engineering links", "pluginVersion": "1.0.0",
      "title": title, "description": "Shared systems", "icon": "builtin:code",
      "links": [
        [
          "id": "docs", "title": "Handbook", "description": "Team standards", "url": url,
          "keywords": ["handbook-keyword"], "icon": "emoji:📚",
        ],
        ["id": "metrics", "title": "Metrics", "url": "https://example.com/metrics", "keywords": ["data"]],
      ],
    ]
  ])
}

private actor DirectoryFixture {
  var requests: [URLRequest] = []
  var fail = false
  var empty = false
  var hold = false
  var waiting: CheckedContinuation<Void, Never>?
  private let heldRequests = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
  func configure(fail: Bool = false, empty: Bool = false, hold: Bool = false) {
    self.fail = fail
    self.empty = empty
    self.hold = hold
  }
  func release() {
    hold = false
    waiting?.resume()
    waiting = nil
  }
  func waitUntilHeld() async throws {
    try await requireHeldResponse(heldRequests.stream) { await self.release() }
  }
  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    let failed = fail
    let chinese =
      URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "locale" }?.value
      == "zh-CN"
    let data = empty ? Data("[]".utf8) : try directoryData(title: chinese ? "开发资源" : "Resources")
    if hold {
      await withCheckedContinuation {
        waiting = $0
        heldRequests.continuation.yield(())
      }
    }
    if failed { throw URLError(.timedOut) }
    return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
}

private func directoryClient(_ fixture: DirectoryFixture) throws -> RuntimeAPIClient {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43190/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  return RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) })
}
@MainActor @Test func websiteDirectoryReadsOnlyLocalizedDeclarationsAndSearchesPanelAndLinkMetadata() async throws {
  let fixture = DirectoryFixture()
  let model = WebsiteNavigationModel()
  model.connect(try directoryClient(fixture))
  await model.load(locale: "zh-CN")
  await model.load(locale: "zh-CN")
  let requests = await fixture.requests
  #expect(requests.count == 1)
  #expect(requests[0].url?.path == "/api/navigation-panels" && requests[0].url?.query == "locale=zh-CN")
  #expect(requests[0].httpMethod == "GET" && requests[0].httpBody == nil)
  #expect(requests[0].value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true)
  #expect(model.canOpen && model.linkCount == 2 && model.pluginCount == 1)
  let panel = try #require(model.panels?.first)
  #expect(panel.title == "开发资源")
  for query in ["  engineering  ", "开发", "Shared systems"] {
    model.query = query
    #expect(model.visibleLinks(panel).count == 2)
  }
  model.query = "HANDBOOK-KEYWORD"
  #expect(model.visibleLinks(panel).map(\.id) == ["docs"])
  model.query = "Team standards"
  #expect(model.visibleLinks(panel).count == 1)
  model.query = "example.com/metrics"
  #expect(model.visibleLinks(panel).map(\.id) == ["metrics"])
  model.query = "nothing matches"
  #expect(model.visiblePanels.isEmpty && model.hasQuery)
  model.query = "  "
  #expect(!model.hasQuery && model.visiblePanels.count == 1)
}

@MainActor @Test func websiteDirectoryInvalidatesRemovedPluginsAndFailedReadsKeepOnlyDisabledHistory() async throws {
  let fixture = DirectoryFixture()
  let model = WebsiteNavigationModel()
  model.connect(try directoryClient(fixture))
  await model.load(locale: "en")
  model.query = "data"
  model.invalidate([.runs])
  await model.load(locale: "en")
  #expect(await fixture.requests.count == 1)
  model.invalidate([.plugins])
  #expect(model.stale && !model.canOpen)
  await fixture.configure(fail: true)
  await model.load(locale: "en")
  #expect(model.error != nil && model.panels?.count == 1 && model.stale && !model.canOpen)
  await fixture.configure(empty: true)
  await model.load(locale: "en")
  #expect(model.panels?.isEmpty == true && model.error == nil && !model.stale)
  #expect(model.linkCount == 0 && model.pluginCount == 0 && model.query == "data")
}

@MainActor @Test func websiteDirectoryRetriesInvalidationAndLocaleChangesDuringARead() async throws {
  let fixture = DirectoryFixture()
  let model = WebsiteNavigationModel()
  model.connect(try directoryClient(fixture))
  await fixture.configure(hold: true)
  let initial = Task { await model.load(locale: "en") }
  try await fixture.waitUntilHeld()
  let localized = Task { await model.load(locale: "zh-CN") }
  await Task.yield()
  model.invalidate([.pluginUpdate])
  await fixture.release()
  await initial.value
  await localized.value
  #expect(model.panels?.first?.title == "开发资源" && model.canOpen)
  #expect(await fixture.requests.count == 2)
}

@MainActor @Test func websiteDirectoryReconnectDropsLateResultsAndKeepsSearch() async throws {
  let old = DirectoryFixture()
  let fresh = DirectoryFixture()
  let model = WebsiteNavigationModel()
  model.connect(try directoryClient(old))
  model.query = "handbook"
  await old.configure(hold: true)
  let loading = Task { await model.load(locale: "en") }
  try await old.waitUntilHeld()
  model.connect(try directoryClient(fresh))
  await fresh.configure(empty: true)
  await model.load(locale: "en")
  await old.release()
  await loading.value
  #expect(model.panels?.isEmpty == true && !model.loading && model.error == nil && model.query == "handbook")
  model.connect(nil)
  #expect(model.panels == nil && !model.canOpen)
}

@MainActor @Test func websiteDirectoryKeysIncludePluginIdentityAndDestinationsRequireSafeHTTPS() throws {
  let decode = { (data: Data) in try JSONDecoder().decode([NavigationPanel].self, from: data)[0] }
  let first = try decode(directoryData())
  let second = try decode(directoryData(plugin: "@example/other"))
  #expect(first.id != second.id && first.panelID == second.panelID)
  let model = WebsiteNavigationModel()
  let rows = model.visibleEntries(first) + model.visibleEntries(second)
  #expect(Set(rows.map(\.id)).count == 4)
  model.query = "metrics"
  #expect(model.visibleEntries(second).map(\.id) == [rows[3].id])
  #expect(first.links.first?.destination?.absoluteString == "https://example.com/docs")
  for url in [
    "http://example.com", "file:///tmp/link", "javascript:alert(1)", "https://user:secret@example.com",
    "https://example.com/\ninvalid", "/software",
  ] {
    #expect(try decode(directoryData(url: url)).links.first?.destination == nil)
  }
}

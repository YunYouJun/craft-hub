import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private let sourceNavigationCatalog = #"""
  {"integrations":[{"id":"fixture","actions":[
  {"id":"configuration","title":"Configuration","operation":"configuration.list","effect":"local-read","effectiveConfirmation":"never"},
  {"id":"update","title":"Save","operation":"configuration.update","effect":"local-write","effectiveConfirmation":"always"}],
  "views":[{"id":"configuration","title":"Configuration","scope":"global","blocks":[{"id":"configuration","type":"entity-list","actionId":"configuration"}]},
  {"id":"tasks","title":"Tasks","scope":"global","blocks":[]}]}],"diagnostics":[]}
  """#

private actor SourceNavigationFixture {
  private(set) var requests: [URLRequest] = []
  private(set) var held = false
  private var hold: String?
  private var fail: String?
  private var continuation: CheckedContinuation<Void, Never>?

  func configure(hold: String? = nil, fail: String? = nil) {
    self.hold = hold
    self.fail = fail
  }

  func release() {
    hold = nil
    held = false
    continuation?.resume()
    continuation = nil
  }

  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    requests.append(request)
    let action = request.url!.lastPathComponent
    if hold == action {
      held = true
      await withCheckedContinuation { continuation = $0 }
    }
    if fail == action { throw URLError(.timedOut) }
    let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    if action == "integrations" { return (Data(sourceNavigationCatalog.utf8), response) }
    let result: [String: Any] = [
      "version": 1, "kind": "entities",
      "page": [
        "items": [
          [
            "id": "fixture", "key": "fixture", "title": "Fixture", "active": true, "personal": false,
            "configurationToggle": [
              "enabled": action != "update", "inherited": false, "revision": "current", "scope": "global",
            ],
          ]
        ]
      ],
    ]
    return (try JSONSerialization.data(withJSONObject: result), response)
  }
}

@MainActor private func withSourceNavigationModel(
  _ fixture: SourceNavigationFixture,
  body: (WorkbenchModel, RuntimeAPIClient) async throws -> Void
) async throws {
  let suite = "craft-hub-source-navigation-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)",
      "nativeApiToken": token,
    ]))
  let client = RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) })
  let model = WorkbenchModel(defaults: defaults)
  model.integrations.connect(client)
  try await body(model, client)
}

@MainActor private func waitForSourceNavigation(_ predicate: @MainActor () async -> Bool) async throws {
  for _ in 0..<100 {
    if await predicate() { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("Source navigation did not reach the expected state")
}

@MainActor private func prepareSourceConfiguration(_ model: WorkbenchModel) async throws
  -> IntegrationWorkbenchModel.Review
{
  await model.integrations.loadCatalog()
  await model.integrations.select("fixture/configuration")
  model.selection = .workbenches
  model.select(.workbenches)
  let block = try #require(model.integrations.entry?.view.blocks.first)
  let item = try #require(model.integrations.state(block).page?.items.first)
  model.integrations.prepareToggle(block, item: item, enabled: false)
  return try #require(model.integrations.review)
}

@MainActor @Test func sourceNavigationWaitsForAnExistingCatalogReadBeforeOpeningTheNativeSource() async throws {
  let fixture = SourceNavigationFixture()
  await fixture.configure(hold: "integrations")
  try await withSourceNavigationModel(fixture) { model, _ in
    let loading = Task { await model.integrations.loadCatalog() }
    try await waitForSourceNavigation { await fixture.held }
    model.navigateToWebPath("/integrations/fixture/tasks")
    for _ in 0..<10 { await Task.yield() }
    #expect(model.presentsNativeContent && !model.webContentRequested)
    await fixture.release()
    await loading.value
    try await waitForSourceNavigation { model.integrations.entryID == "fixture/tasks" || model.webContentRequested }
    #expect(model.selection == .workbenches && model.integrations.entryID == "fixture/tasks")
    #expect(model.presentsNativeContent && !model.webContentRequested && model.navigationError == nil)
    #expect(await fixture.requests.filter { $0.url?.lastPathComponent == "integrations" }.count == 1)
  }
}

@MainActor @Test func sourceNavigationDoesNotOpenWebOrDiscardABusyConfigurationWrite() async throws {
  let fixture = SourceNavigationFixture()
  try await withSourceNavigationModel(fixture) { model, _ in
    let review = try await prepareSourceConfiguration(model)
    await fixture.configure(hold: "update")
    let write = Task { await model.integrations.confirm(review) }
    try await waitForSourceNavigation { await fixture.held }
    #expect(model.integrations.busy)
    model.navigateToWebPath("/integrations/fixture/tasks")
    try await waitForSourceNavigation { model.navigationError != nil || model.webContentRequested }
    #expect(model.presentsNativeContent && !model.webContentRequested && model.navigationError != nil)
    #expect(model.integrations.entryID == "fixture/configuration" && model.integrations.busy)
    await fixture.release()
    await write.value
    #expect(model.integrations.notice != nil && !model.integrations.busy)
    model.navigateToWebPath("/integrations/fixture/tasks")
    try await waitForSourceNavigation { model.integrations.entryID == "fixture/tasks" || model.webContentRequested }
    #expect(model.selection == .workbenches && model.integrations.entryID == "fixture/tasks")
    #expect(model.presentsNativeContent && !model.webContentRequested && model.navigationError == nil)
  }
}

@MainActor @Test func sourceNavigationReopensTheCurrentSourceDuringABusyWriteWithoutResettingIt() async throws {
  let fixture = SourceNavigationFixture()
  try await withSourceNavigationModel(fixture) { model, _ in
    let review = try await prepareSourceConfiguration(model)
    let block = try #require(model.integrations.entry?.view.blocks.first)
    let state = model.integrations.state(block)
    await fixture.configure(hold: "update")
    let write = Task { await model.integrations.confirm(review) }
    try await waitForSourceNavigation { await fixture.held }
    let requests = await fixture.requests.count
    model.navigateToWebPath("/integrations/fixture/configuration")
    for _ in 0..<10 { await Task.yield() }
    #expect(model.navigationError == nil && model.presentsNativeContent && !model.webContentRequested)
    #expect(model.integrations.entryID == "fixture/configuration" && model.integrations.busy)
    #expect(model.integrations.state(block) === state)
    #expect(await fixture.requests.count == requests)
    await fixture.release()
    await write.value
    #expect(model.integrations.notice != nil && !model.integrations.busy)
  }
}

@MainActor @Test func sourceNavigationKeepsAnUncertainConfigurationReceiptOnTheNativePage() async throws {
  let fixture = SourceNavigationFixture()
  try await withSourceNavigationModel(fixture) { model, _ in
    let review = try await prepareSourceConfiguration(model)
    await fixture.configure(fail: "update")
    await model.integrations.confirm(review)
    #expect(model.integrations.uncertain != nil)
    model.navigateToWebPath("/integrations/fixture/tasks")
    try await waitForSourceNavigation { model.navigationError != nil || model.webContentRequested }
    #expect(model.presentsNativeContent && !model.webContentRequested && model.navigationError != nil)
    #expect(model.integrations.entryID == "fixture/configuration" && model.integrations.uncertain != nil)
  }
}

@MainActor @Test func sourceNavigationCatalogFailureStaysNativeAndOffersAnError() async throws {
  let fixture = SourceNavigationFixture()
  await fixture.configure(fail: "integrations")
  try await withSourceNavigationModel(fixture) { model, _ in
    model.navigateToWebPath("/integrations/fixture/tasks")
    try await waitForSourceNavigation { model.navigationError != nil || model.webContentRequested }
    #expect(model.presentsNativeContent && !model.webContentRequested && model.navigationError != nil)
    #expect(model.integrations.error != nil && model.integrations.entries.isEmpty)
  }
}

@MainActor @Test func sourceNavigationOnlyUsesTheWebFallbackAfterACompletedCatalogConfirmsNoNativeEntry() async throws {
  let fixture = SourceNavigationFixture()
  try await withSourceNavigationModel(fixture) { model, _ in
    model.navigateToWebPath("/integrations/missing/tasks")
    try await waitForSourceNavigation { model.webContentRequested }
    #expect(model.showsWebContent && !model.presentsNativeContent)
    #expect(!model.integrations.entries.isEmpty && model.integrations.error == nil)
  }
}

@MainActor @Test func sourceNavigationLateCatalogCannotReplaceTheUsersNewNativeDestination() async throws {
  let fixture = SourceNavigationFixture()
  await fixture.configure(hold: "integrations")
  try await withSourceNavigationModel(fixture) { model, _ in
    model.navigateToWebPath("/integrations/fixture/tasks")
    try await waitForSourceNavigation { await fixture.held }
    model.selection = .software
    model.select(.software)
    await fixture.release()
    try await waitForSourceNavigation { !model.integrations.loadingCatalog }
    for _ in 0..<10 { await Task.yield() }
    #expect(model.selection == .software && model.integrations.entryID.isEmpty)
    #expect(model.presentsNativeContent && !model.webContentRequested && model.navigationError == nil)
  }
}

@MainActor @Test func sourceNavigationOverviewFixtureReturnsToTheNativeHomePage() async throws {
  let fixture = SourceNavigationFixture()
  try await withSourceNavigationModel(fixture) { model, _ in
    model.navigateToWebPath("/tools")
    #expect(model.selection == .tools && model.presentsNativeContent)
    model.navigateToWebPath("/overview")
    #expect(model.selection == .overview && model.presentsNativeContent && !model.webContentRequested)
  }
}

@MainActor @Test func sourceNavigationLateCatalogCannotReplaceAnExplicitWebWorkbenchRequest() async throws {
  let fixture = SourceNavigationFixture()
  await fixture.configure(hold: "integrations")
  try await withSourceNavigationModel(fixture) { model, _ in
    model.navigateToWebPath("/integrations/fixture/tasks")
    try await waitForSourceNavigation { await fixture.held }
    model.showWebWorkbench()
    #expect(model.webContentRequested && model.showsWebContent)
    await fixture.release()
    try await waitForSourceNavigation { !model.integrations.loadingCatalog }
    for _ in 0..<10 { await Task.yield() }
    #expect(model.showsWebContent && !model.presentsNativeContent && model.integrations.entryID.isEmpty)
  }
}

@MainActor @Test func sourceNavigationLateCatalogCannotReplaceAnExplicitDesktopLink() async throws {
  let fixture = SourceNavigationFixture()
  await fixture.configure(hold: "integrations")
  try await withSourceNavigationModel(fixture) { model, _ in
    model.navigateToWebPath("/integrations/fixture/tasks")
    try await waitForSourceNavigation { await fixture.held }
    model.acceptDesktopLink(URL(string: "craft-hub://project/fixture")!)
    #expect(model.webContentRequested && model.showsWebContent && model.navigationError == nil)
    await fixture.release()
    try await waitForSourceNavigation { !model.integrations.loadingCatalog }
    for _ in 0..<10 { await Task.yield() }
    #expect(model.showsWebContent && !model.presentsNativeContent && model.integrations.entryID.isEmpty)
  }
}

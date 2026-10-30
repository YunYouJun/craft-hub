import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private func todayConnection() throws -> RuntimeConnection {
  let secret = String(repeating: "a", count: 64)
  return try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)",
      "nativeApiToken": secret,
    ]))
}

private actor TodayFixture {
  var calls: [String] = []
  var requestedLocales: [String] = []
  var analysisRequest: CheckedContinuation<Void, Never>?
  var analysisFinished = false
  var pauseRead = false
  var pendingRead: CheckedContinuation<Void, Never>?
  func pauseNextRead() { pauseRead = true }
  func releaseRead(pauseNext: Bool = false) {
    pendingRead?.resume()
    pendingRead = nil
    pauseRead = pauseNext
  }
  func response(_ request: URLRequest) async -> (Data, URLResponse) {
    calls.append("\(request.httpMethod ?? "GET") \(request.url!.path)")
    let json: String
    switch request.url!.path {
    case "/api/work-assistant": json = #"{"available":true}"#
    case "/api/work-assistant/focus":
      #expect(request.httpMethod == "POST")
      let body = try? JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any]
      #expect((body?["candidates"] as? [[String: Any]])?.count == 1)
      #expect(body?["localNow"] is String)
      await withCheckedContinuation { analysisRequest = $0 }
      analysisFinished = true
      json = #"{"summary":"Suggestion","items":[{"key":"one","reason":"Important","nextStep":"Review"}]}"#
    default:
      #expect(request.url!.path == "/api/workbench/today")
      requestedLocales.append(
        URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "locale" }?
          .value ?? "")
      let readNumber = requestedLocales.count
      if pauseRead {
        pauseRead = false
        await withCheckedContinuation { pendingRead = $0 }
      }
      json =
        #"{"version":1,"checkedAt":"2026-10-22T00:00:00Z","sourceCount":2,"total":1,"sources":[{"key":"source","title":"Tasks","path":"/integrations/tasks/todos","state":"loaded","complete":false,"cached":true,"count":1},{"key":"other","title":"Other","path":"/integrations/other/todos","state":"disconnected","complete":false,"cached":false,"count":0}],"items":[{"key":"one","title":"Review","sourceTitle":"Tasks","path":"/integrations/tasks/todos","reasons":["Important"]}],"candidates":[{"key":"one","title":"Review","source":"Tasks","reasons":["Important"]}]}"#
        .replacingOccurrences(of: "2026-10-22T00:00:00Z", with: String(format: "2026-10-22T00:00:%02dZ", readNumber))
    }
    return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
  func releaseAnalysis() {
    analysisRequest?.resume()
    analysisRequest = nil
  }
}

@MainActor @Test func periodicTodayRefreshKeepsBrowserVisibleButAccountInvalidationClearsIt() async throws {
  let fixture = TodayFixture()
  var date = Date()
  let model = TodayFocusModel(now: { date })
  model.connect(RuntimeAPIClient(connection: try todayConnection(), transport: { await fixture.response($0) }))
  await model.load()
  date = date.addingTimeInterval(61)
  await fixture.pauseNextRead()
  let refresh = Task { await model.load() }
  for _ in 0..<100 {
    if await fixture.pendingRead != nil { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(model.loading && model.snapshot?.sources.first?.key == "source")
  model.invalidate()
  #expect(model.snapshot == nil)
  await fixture.releaseRead()
  await refresh.value
  #expect(model.snapshot == nil)
}

@MainActor @Test func configurationSyncHeartbeatKeepsTheTodayBrowserWithoutReadingWorkSources() async throws {
  let fixture = TodayFixture()
  let suite = "craft-hub-today-heartbeat-\(UUID())"
  let defaults = try #require(UserDefaults(suiteName: suite))
  defer { defaults.removePersistentDomain(forName: suite) }
  let workbench = WorkbenchModel(defaults: defaults)
  workbench.today.connect(
    RuntimeAPIClient(connection: try todayConnection(), transport: { await fixture.response($0) }))
  await workbench.today.load()
  let loaded = try #require(workbench.today.snapshot)
  workbench.invalidate([.configurationSync])
  await workbench.today.load()
  #expect(workbench.today.snapshot?.checkedAt == loaded.checkedAt)
  #expect(workbench.today.snapshot?.items.map(\.key) == loaded.items.map(\.key))
  #expect(await fixture.calls.count == 2)
  await fixture.pauseNextRead()
  workbench.invalidate([.integrations])
  let refresh = Task { await workbench.today.load() }
  for _ in 0..<100 {
    if await fixture.pendingRead != nil { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(workbench.today.loading && workbench.today.snapshot?.sources.first?.key == "source")
  workbench.invalidate([.userConfig])
  #expect(workbench.today.snapshot == nil)
  workbench.today.connect(nil)
  await fixture.releaseRead()
  await refresh.value
  #expect(workbench.today.snapshot == nil)
  #expect(await fixture.calls.allSatisfy { ["GET /api/workbench/today", "GET /api/work-assistant"].contains($0) })
}

@MainActor @Test func todayPerformanceRecreatedViewsReuseTheCacheAndTheSamePendingRead() async throws {
  let fixture = TodayFixture()
  var date = Date()
  let model = TodayFocusModel(now: { date }, locale: { "en" })
  model.connect(RuntimeAPIClient(connection: try todayConnection(), transport: { await fixture.response($0) }))
  await fixture.pauseNextRead()
  let firstView = Task { await model.load() }
  for _ in 0..<100 {
    if await fixture.pendingRead != nil { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(model.loading)
  let reopenedView = Task { await model.load() }
  for _ in 0..<10 { await Task.yield() }
  #expect(await fixture.requestedLocales == ["en"])
  await fixture.releaseRead()
  await firstView.value
  await reopenedView.value
  await model.load()
  #expect(await fixture.calls.count == 2)
  date = date.addingTimeInterval(61)
  await model.load()
  #expect(await fixture.requestedLocales == ["en", "en"])
  await model.refreshWorkItems()
  #expect(await fixture.requestedLocales == ["en", "en", "en"])
}

@MainActor @Test func todayPerformanceLanguageChangesReplaceAnOlderPendingLocaleWithoutWaitingForIt() async throws {
  let fixture = TodayFixture()
  var language = "en"
  let model = TodayFocusModel(locale: { language })
  model.connect(RuntimeAPIClient(connection: try todayConnection(), transport: { await fixture.response($0) }))
  await fixture.pauseNextRead()
  let oldLocale = Task { await model.load() }
  for _ in 0..<100 {
    if await fixture.pendingRead != nil { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(model.loading && model.snapshot == nil)
  language = "zh-CN"
  let newLocale = Task { await model.load() }
  for _ in 0..<100 {
    if await fixture.requestedLocales.count == 2, model.snapshot != nil, !model.loading { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(await fixture.requestedLocales == ["en", "zh-CN"])
  #expect(model.snapshot != nil && !model.loading)
  await fixture.releaseRead()
  await oldLocale.value
  await newLocale.value
  #expect(model.snapshot != nil && !model.loading && model.error == nil)
  await model.load()
  #expect(await fixture.requestedLocales == ["en", "zh-CN"])
}

@MainActor @Test func todayPerformanceChangesDuringAReadPreserveVisibleRowsAndCoalesceOneFreshFollowup() async throws {
  let fixture = TodayFixture()
  var date = Date()
  let model = TodayFocusModel(now: { date }, locale: { "en" })
  model.connect(RuntimeAPIClient(connection: try todayConnection(), transport: { await fixture.response($0) }))
  await model.load()
  let visible = try #require(model.snapshot?.checkedAt)
  date = date.addingTimeInterval(61)
  await fixture.pauseNextRead()
  let oldRead = Task { await model.load() }
  for _ in 0..<100 {
    if await fixture.pendingRead != nil { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(model.loading && model.snapshot?.checkedAt == visible)
  for _ in 0..<10 { model.markWorkItemsStale() }
  let joinedRead = Task { await model.load() }
  await fixture.releaseRead(pauseNext: true)
  for _ in 0..<100 {
    if await fixture.requestedLocales.count == 3, await fixture.pendingRead != nil { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(await fixture.requestedLocales.count == 3)
  #expect(model.loading && model.snapshot?.checkedAt == visible)
  await fixture.releaseRead()
  await oldRead.value
  await joinedRead.value
  #expect(model.snapshot?.checkedAt == "2026-10-22T00:00:03Z" && !model.loading && model.error == nil)
  await model.load()
  #expect(await fixture.requestedLocales.count == 3)
}

@MainActor @Test func nativeTodayReadsCoverageWithoutAutomaticallyInvokingAIAndRefreshesAfterInvalidation() async throws
{
  let fixture = TodayFixture()
  let model = TodayFocusModel()
  model.connect(RuntimeAPIClient(connection: try todayConnection(), transport: { await fixture.response($0) }))
  await model.load()
  #expect(model.snapshot?.loadedSourceCount == 1 && model.snapshot?.completeSourceCount == 0)
  #expect(model.snapshot?.sources.first?.cached == true)
  #expect(model.assistantAvailable && model.analysis == nil)
  #expect(await fixture.calls.allSatisfy { $0.hasPrefix("GET ") })
  await model.load()
  #expect(await fixture.calls.count == 2)
  model.invalidate()
  #expect(model.snapshot == nil)
  await model.load()
  #expect(await fixture.calls.count == 4)
  model.connect(nil)
  #expect(model.snapshot == nil && !model.assistantAvailable)
}

@MainActor @Test func lateAIRecommendationsCannotRestoreAChangedAccountSnapshot() async throws {
  let fixture = TodayFixture()
  let model = TodayFocusModel()
  model.connect(RuntimeAPIClient(connection: try todayConnection(), transport: { await fixture.response($0) }))
  await model.load()
  let analysis = Task { await model.analyze() }
  for _ in 0..<100 {
    if await fixture.analysisRequest != nil { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(model.analyzing)
  model.invalidate()
  await fixture.releaseAnalysis()
  await analysis.value
  #expect(model.analysis == nil && model.snapshot == nil && !model.analyzing)
}

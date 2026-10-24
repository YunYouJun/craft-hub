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
  var analysisRequest: CheckedContinuation<Void, Never>?
  var analysisFinished = false
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
      json =
        #"{"version":1,"checkedAt":"2026-10-22T00:00:00Z","sourceCount":2,"total":1,"sources":[{"key":"source","title":"Tasks","path":"/integrations/tasks/todos","state":"loaded","complete":false,"cached":true,"count":1},{"key":"other","title":"Other","path":"/integrations/other/todos","state":"disconnected","complete":false,"cached":false,"count":0}],"items":[{"key":"one","title":"Review","sourceTitle":"Tasks","path":"/integrations/tasks/todos","reasons":["Important"]}],"candidates":[{"key":"one","title":"Review","source":"Tasks","reasons":["Important"]}]}"#
    }
    return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
  func releaseAnalysis() {
    analysisRequest?.resume()
    analysisRequest = nil
  }
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

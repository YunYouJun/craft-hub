import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private let externalExtensionJSON =
  #"{"id":"fixture","name":"Fixture","manifestPath":"/fixture/distribution.json","modules":["/fixture/host.mjs"],"enabled":true}"#
private actor ExtensionFixture {
  var requests: [URLRequest] = []
  var failInstallation = false
  var holdPreview = false
  var waiter: CheckedContinuation<Void, Never>?
  func fail(_ value: Bool) { failInstallation = value }
  func hold() { holdPreview = true }
  func release() {
    waiter?.resume()
    waiter = nil
  }
  func response(_ request: URLRequest) async -> (Data, URLResponse) {
    requests.append(request)
    let path = request.url!.lastPathComponent
    let body: String
    var status = 200
    switch path {
    case "preview":
      if holdPreview { await withCheckedContinuation { waiter = $0 } }
      body = "{\"id\":\"review-\(requests.count)\",\"extension\":\(externalExtensionJSON)}"
    case "install" where failInstallation:
      status = 409
      body = #"{"error":"Registration changed; review again"}"#
    case "cancel": body = #"{"cancelled":true}"#
    default:
      body = "{\"extensions\":[\(externalExtensionJSON)],\"diagnostics\":[],\"restartRequired\":true}"
    }
    return (
      Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    )
  }
}
@MainActor private func extensionModel(_ fixture: ExtensionFixture) throws -> HostExtensionsModel {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  let model = HostExtensionsModel()
  model.connect(RuntimeAPIClient(connection: connection) { await fixture.response($0) })
  return model
}

@MainActor @Test func nativeExternalRegistrationRequiresExplicitConfirmationAndSendsTheEntireReview() async throws {
  let fixture = ExtensionFixture()
  let model = try extensionModel(fixture)
  await model.preview("/fixture/distribution.json")
  #expect(model.canConfirm && model.review?.extension.modules == ["/fixture/host.mjs"])
  #expect(await fixture.requests.filter { $0.url?.lastPathComponent == "install" }.isEmpty)
  model.cancelReview()
  await model.confirm()
  #expect(await fixture.requests.filter { $0.url?.lastPathComponent == "install" }.isEmpty)
  await model.preview("/fixture/distribution.json")
  let id = try #require(model.review?.id)
  await model.confirm()
  #expect(model.review == nil && !model.canConfirm && model.snapshot?.restartRequired == true)
  let request = try #require(await fixture.requests.first { $0.url?.lastPathComponent == "install" })
  let body = try #require(try JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
  let reviewed = try #require(body["reviewed"] as? [String: Any])
  #expect(reviewed["id"] as? String == id)
  #expect((reviewed["extension"] as? [String: Any])?["modules"] as? [String] == ["/fixture/host.mjs"])
  #expect(reviewed["previous"] == nil)
  #expect(
    request.value(forHTTPHeaderField: "Cookie") == nil && request.value(forHTTPHeaderField: "Authorization") != nil)
  let host = try #require(model.snapshot?.extensions.first)
  await model.setExternal(host)
  await model.remove(host)
  for request in await fixture.requests.filter({ ["enable", "remove"].contains($0.url!.lastPathComponent) }) {
    let body = try #require(try JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
    #expect((body["expected"] as? [String: Any])?["modules"] as? [String] == host.modules)
  }
}

@MainActor @Test func failedExternalInstallationConsumesApprovalUntilTheUserReadsAndReviewsAgain() async throws {
  let fixture = ExtensionFixture()
  let model = try extensionModel(fixture)
  await model.preview("/fixture/distribution.json")
  await fixture.fail(true)
  await model.confirm()
  #expect(model.review != nil && model.reviewConsumed && !model.canConfirm && model.reviewError != nil)
  await model.confirm()
  #expect(await fixture.requests.filter { $0.url?.lastPathComponent == "install" }.count == 1)
  await fixture.fail(false)
  await model.preview("/fixture/distribution.json", keepingReview: true)
  #expect(model.canConfirm && model.reviewError == nil)
  await model.confirm()
  #expect(model.review == nil && model.snapshot?.restartRequired == true)
}

@MainActor @Test func disconnectedExternalPreviewIsCancelledInsteadOfRestoringATrustDialog() async throws {
  let fixture = ExtensionFixture()
  let model = try extensionModel(fixture)
  await fixture.hold()
  let task = Task { await model.preview("/fixture/distribution.json") }
  for _ in 0..<100 {
    if await fixture.waiter != nil { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(model.busy)
  model.connect(nil)
  await fixture.release()
  await task.value
  #expect(model.review == nil && !model.canConfirm && !model.busy && model.snapshot == nil)
  #expect(await fixture.requests.map { $0.url!.lastPathComponent } == ["preview", "cancel"])
}

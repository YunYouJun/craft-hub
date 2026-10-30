import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private func activityClient(
  _ handler: @escaping (URLRequest) async throws -> String
) throws -> RuntimeAPIClient {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  return RuntimeAPIClient(connection: connection) { request in
    let json = try await handler(request)
    return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
}

private let activityReviewJSON =
  #"{"version":1,"review":{"id":"review","action":"install","hooksPath":"/fixture/hooks.json","bridgePath":"/fixture/native/bridge.sh","ownHookCount":0,"otherHookCount":4,"expiresAt":"2099-01-01T00:00:00Z"}}"#
private let activityInstalledJSON =
  #"{"version":1,"status":{"installed":true,"supported":true,"ownHookCount":4,"otherHookCount":4,"runningSessionIds":[],"requiresTrustReview":true}}"#
private let activityDisabledJSON =
  #"{"version":1,"status":{"installed":false,"supported":true,"ownHookCount":0,"otherHookCount":4,"runningSessionIds":[]}}"#
private func activityAction(_ request: URLRequest) throws -> String {
  guard let body = request.httpBody else { return "status" }
  return (try JSONSerialization.jsonObject(with: body) as? [String: String])?["action"] ?? "unknown"
}

@MainActor @Test func activityConsentCancellationNeverSubmitsAWrite() async throws {
  var actions: [String] = []
  let model = CodexActivityModel()
  model.connect(
    try activityClient { request in
      #expect(request.url?.path == "/api/native-host/codex-activity")
      #expect(request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true)
      #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
      let action = try activityAction(request)
      actions.append(action)
      return action == "review" ? activityReviewJSON : #"{"version":1}"#
    })
  await model.change(install: true) { review in
    #expect(review.otherHookCount == 4 && review.hooksPath == "/fixture/hooks.json")
    #expect(model.busy)
    return false
  }
  #expect(actions == ["review", "cancel"])
  #expect(!model.busy && !model.uncertain && model.error == nil)
}

@MainActor @Test func activityReconnectRetiresAnOpenReviewBeforeAnAcceptedReply() async throws {
  var actions: [String] = []
  var consent: CheckedContinuation<Bool, Never>?
  let (ready, signal) = AsyncStream<Void>.makeStream()
  let model = CodexActivityModel()
  model.connect(
    try activityClient { request in
      let action = try activityAction(request)
      actions.append(action)
      return action == "review" ? activityReviewJSON : #"{"version":1}"#
    })
  let changing = Task {
    await model.change(install: true) { _ in
      await withCheckedContinuation {
        consent = $0
        signal.yield()
      }
    }
    signal.finish()
  }
  for await _ in ready { break }
  #expect(consent != nil && model.busy)
  model.connect(nil)
  consent?.resume(returning: true)
  await changing.value
  #expect(actions == ["review", "cancel"])
  #expect(model.status == nil && !model.available && !model.busy)
}

@MainActor @Test func uncertainActivityWritesRequireFreshStatusAndANewReview() async throws {
  var actions: [String] = []
  var applied = false
  let model = CodexActivityModel()
  model.connect(
    try activityClient { request in
      let action = try activityAction(request)
      actions.append(action)
      switch action {
      case "review": return activityReviewJSON
      case "apply":
        if !applied {
          applied = true
          throw URLError(.timedOut)
        }
        return activityInstalledJSON
      default: return activityInstalledJSON
      }
    })
  await model.change(install: true) { _ in true }
  #expect(model.uncertain && model.error != nil)
  await model.change(install: true) { _ in true }
  #expect(actions == ["review", "apply"])
  await model.refresh()
  #expect(!model.uncertain && model.status?.installed == true)
  await model.change(install: true) { _ in true }
  #expect(actions == ["review", "apply", "status", "review", "apply"])
}

@MainActor @Test func lateActivityReadsAndWritesCannotRestoreAnOlderState() async throws {
  var read: CheckedContinuation<Void, Never>?
  let (readReady, readSignal) = AsyncStream<Void>.makeStream()
  let model = CodexActivityModel()
  model.connect(
    try activityClient { request in
      switch try activityAction(request) {
      case "status":
        await withCheckedContinuation {
          read = $0
          readSignal.yield()
        }
        return activityDisabledJSON
      case "review": return activityReviewJSON
      default: return activityInstalledJSON
      }
    })
  let pending = Task {
    await model.refresh()
    readSignal.finish()
  }
  for await _ in readReady { break }
  await model.change(install: true) { _ in true }
  read?.resume()
  await pending.value
  #expect(model.status?.installed == true)

  var write: CheckedContinuation<Void, Never>?
  let (writeReady, writeSignal) = AsyncStream<Void>.makeStream()
  model.connect(
    try activityClient { request in
      if try activityAction(request) == "review" { return activityReviewJSON }
      await withCheckedContinuation {
        write = $0
        writeSignal.yield()
      }
      return activityInstalledJSON
    })
  let changing = Task {
    await model.change(install: true) { _ in true }
    writeSignal.finish()
  }
  for await _ in writeReady { break }
  model.connect(nil)
  write?.resume()
  await changing.value
  #expect(model.status == nil && !model.busy && !model.uncertain)
}

@MainActor @Test func aMismatchedActivityReviewNeverReachesConsentOrApply() async throws {
  let model = CodexActivityModel()
  var requests = 0
  model.connect(
    try activityClient { _ in
      requests += 1
      return activityReviewJSON
    })
  await model.change(install: false) { _ in
    Issue.record("Unexpected consent for a mismatched action")
    return true
  }
  #expect(requests == 1 && model.error != nil && !model.uncertain)
}

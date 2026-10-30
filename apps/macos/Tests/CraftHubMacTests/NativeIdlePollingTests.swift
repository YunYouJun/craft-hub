import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private actor IdlePollingClock {
  private(set) var intervals: [Duration] = []
  private var waiters: [UUID: CheckedContinuation<Void, Error>] = [:]

  func sleep(_ duration: Duration) async throws {
    try Task.checkCancellation()
    intervals.append(duration)
    let id = UUID()
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        if Task.isCancelled { continuation.resume(throwing: CancellationError()) } else { waiters[id] = continuation }
      }
    } onCancel: {
      Task { await self.cancel(id) }
    }
  }

  private func cancel(_ id: UUID) { waiters.removeValue(forKey: id)?.resume(throwing: CancellationError()) }

  func advance() {
    let pending = waiters.values
    waiters = [:]
    for waiter in pending { waiter.resume() }
  }
}

private actor IdlePollingFixture {
  private(set) var cloudReads = 0
  private(set) var activityReads = 0
  var cloudState = "disabled"
  var activityInstalled = false
  private var cloudFailure = false

  func configure(cloudState: String = "disabled", activityInstalled: Bool = false, failCloud: Bool = false) {
    self.cloudState = cloudState
    self.activityInstalled = activityInstalled
    cloudFailure = failCloud
  }

  func response(_ request: URLRequest) async throws -> (Data, URLResponse) {
    let value: [String: Any]
    if request.url!.lastPathComponent == "cloud" {
      cloudReads += 1
      if cloudFailure {
        cloudFailure = false
        throw URLError(.timedOut)
      }
      value = ["version": 1, "status": ["state": cloudState], "approvals": []]
    } else {
      activityReads += 1
      value = [
        "version": 1,
        "status": ["installed": activityInstalled, "supported": true, "runningSessionIds": []],
      ]
    }
    return (
      try JSONSerialization.data(withJSONObject: value),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
}

private func idlePollingClient(_ fixture: IdlePollingFixture) throws -> RuntimeAPIClient {
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)",
      "nativeApiToken": token,
    ]))
  return RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) })
}

@MainActor private func waitForIdlePolling(_ predicate: @MainActor () async -> Bool) async throws {
  for _ in 0..<100 {
    if await predicate() { return }
    try await Task.sleep(for: .milliseconds(5))
  }
  Issue.record("Polling did not reach the expected state")
}

@MainActor @Test func nativeIdlePollingDisabledCloudStopsAfterItsFirstSuccessfulRead() async throws {
  let fixture = IdlePollingFixture()
  let clock = IdlePollingClock()
  let model = NativeCloudModel(sleep: { try await clock.sleep($0) })
  model.connect(try idlePollingClient(fixture))
  try await waitForIdlePolling { model.snapshot?.status.state == "disabled" }
  try await Task.sleep(for: .milliseconds(25))
  await clock.advance()
  try await Task.sleep(for: .milliseconds(25))
  #expect(await fixture.cloudReads == 1)
  #expect(await clock.intervals.isEmpty)
  model.connect(nil)
}

@MainActor @Test func nativeIdlePollingActivityDoesNotReadUntilSettingsAreObserved() async throws {
  let fixture = IdlePollingFixture()
  let clock = IdlePollingClock()
  let model = CodexActivityModel(sleep: { try await clock.sleep($0) })
  model.connect(try idlePollingClient(fixture))
  try await Task.sleep(for: .milliseconds(25))
  await clock.advance()
  try await Task.sleep(for: .milliseconds(25))
  #expect(await fixture.activityReads == 0)
  #expect(model.status == nil)
  model.connect(nil)
}

@MainActor @Test func nativeIdlePollingCloudReconnectResumesConnectingAndErrorCadences() async throws {
  let fixture = IdlePollingFixture()
  let clock = IdlePollingClock()
  let model = NativeCloudModel(sleep: { try await clock.sleep($0) })
  model.connect(try idlePollingClient(fixture))
  try await waitForIdlePolling { model.snapshot?.status.state == "disabled" }
  await fixture.configure(cloudState: "connecting")
  model.connect(try idlePollingClient(fixture))
  try await waitForIdlePolling { await clock.intervals.count == 1 }
  #expect(model.snapshot?.status.state == "connecting")
  #expect(await fixture.cloudReads == 2)
  await clock.advance()
  try await waitForIdlePolling { await clock.intervals.count == 2 }
  #expect(await fixture.cloudReads == 3)
  #expect(await clock.intervals == [.seconds(2), .seconds(2)])
  await fixture.configure(cloudState: "connected", failCloud: true)
  await clock.advance()
  try await waitForIdlePolling { await clock.intervals.count == 3 }
  #expect(model.error != nil)
  #expect(await clock.intervals.last == .seconds(10))
  model.connect(nil)
}

@MainActor @Test func nativeIdlePollingActivityObservationStopsWhenClosedAndReopensWithFreshStatus() async throws {
  let fixture = IdlePollingFixture()
  let clock = IdlePollingClock()
  let model = CodexActivityModel(sleep: { try await clock.sleep($0) })
  model.connect(try idlePollingClient(fixture))
  let observing = Task { await model.observe() }
  try await waitForIdlePolling { await clock.intervals.count == 1 }
  #expect(await fixture.activityReads == 1)
  #expect(await clock.intervals.last == .seconds(5))
  await clock.advance()
  try await waitForIdlePolling { await clock.intervals.count == 2 }
  #expect(await fixture.activityReads == 2)
  observing.cancel()
  await observing.value
  await fixture.configure(activityInstalled: true)
  await clock.advance()
  try await Task.sleep(for: .milliseconds(25))
  #expect(await fixture.activityReads == 2)
  #expect(model.status?.installed == false)
  let reopened = Task { await model.observe() }
  try await waitForIdlePolling { model.status?.installed == true }
  #expect(await fixture.activityReads == 3)
  #expect(model.status?.installed == true)
  reopened.cancel()
  await reopened.value
  model.connect(nil)
}

@MainActor @Test func nativeIdlePollingActivityReconnectChangesTheVisibleTaskIdentity() async throws {
  let fixture = IdlePollingFixture()
  let clock = IdlePollingClock()
  let model = CodexActivityModel(sleep: { try await clock.sleep($0) })
  model.connect(try idlePollingClient(fixture))
  let oldID = model.observationID
  let observing = Task { await model.observe() }
  try await waitForIdlePolling { await clock.intervals.count == 1 }
  model.connect(try idlePollingClient(fixture))
  #expect(model.observationID != oldID && model.status == nil)
  await clock.advance()
  await observing.value
  #expect(await fixture.activityReads == 1)
  let replacement = Task { await model.observe() }
  try await waitForIdlePolling { await fixture.activityReads == 2 }
  replacement.cancel()
  await replacement.value
  model.connect(nil)
}

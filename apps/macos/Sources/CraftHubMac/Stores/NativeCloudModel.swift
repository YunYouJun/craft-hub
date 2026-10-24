import CraftHubMacCore
import Foundation
import Observation

@MainActor @Observable final class NativeCloudModel {
  private(set) var snapshot: NativeCloudSnapshot?
  private(set) var busy = false
  private(set) var error: String?
  var reviewPresented = false
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private var poll: Task<Void, Never>?
  @ObservationIgnored private var idleWaiters: [CheckedContinuation<Void, Never>] = []
  var available: Bool { client != nil }
  var operating: Bool { busy || snapshot?.status.busy == true }
  var approvals: [NativeCloudSnapshot.Approval] { error == nil ? snapshot?.approvals ?? [] : [] }

  func connect(_ client: RuntimeAPIClient?, pollAutomatically: Bool = true) {
    poll?.cancel()
    generation = UUID()
    self.client = client
    snapshot = nil
    busy = false
    for waiter in idleWaiters { waiter.resume() }
    idleWaiters.removeAll()
    error = nil
    reviewPresented = false
    guard client != nil, pollAutomatically else { return }
    let attempt = generation
    poll = Task { [weak self] in
      while !Task.isCancelled {
        guard let self, generation == attempt else { return }
        await refresh()
        do { try await Task.sleep(for: .seconds(error == nil ? 2 : 10)) } catch { return }
      }
    }
  }

  func refresh() async {
    guard let client, !busy else { return }
    let attempt = generation
    let read = revision
    do {
      let result = try await client.cloudSnapshot()
      guard attempt == generation, read == revision, !Task.isCancelled else { return }
      snapshot = result
    } catch {
      if attempt == generation, read == revision, !Task.isCancelled {
        self.error = L10n.text.copy("无法读取个人云状态，请重新检查。", "Cloud status is unavailable. Check again.")
      }
    }
  }

  func checkAgain() async {
    error = nil
    await refresh()
  }

  /// The web compatibility bridge receives status only; review IDs and command approval remain native-only.
  func bridge(_ action: String) async throws -> Any? {
    guard let client else { throw NativeHostChannelError.closed }
    let attempt = generation
    if action == "cloud-status" {
      let result = try await client.cloudSnapshot()
      guard generation == attempt else { throw NativeHostChannelError.closed }
      return try JSONSerialization.jsonObject(with: JSONEncoder().encode(result.status))
    }
    guard !operating, ["cloud-connect", "cloud-disconnect", "cloud-synchronize"].contains(action) else {
      throw NativeHostChannelError.busy
    }
    await perform(String(action.dropFirst("cloud-".count)))
    guard generation == attempt else { throw NativeHostChannelError.closed }
    if let error { throw RuntimeAPIError.rejected(400, error) }
    return nil
  }

  func perform(_ action: String, values: [String: String] = [:], accepted: Bool? = nil) async {
    guard let client, !busy else { return }
    let attempt = generation
    revision += 1
    busy = true
    error = nil
    defer {
      if attempt == generation {
        busy = false
        for waiter in idleWaiters { waiter.resume() }
        idleWaiters.removeAll()
      }
    }
    do {
      let result = try await client.cloudAction(action, values: values, accepted: accepted)
      guard attempt == generation else { return }
      snapshot = result
      if result.approvals.isEmpty { reviewPresented = false }
    } catch { if attempt == generation { self.error = error.localizedDescription } }
  }

  /// Callback credentials are consumed directly; they never enter the web inbox, preferences or a log.
  func adopt(_ url: URL) async {
    let attempt = generation
    guard client != nil, url.scheme == "craft-hub-native", url.host == "cloud", url.path == "/connect",
      url.absoluteString.utf8.count <= 2048
    else {
      error = L10n.text.copy(
        "连接回调无效或会话已结束，请重新连接。", "The connection callback is invalid or the session ended. Connect again.")
      return
    }
    if busy { await withCheckedContinuation { idleWaiters.append($0) } }
    guard attempt == generation else { return }
    await perform("callback", values: ["url": url.absoluteString])
  }
}

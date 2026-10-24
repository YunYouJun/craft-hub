import CraftHubMacCore
import Foundation
import Observation

/// Explicit downloads never change a running runtime, PATH or the user's executable preference.
@MainActor @Observable final class PrivateNodeModel {
  let store: PrivateNodeStore
  let release = try! PrivateNodeRelease.pinned()
  private(set) var busy = false
  private(set) var phase: PrivateNodePhase?
  private(set) var error: String?
  private(set) var installed: PrivateNodeState?
  @ObservationIgnored private var worker: Task<PrivateNodeReceipt, Error>?
  @ObservationIgnored private var operation = UUID()

  init(root: URL = NativeStorage.directory.appendingPathComponent("private-node")) {
    store = PrivateNodeStore(root: root)
    refresh()
  }
  func refresh() {
    do { installed = try store.state() } catch { self.error = error.localizedDescription }
  }
  func install(backend: URL) async -> Bool {
    guard !busy else { return false }
    let attempt = UUID()
    operation = attempt
    busy = true
    error = nil
    let store = store
    let release = release
    let worker = Task.detached(priority: .userInitiated) { [weak self] in
      try await PrivateNodeInstaller(store: store).install(
        release: release,
        validate: { node in
          try PrivateNodePreflight.validate(
            node: node, backend: backend,
            temporaryDirectory: store.root.appendingPathComponent("staging/preflight-" + UUID().uuidString))
        },
        progress: { [weak self] phase in
          Task { @MainActor in
            if self?.operation == attempt && self?.busy == true { self?.phase = phase }
          }
        })
    }
    self.worker = worker
    defer {
      if operation == attempt {
        busy = false
        self.worker = nil
        refresh()
      }
    }
    do {
      _ = try await worker.value
      phase = .complete
      return true
    } catch {
      if !(error is CancellationError) && !worker.isCancelled { self.error = error.localizedDescription }
      phase = nil
      return false
    }
  }
  func reportFailure(_ message: String) { error = message }
  func cancel() { worker?.cancel() }
  func rollback() async {
    guard !busy else { return }
    busy = true
    error = nil
    phase = nil
    let store = store
    do { installed = try await Task.detached { try store.rollback() }.value } catch {
      self.error = error.localizedDescription
    }
    busy = false
  }
  var status: String? {
    let text = L10n.text
    guard let phase else { return nil }
    switch phase {
    case .manifest: return text.copy("获取官方校验信息…", "Reading official checksums…")
    case .download: return text.copy("下载私有 Node…", "Downloading private Node…")
    case .verify: return text.copy("校验下载内容…", "Verifying the download…")
    case .extract: return text.copy("准备运行环境…", "Preparing the runtime…")
    case .validate: return text.copy("验证运行时启动…", "Checking runtime startup…")
    case .complete:
      return text.copy(
        "私有 Node 已准备好，本机已有 Node 仍优先使用。",
        "Private Node is ready. Compatible Node installations on this Mac still take priority.")
    }
  }
  var fraction: Double? {
    if case .download(let received, let expected) = phase, let expected, expected > 0 {
      return min(1, Double(received) / Double(expected))
    }
    return nil
  }
}

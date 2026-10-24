import AppKit
import CraftHubMacCore
import Foundation
import Observation

@MainActor @Observable final class CodexActivityModel {
  private(set) var status: CodexActivityStatus?
  private(set) var busy = false
  private(set) var uncertain = false
  private(set) var error: String?
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private var readRevision = 0
  @ObservationIgnored private var poll: Task<Void, Never>?
  @ObservationIgnored private var alert: NSAlert?
  var available: Bool { client != nil }

  func connect(_ client: RuntimeAPIClient?, pollAutomatically: Bool = true) {
    poll?.cancel()
    if let alert { alert.window.sheetParent?.endSheet(alert.window, returnCode: .abort) }
    generation = UUID()
    self.client = client
    status = nil
    busy = false
    uncertain = false
    error = nil
    guard client != nil, pollAutomatically else { return }
    let attempt = generation
    poll = Task { [weak self] in
      while !Task.isCancelled {
        guard let self, generation == attempt else { return }
        await refresh()
        do { try await Task.sleep(for: .seconds(error == nil ? 5 : 10)) } catch { return }
      }
    }
  }

  func refresh() async {
    guard let client, !busy else { return }
    let attempt = generation
    let read = revision
    readRevision += 1
    let readID = readRevision
    do {
      let result = try await client.codexActivityStatus()
      guard attempt == generation, read == revision, readID == readRevision, !Task.isCancelled else { return }
      status = result
      if let diagnostic = result.diagnostic {
        error = diagnostic
      } else {
        uncertain = false
        error = nil
      }
    } catch {
      if attempt == generation, read == revision, readID == readRevision { self.error = error.localizedDescription }
    }
  }

  /// Confirmation is injected in tests; production uses a native system sheet with Cancel as default.
  func change(install: Bool) async { await change(install: install, confirm: present) }

  func change(install: Bool, confirm: (CodexActivityReview) async throws -> Bool) async {
    guard let client, !busy, !uncertain else { return }
    let attempt = generation
    revision += 1
    busy = true
    error = nil
    var review: CodexActivityReview?
    var submitted = false
    defer { if attempt == generation { busy = false } }
    do {
      let prepared = try await client.reviewCodexActivity(install: install)
      review = prepared
      guard attempt == generation, !Task.isCancelled else {
        try? await client.cancelCodexActivity(prepared.id)
        return
      }
      let accepted = try await confirm(prepared)
      guard attempt == generation, !Task.isCancelled, accepted else {
        try? await client.cancelCodexActivity(prepared.id)
        return
      }
      submitted = true
      let result = try await client.applyCodexActivity(prepared.id)
      guard attempt == generation else { return }
      status = result
    } catch {
      if !submitted, let review { try? await client.cancelCodexActivity(review.id) }
      if attempt == generation {
        self.error = error.localizedDescription
        uncertain = submitted
      }
    }
  }

  /// Compatibility bridge delegates all writes to the same native consent flow as Settings.
  func bridge(_ action: String) async throws -> Any? {
    guard available, !busy,
      ["install-codex-activity-hooks", "uninstall-codex-activity-hooks"].contains(action)
    else { throw NativeHostChannelError.busy }
    let attempt = generation
    if uncertain { await refresh() }
    guard attempt == generation, !uncertain else { throw NativeHostChannelError.busy }
    await change(install: action == "install-codex-activity-hooks")
    guard attempt == generation else { throw NativeHostChannelError.closed }
    if let error { throw RuntimeAPIError.rejected(400, error) }
    await refresh()
    guard attempt == generation, let status else { throw NativeHostChannelError.closed }
    return try JSONSerialization.jsonObject(with: JSONEncoder().encode(status))
  }

  private func present(_ review: CodexActivityReview) async throws -> Bool {
    guard let window = NSApp.keyWindow else { throw NativeHostChannelError.closed }
    let text = L10n.text
    let install = review.action == "install"
    let alert = NSAlert()
    self.alert = alert
    alert.messageText =
      install
      ? text.copy("启用此资料的 Codex 活动？", "Enable Codex activity for this profile?")
      : text.copy("停用此资料的 Codex 活动？", "Disable Codex activity for this profile?")
    alert.informativeText = [
      install
        ? text.copy(
          "将写入本机活动桥脚本和四个生命周期 Hook。启用后仍需在 Codex 中审阅信任。",
          "Write the local activity bridge and four lifecycle hooks. Review their trust in Codex after enabling.")
        : text.copy(
          "仅移除此资料的 Hook，保留桥脚本和其他宿主的配置。",
          "Remove only this profile's hooks, retaining its bridge script and other hosts' configuration."),
      text.copy(
        "活动接收器只使用会话标识和生命周期事件，不保存提示词。",
        "The activity receiver uses session identifiers and lifecycle events without storing prompts."),
      "\(review.hooksPath)\n\(review.bridgePath)",
      text.copy("保留其他宿主的 Hook：", "Other hosts' hooks retained: ") + String(review.otherHookCount),
    ].joined(separator: "\n\n")
    alert.addButton(withTitle: text.copy("取消", "Cancel"))
    alert.addButton(withTitle: install ? text.copy("启用", "Enable") : text.copy("停用", "Disable"))
    alert.window.defaultButtonCell = alert.buttons[0].cell as? NSButtonCell
    // Materializing the alert window installs its default Return shortcut first.
    // Assign Escape afterwards; Return must not submit a configuration change.
    alert.buttons[0].keyEquivalent = "\u{1b}"
    alert.buttons[0].keyEquivalentModifierMask = []
    alert.buttons[1].keyEquivalent = ""
    return await withCheckedContinuation { continuation in
      alert.beginSheetModal(for: window) { response in
        if self.alert === alert { self.alert = nil }
        continuation.resume(returning: response == .alertSecondButtonReturn)
      }
    }
  }
}

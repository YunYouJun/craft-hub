import AppKit
import CraftHubMacCore
import Observation

@MainActor @Observable final class DefaultLinkModel {
  private(set) var current: LinkApplication?
  private(set) var previous: LinkApplication?
  private(set) var busy = false
  private(set) var error: String?
  private(set) var message: String?
  let available: Bool
  @ObservationIgnored private let service: URLSchemeHandover?

  init(service: URLSchemeHandover?, available: Bool) {
    self.service = service
    self.available = available
  }

  convenience init() {
    let info = Bundle.main.infoDictionary ?? [:]
    let types = info["CFBundleURLTypes"] as? [[String: Any]] ?? []
    let available =
      info["CraftHubPublicLinksEnabled"] as? Bool == true
      && types.contains(where: { ($0["CFBundleURLSchemes"] as? [String])?.contains("craft-hub") == true })
    let service = (try? LinkHandoverStore.account()).map {
      URLSchemeHandover(
        scheme: "craft-hub", application: Bundle.main.bundleURL, store: $0, enabled: available,
        registry: WorkspaceURLSchemeRegistry())
    }
    self.init(service: service, available: available)
  }

  func refresh() {
    guard !busy else { return }
    message = nil
    read()
  }

  private func read() {
    current = nil
    previous = nil
    do {
      guard let service else { throw LinkHandoverError.invalidReceipt }
      current = try service.current()
      previous = try service.receipt()?.previous
      error = nil
    } catch { self.error = error.localizedDescription }
  }

  func change(_ action: LinkHandoverReview.Action) async { await change(action, confirm: present) }

  func change(
    _ action: LinkHandoverReview.Action, confirm: (LinkHandoverReview) async -> Bool
  ) async {
    guard available, let service, !busy else { return }
    busy = true
    message = nil
    error = nil
    defer { busy = false }
    do {
      let review = try service.review(action)
      guard await confirm(review), !Task.isCancelled else { return }
      try await service.apply(review)
      read()
      if error == nil {
        message = L10n.text.copy("已核对系统的默认打开应用。", "Verified the system's default application.")
      }
    } catch {
      read()
      self.error = error.localizedDescription
    }
  }

  private func present(_ review: LinkHandoverReview) async -> Bool {
    guard let window = NSApp.keyWindow else { return false }
    let text = L10n.text
    let alert = NSAlert()
    alert.messageText = text.copy("更改 Craft Hub 链接的打开应用？", "Change the application for Craft Hub links?")
    alert.informativeText = [
      "craft-hub:",
      text.copy("当前应用：", "Current application: ") + review.current.path,
      text.copy("改为：", "Change to: ") + review.desired.path,
      text.copy(
        "以后打开公开链接将使用所选应用及其资料。请先完成资料迁移验收，并结束浏览器中尚未完成的设备连接。",
        "Future public links use the selected application and its profile. First verify your data migration and finish pending browser device connections."
      ),
      text.copy(
        "此操作不复制资料或连接账号。系统可能再次要求确认；保留原应用即可从此处恢复。",
        "This does not copy data or connect accounts. macOS may ask for confirmation; retain the original application to restore it here."
      ),
    ].joined(separator: "\n\n")
    alert.addButton(withTitle: text.copy("取消", "Cancel"))
    alert.addButton(withTitle: text.copy("更改打开应用", "Change Application"))
    alert.window.defaultButtonCell = alert.buttons[0].cell as? NSButtonCell
    alert.buttons[0].keyEquivalent = "\u{1b}"
    alert.buttons[0].keyEquivalentModifierMask = []
    alert.buttons[1].keyEquivalent = ""
    return await withCheckedContinuation { continuation in
      alert.beginSheetModal(for: window) { response in
        continuation.resume(returning: response == .alertSecondButtonReturn)
      }
    }
  }
}

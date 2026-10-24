import Combine
import CraftHubMacCore
import Sparkle
import SwiftUI

/// One application-lifetime Sparkle controller. Sparkle owns scheduling, preferences, UI and installation.
@MainActor
final class NativeUpdater: NSObject, ObservableObject, SPUUpdaterDelegate {
  @Published private(set) var canCheckForUpdates = false
  @Published private(set) var automaticallyChecks = false
  @Published private(set) var automaticallyDownloads = false
  @Published private(set) var lastCheck: Date?
  @Published private(set) var unavailableReason: String?
  private var controller: SPUStandardUpdaterController?
  private var configuration: NativeUpdateConfiguration?
  private var started = false

  var isAvailable: Bool { controller != nil && unavailableReason == nil }

  init(info: [String: Any] = Bundle.main.infoDictionary ?? [:]) {
    super.init()
    do {
      guard let configuration = try NativeUpdateConfiguration(info: info) else {
        unavailableReason = L10n.text.copy(
          "此本地构建未启用自动更新。请安装已签名的发布版本。",
          "Updates are unavailable in this local build. Install a signed release to enable updates.")
        return
      }
      self.configuration = configuration
      let controller = SPUStandardUpdaterController(
        startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)
      self.controller = controller
      controller.updater.publisher(for: \.canCheckForUpdates).assign(to: &$canCheckForUpdates)
      controller.updater.publisher(for: \.automaticallyChecksForUpdates).assign(to: &$automaticallyChecks)
      controller.updater.publisher(for: \.automaticallyDownloadsUpdates).assign(to: &$automaticallyDownloads)
      controller.updater.publisher(for: \.lastUpdateCheckDate).assign(to: &$lastCheck)
    } catch { unavailableReason = error.localizedDescription }
  }

  func start() {
    guard !started, let controller else { return }
    started = true
    do { try controller.updater.start() } catch {
      unavailableReason = error.localizedDescription
      canCheckForUpdates = false
    }
  }

  func checkForUpdates() {
    guard isAvailable, canCheckForUpdates else { return }
    controller?.checkForUpdates(nil)
  }

  // Change Sparkle's persisted preferences only in response to an explicit user action.
  func setAutomaticChecks(_ enabled: Bool) { controller?.updater.automaticallyChecksForUpdates = enabled }
  func setAutomaticDownloads(_ enabled: Bool) { controller?.updater.automaticallyDownloadsUpdates = enabled }

  func feedURLString(for updater: SPUUpdater) -> String? { configuration?.feedURL.absoluteString }
}

struct NativeUpdateCommands: Commands {
  @Environment(\.openWindow) private var openWindow
  @ObservedObject var updater: NativeUpdater
  private var text: L10n { L10n.text }

  var body: some Commands {
    CommandGroup(after: .appInfo) {
      Button(text.copy("检查更新…", "Check for Updates…")) { updater.checkForUpdates() }
        .disabled(!updater.isAvailable || !updater.canCheckForUpdates)
      Button(text.copy("软件更新设置…", "Software Update Settings…")) { openWindow(id: "software-updates") }
    }
  }
}

struct NativeUpdateSettings: View {
  @ObservedObject var updater: NativeUpdater
  private var text: L10n { L10n.text }

  var body: some View {
    Form {
      if let reason = updater.unavailableReason {
        Text(reason).foregroundStyle(.secondary)
      } else {
        Toggle(
          text.copy("自动检查更新", "Automatically check for updates"),
          isOn: Binding(get: { updater.automaticallyChecks }, set: updater.setAutomaticChecks))
        Toggle(
          text.copy("自动下载并在退出时安装更新", "Automatically download and install updates on quit"),
          isOn: Binding(get: { updater.automaticallyDownloads }, set: updater.setAutomaticDownloads)
        )
        .disabled(!updater.automaticallyChecks)
        if let date = updater.lastCheck {
          LabeledContent(text.copy("上次检查", "Last checked")) { Text(date, format: .dateTime) }
        }
        Button(text.copy("立即检查", "Check Now")) { updater.checkForUpdates() }
          .disabled(!updater.canCheckForUpdates)
        Text(
          text.copy(
            "更新由 Sparkle 检查和验证。自动检查默认每天进行一次，安装前会妥善关闭本地运行时。",
            "Sparkle checks and verifies updates. Automatic checks run daily; installation waits for the local runtime to shut down."
          )
        )
        .font(.caption).foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .frame(width: 480)
    .fixedSize(horizontal: false, vertical: true)
  }
}

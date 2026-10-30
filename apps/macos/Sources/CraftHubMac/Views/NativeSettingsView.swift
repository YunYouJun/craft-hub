import CraftHubMacCore
import SwiftUI

struct NativeSettingsView: View {
  let delegate: AppDelegate
  private var preferences: NativePreferences { .shared }
  private var settings: NativeSettingsModel { delegate.model.settings }
  private var text: L10n { L10n.text }
  @Environment(\.openWindow) private var openWindow

  var body: some View {
    Form {
      Section(text.copy("外观", "Appearance")) {
        Picker(
          text.copy("主题", "Theme"),
          selection: Binding(
            get: { preferences.theme }, set: { value in Task { await settings.update(theme: value) } }
          )
        ) {
          Text(text.copy("跟随系统", "System")).tag(RuntimePreferences.Theme.system)
          Text(text.copy("浅色", "Light")).tag(RuntimePreferences.Theme.light)
          Text(text.copy("深色", "Dark")).tag(RuntimePreferences.Theme.dark)
        }
        Picker(
          text.copy("语言", "Language"),
          selection: Binding(
            get: { preferences.language }, set: { value in Task { await settings.update(language: value) } }
          )
        ) {
          Text("简体中文").tag(RuntimePreferences.Language.chinese)
          Text("English").tag(RuntimePreferences.Language.english)
        }
      }.disabled(!settings.available || settings.saving)
      if settings.saving { ProgressView().controlSize(.small) }
      if let error = settings.error { NativeErrorView(message: error) }
      NativeCloudSettings(model: delegate.model.cloud)
      CodexActivitySettings(model: delegate.model.codexActivity)
      DefaultLinkSettings(model: delegate.defaultLinks)
      Section(text.copy("通知", "Notifications")) {
        Toggle(
          text.copy("后台任务完成时通知", "Notify when background tasks finish"),
          isOn: Binding(
            get: { delegate.notifications.enabled },
            set: { value in Task { await delegate.notifications.setEnabled(value) } }
          )
        ).disabled(delegate.notifications.requesting)
        if delegate.notifications.requesting {
          HStack {
            ProgressView().controlSize(.small)
            Text(
              text.copy("请在系统提示中选择是否允许通知。", "Respond to the system notification permission prompt.")
            ).font(.caption).foregroundStyle(.secondary)
          }
        }
        if let message = delegate.notifications.statusMessage {
          Text(message).font(.caption).foregroundStyle(.secondary)
        }
      }
      Section(text.copy("运行时", "Runtime")) {
        if case .ready(_, let node) = delegate.sidecar.state {
          LabeledContent("Node", value: node.version.description)
          Text(node.path).font(.caption).textSelection(.enabled)
        }
        Button(text.chooseNode) { delegate.sidecar.chooseNode(restart: false) }
        if let path = delegate.sidecar.explicitNodePath {
          Text(text.copy("下次启动使用：", "Use on next launch: ") + path).font(.caption).textSelection(.enabled)
        }
        PrivateNodeControls(sidecar: delegate.sidecar)
        Button(text.copy("软件更新…", "Software Updates…")) { openWindow(id: "software-updates") }
      }
      Section {
        Button(text.copy("完整设置…", "All Settings…")) {
          delegate.panels.showMainWindow()
          delegate.model.runWebCommand("settings")
        }
        Text(text.copy("编辑器和集成账户在完整工作台中继续管理。", "Manage editors and integration accounts in the full workbench."))
          .font(.caption).foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .nativePageFormContent()
    .frame(minWidth: 520, idealWidth: 640, minHeight: 560, idealHeight: 720)
  }
}

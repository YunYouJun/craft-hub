import SwiftUI

struct CodexActivitySettings: View {
  @Bindable var model: CodexActivityModel
  private var text: L10n { .text }
  private var stateLabel: String {
    guard model.available else { return text.copy("未连接", "Disconnected") }
    guard let status = model.status else { return text.copy("尚未读取", "Not checked") }
    guard status.diagnostic == nil else { return text.copy("无法确认", "Unknown") }
    return status.installed ? text.copy("已启用", "Enabled") : text.copy("未启用", "Disabled")
  }

  var body: some View {
    Section(text.copy("Codex 活动", "Codex Activity")) {
      LabeledContent(
        text.copy("此资料的 Hook", "Hooks for this profile"),
        value: stateLabel)
      if let status = model.status {
        Text(text.copy("运行中的会话：", "Running sessions: ") + String(status.runningSessionIds.count))
          .font(.caption).foregroundStyle(.secondary)
        if (status.otherHookCount ?? 0) > 0 {
          Text(text.copy("检测到其他宿主的 Hook，本次操作会保留它们。", "Other hosts' hooks are present and will be retained."))
            .font(.caption).foregroundStyle(.secondary)
        }
        if status.requiresTrustReview == true {
          Text(text.copy("请在 Codex 中审阅新 Hook 的信任。", "Review the new hooks' trust in Codex."))
        }
        if let diagnostic = status.diagnostic { NativeErrorView(message: diagnostic) }
      }
      HStack {
        Button(text.copy("重新检查", "Check Again")) { Task { await model.refresh() } }
          .disabled(model.busy || !model.available)
        if model.status?.installed != true {
          Button(text.copy("启用…", "Enable…")) { Task { await model.change(install: true) } }
            .disabled(
              model.busy || model.uncertain || model.status?.supported != true || model.status?.diagnostic != nil)
        }
        if (model.status?.ownHookCount ?? 0) > 0 {
          Button(text.copy("停用…", "Disable…")) { Task { await model.change(install: false) } }
            .disabled(model.busy || model.uncertain)
        }
        if model.busy { ProgressView().controlSize(.small) }
      }
      if model.uncertain {
        Text(
          text.copy(
            "写入结果尚未确认，请先重新检查，再审阅下一次操作。", "The write result is uncertain. Check again before reviewing another change."))
      }
      if let error = model.error { NativeErrorView(message: error) }
    }.task(id: model.observationID) { await model.observe() }
  }
}

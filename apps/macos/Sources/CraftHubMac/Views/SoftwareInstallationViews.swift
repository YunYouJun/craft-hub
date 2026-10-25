import CraftHubMacCore
import SwiftUI

struct SoftwarePlanView: View {
  @Bindable var model: SoftwareInstallationModel
  private var text: L10n { .text }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(text.copy("审阅安装计划", "Review Installation Plan")).font(.title2.bold())
      Text(
        text.copy(
          "只安装下面标记为安装的项目，已有软件由运行时跳过。", "Only items marked Install are installed. The runtime skips existing software."))
      if let error = model.error {
        NativeErrorView(message: error)
        Button(text.copy("刷新安装记录", "Refresh Installation History")) { Task { await model.loadRuns() } }
          .disabled(model.loadingRuns || !model.canReadHistory)
      }
      if let plan = model.plan {
        List {
          if !plan.prerequisites.isEmpty {
            Section(text.copy("先完成以下准备", "Prerequisites")) {
              ForEach(plan.prerequisites, id: \.self) { Text($0) }
            }
          }
          Section(text.copy("计划项目", "Plan Items")) {
            ForEach(plan.items) { item in
              VStack(alignment: .leading, spacing: 6) {
                HStack {
                  Text(item.title.localized(chinese: text.chinese)).font(.headline)
                  Spacer()
                  Text(
                    item.action == "install"
                      ? text.copy("安装", "Install")
                      : item.action == "skip" ? text.copy("跳过", "Skip") : text.copy("手动处理", "Manual"))
                }
                Text(item.installation.kind + (item.installation.packageId.map { " · " + $0 } ?? ""))
                  .font(.caption.monospaced()).textSelection(.enabled)
                if let reason = item.reason { Text(reason).foregroundStyle(.secondary) }
              }.padding(.vertical, 6)
            }
          }
        }
        if !model.supports(plan.sourceId, "install") {
          Text(
            text.copy(
              "当前来源暂不支持安装，请刷新目录和本机管理插件状态。", "Installation is unavailable. Refresh the catalog and local provider state."
            ))
        }
      }
      HStack {
        Button(text.copy("关闭", "Close")) { model.dismissPlan() }.keyboardShortcut(.cancelAction).disabled(
          model.installing)
        Spacer()
        if model.installing { ProgressView().controlSize(.small) }
        Button(text.copy("确认安装", "Confirm Installation")) { Task { await model.confirm() } }
          .disabled(!model.canConfirm).buttonStyle(.borderedProminent)
      }
    }.padding(24).frame(width: 640, height: 520).interactiveDismissDisabled(model.installing)
  }
}

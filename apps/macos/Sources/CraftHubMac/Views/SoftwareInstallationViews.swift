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

struct SoftwareInstallationsView: View {
  @Bindable var model: SoftwareInstallationModel
  @State private var stopping: SoftwareInstallationRun?
  private var text: L10n { .text }
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text(text.copy("安装记录", "Installation History")).font(.headline)
        Spacer()
        if model.loadingRuns { ProgressView().controlSize(.small) }
        Button(text.copy("刷新记录", "Refresh History")) { Task { await model.loadRuns() } }.disabled(
          model.loadingRuns || !model.canReadHistory)
      }.padding(.horizontal, 24)
      if let error = model.error { NativeErrorView(message: error).padding(.horizontal, 24) }
      ForEach(model.historyErrors.keys.sorted(), id: \.self) { source in
        NativeErrorView(message: "\(source): \(model.historyErrors[source] ?? "")").padding(.horizontal, 24)
      }
      List {
        ForEach(model.runs, id: \.key) { run in
          Section {
            HStack {
              VStack(alignment: .leading) {
                Text(run.sourceId).font(.headline)
                Text(run.createdAt).font(.caption).foregroundStyle(.secondary)
              }
              Spacer()
              Text(state(run.state))
              if run.active {
                Button(text.copy("停止安装…", "Stop Installation…")) { stopping = run }
                  .disabled(
                    run.state == "cancelling" || model.cancelling.contains(run.key)
                      || !model.supports(run.sourceId, "cancel"))
              } else if !run.retryableIDs.isEmpty {
                Button(text.copy("重新审阅未完成项…", "Review Unfinished Items…")) {
                  Task { await model.preview(source: run.sourceId, ids: run.retryableIDs) }
                }.disabled(
                  model.planning || model.installing || model.sourceBusy(run.sourceId)
                    || !model.supports(run.sourceId, "preview") || !model.supports(run.sourceId, "install"))
              }
            }
            ForEach(run.items) { item in
              VStack(alignment: .leading, spacing: 6) {
                HStack {
                  Text(item.title.localized(chinese: text.chinese))
                  Spacer()
                  Text(state(item.state)).foregroundStyle(.secondary)
                }
                if let progress = item.progress {
                  if let percent = progress.percent { ProgressView(value: percent, total: 100) }
                  Text(state(progress.phase) + (progress.resource.map { " · " + $0 } ?? "")).font(.caption)
                }
                if let message = item.message { Text(message).font(.caption).textSelection(.enabled) }
                if !item.log.isEmpty {
                  DisclosureGroup(text.copy("查看日志", "View Log")) {
                    Text(item.log).font(.caption.monospaced()).textSelection(.enabled).frame(
                      maxWidth: .infinity, alignment: .leading)
                  }
                }
              }.padding(.vertical, 5)
            }
          }
        }
        if model.runs.isEmpty && !model.loadingRuns {
          ContentUnavailableView(
            model.canReadHistory
              ? text.copy("暂无安装记录", "No Installation Records")
              : text.copy("安装记录暂不可用", "Installation History Unavailable"), systemImage: "clock",
            description: model.canReadHistory
              ? nil
              : Text(
                text.copy("请检查本机管理插件及其支持的操作。", "Check the local management provider and its supported operations.")))
        }
      }.listStyle(.inset)
    }.confirmationDialog(
      text.copy("停止整个安装任务？", "Stop This Installation?"),
      isPresented: Binding(
        get: { stopping != nil }, set: { if !$0 { stopping = nil } }
      ), titleVisibility: .visible
    ) {
      if let run = stopping {
        Button(text.copy("停止安装", "Stop Installation"), role: .destructive) {
          stopping = nil
          Task { await model.cancel(run) }
        }
      }
    } message: {
      Text(
        text.copy(
          "同时停止此任务中剩余的项目，已完成的安装会保留。", "Stops remaining items in this task. Completed installations are retained."))
    }
  }
  private func state(_ value: String) -> String {
    guard text.chinese else { return value.capitalized }
    return [
      "queued": "排队中", "running": "进行中", "cancelling": "正在停止", "completed": "已完成", "failed": "失败",
      "cancelled": "已取消", "interrupted": "已中断", "waiting": "等待处理", "installed": "已安装", "skipped": "已跳过",
      "manual": "手动处理", "preparing": "准备中", "downloading": "下载中", "installing": "安装中",
    ][value] ?? value
  }
}

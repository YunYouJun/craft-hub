import CraftHubMacCore
import SwiftUI

struct SoftwareInstallationsView: View {
  @Bindable var model: SoftwareInstallationModel
  let sources: [SoftwareSnapshot.Source]
  @FocusState.Binding var searchFocused: Bool
  let showCatalog: () -> Void
  @State private var stopping: SoftwareInstallationRun?
  @State private var log: SoftwareInstallationLogSelection?
  @State private var query = ""
  @State private var filter = "all"
  private var text: L10n { .text }
  private var filtered: Bool { !query.isEmpty || filter != "all" }
  private var visible: [SoftwareInstallationRun] {
    model.runs.filter {
      SoftwareManagementPresentation.matches($0, filter: filter, query: query, sourceTitle: sourceTitle($0.sourceId))
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        Text(text.copy("安装记录", "Installation History")).font(.headline)
        Text(
          text.copy(
            "\(model.runs.count) 个任务 · \(model.runs.filter(\.active).count) 个进行中",
            "\(model.runs.count) tasks · \(model.runs.filter(\.active).count) active")
        )
        .font(.caption).foregroundStyle(.secondary)
        Spacer()
        if model.loadingRuns { ProgressView().controlSize(.small) }
        Button {
          Task { await model.loadRuns() }
        } label: {
          Label(text.copy("刷新记录", "Refresh History"), systemImage: "arrow.clockwise")
        }.disabled(model.loadingRuns || !model.canReadHistory)
      }.controlSize(.small).padding(.horizontal, 20).padding(.bottom, 14)
      HStack(spacing: 12) {
        SoftwarePageSearch(
          title: text.copy("搜索软件、来源或任务", "Search apps, sources or tasks"), query: $query, focused: $searchFocused)
        Picker(text.copy("任务状态", "Task Status"), selection: $filter) {
          Text(text.copy("全部任务", "All Tasks")).tag("all")
          Text(text.copy("进行中", "Active")).tag("active")
          Text(text.copy("已完成", "Completed")).tag("completed")
          Text(text.copy("失败或中断", "Failed or Interrupted")).tag("attention")
          Text(text.copy("已取消", "Cancelled")).tag("cancelled")
        }.labelsHidden().frame(width: 160).controlSize(.small)
        if filtered {
          Button(text.copy("重置筛选", "Reset Filters")) {
            query = ""
            filter = "all"
          }.buttonStyle(.link)
        }
        Spacer(minLength: 0)
      }.padding(.horizontal, 20).padding(.bottom, 14)
      if let error = model.error { NativeErrorView(message: error).padding(.horizontal, 20).padding(.bottom, 8) }
      ForEach(model.historyErrors.keys.sorted(), id: \.self) { source in
        NativeErrorView(message: "\(sourceTitle(source)): \(model.historyErrors[source] ?? "")")
          .padding(.horizontal, 20).padding(.bottom, 8)
      }
      content
    }
    .task { await model.loadRuns() }
    .sheet(item: $log) { selection in SoftwareInstallationLogView(model: model, selection: selection) }
    .confirmationDialog(
      text.copy("停止整个安装任务？", "Stop This Installation?"),
      isPresented: Binding(get: { stopping != nil }, set: { if !$0 { stopping = nil } }), titleVisibility: .visible
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
          "同时停止此任务中剩余的项目，已完成的安装会保留。",
          "Stops remaining items in this task. Completed installations are retained."))
    }
  }

  @ViewBuilder private var content: some View {
    if model.runs.isEmpty && model.loadingRuns {
      ProgressView(text.copy("正在读取安装记录…", "Loading installation history…"))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else if model.runs.isEmpty && !model.historyErrors.isEmpty {
      ContentUnavailableView {
        Label(text.copy("无法读取安装记录", "Could Not Load Installation History"), systemImage: "exclamationmark.triangle")
      } description: {
        Text(text.copy("来源暂时不可用，请刷新记录后重试。", "The source is unavailable. Refresh history to retry."))
      } actions: {
        Button(text.copy("刷新记录", "Refresh History")) { Task { await model.loadRuns() } }
          .disabled(model.loadingRuns || !model.canReadHistory)
      }.frame(maxWidth: .infinity, maxHeight: .infinity)
    } else if model.runs.isEmpty {
      ContentUnavailableView {
        Label(
          model.canReadHistory
            ? text.copy("暂无安装记录", "No Installation Records")
            : text.copy("安装记录暂不可用", "Installation History Unavailable"), systemImage: "clock")
      } description: {
        Text(
          model.canReadHistory
            ? text.copy(
              "从软件目录审阅并安装后，可在这里查看进度、结果与日志。",
              "Review and install from the catalog, then follow progress, results and logs here.")
            : text.copy("请检查本机管理插件及其支持的操作。", "Check the local management provider and its supported operations."))
      } actions: {
        if model.canReadHistory { Button(text.copy("浏览软件目录", "Browse Catalog"), action: showCatalog) }
      }.frame(maxWidth: .infinity, maxHeight: .infinity)
    } else if visible.isEmpty {
      ContentUnavailableView {
        Label(text.copy("没有匹配的安装任务", "No Matching Installations"), systemImage: "magnifyingglass")
      } actions: {
        Button(text.copy("重置筛选", "Reset Filters")) {
          query = ""
          filter = "all"
        }
      }.frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      ScrollView {
        LazyVStack(spacing: 12) {
          ForEach(visible, id: \.key) { run in
            SoftwareInstallationCard(
              model: model, run: run, sourceTitle: sourceTitle(run.sourceId),
              stop: { stopping = run }, showLog: { log = .init(runKey: run.key, itemID: $0) })
          }
        }.padding(.horizontal, 20).padding(.bottom, 20)
      }
    }
  }
  private func sourceTitle(_ id: String) -> String { sources.first { $0.id == id }?.title ?? id }
}

import AppKit
import CraftHubMacCore
import SwiftUI

struct SoftwareSourceEditor: View {
  @Bindable var model: SoftwareSourcesModel
  private var text: L10n { .text }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(text.copy("审阅软件来源", "Review Software Source")).font(.title2.bold())
      Form {
        Picker(text.copy("读取方式", "Read From"), selection: $model.draft.mode) {
          Text(text.copy("线上仓库", "Online Repository")).tag("remote")
          if model.snapshot?.localAvailable == true { Text(text.copy("本地工作目录", "Local Working Tree")).tag("local") }
        }
        TextField(
          text.copy("HTTPS 仓库地址", "HTTPS Repository URL"),
          text: Binding(
            get: { model.draft.repository ?? "" }, set: { model.draft.repository = $0.isEmpty ? nil : $0 }))
        if model.snapshot?.localAvailable == true {
          HStack {
            TextField(
              text.copy("本地仓库目录", "Local Repository"),
              text: Binding(
                get: { model.draft.localPath ?? "" }, set: { model.draft.localPath = $0.isEmpty ? nil : $0 }))
            Button(text.copy("选择…", "Choose…")) { choose() }
          }
        }
        TextField(text.copy("分支", "Branch"), text: $model.draft.branch)
        TextField(text.copy("目录文件", "Catalog File"), text: $model.draft.catalogPath)
      }.disabled(model.busy)
      Text(
        text.copy(
          "只解析声明式清单。本地目录不会执行代码或自动拉取 Git 改动。",
          "Only declarative catalogs are parsed. Local checkouts do not execute code or pull Git changes.")
      )
      .font(.caption).foregroundStyle(.secondary)
      if let error = model.error { NativeErrorView(message: error) }
      if let preview = model.preview {
        Text(preview.source.title).font(.headline)
        if preview.replaces != nil {
          Text(text.copy("将替换已有来源的配置与缓存。", "Replaces this source's saved configuration and cache."))
        }
        List(preview.catalog.items) { item in
          HStack {
            Text(item.title.localized(chinese: text.chinese))
            Spacer()
            Text(item.installation.kind + (item.installation.packageId.map { " · " + $0 } ?? "")).font(
              .caption.monospaced())
          }
        }.frame(minHeight: 130)
      } else {
        Spacer()
      }
      HStack {
        Button(text.copy("取消", "Cancel")) { model.dismiss() }.keyboardShortcut(.cancelAction).disabled(model.busy)
        Spacer()
        if model.busy { ProgressView().controlSize(.small) }
        Button(text.copy("预览", "Preview")) { Task { await model.inspect() } }.disabled(model.busy)
        Button(text.copy("确认保存来源", "Save Reviewed Source")) { Task { await model.apply() } }
          .disabled(model.busy || model.preview == nil).buttonStyle(.borderedProminent)
      }
    }.padding(24).frame(width: 660, height: 580).interactiveDismissDisabled(model.busy)
  }
  private func choose() {
    let panel = NSOpenPanel()
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    panel.allowsMultipleSelection = false
    panel.begin { response in
      guard response == .OK, let path = panel.url?.path else { return }
      model.draft.localPath = path
      model.draft.mode = "local"
    }
  }
}

struct SoftwareRefreshEditor: View {
  @Bindable var model: SoftwareSourcesModel
  let source: String
  @State private var expectedRevision: String
  @Environment(\.dismiss) private var dismiss
  @State private var mode: String
  @State private var minutes: Int
  @State private var time: String
  @State private var timeZone: String
  private var text: L10n { .text }
  init(model: SoftwareSourcesModel, source: String, revision: String, initial: SoftwareRefreshPolicy) {
    self.model = model
    self.source = source
    _expectedRevision = State(initialValue: revision)
    _mode = State(initialValue: initial.mode)
    _minutes = State(initialValue: initial.intervalMinutes ?? 1440)
    _time = State(initialValue: initial.time ?? "09:00")
    _timeZone = State(initialValue: initial.timeZone ?? TimeZone.current.identifier)
  }
  private var policy: SoftwareRefreshPolicy {
    if mode == "interval" { return .init(mode: mode, intervalMinutes: minutes) }
    if mode == "daily" { return .init(mode: mode, time: time, timeZone: timeZone) }
    return .init(mode: "manual")
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(text.copy("自动刷新来源", "Automatic Source Refresh")).font(.title2.bold())
      Form {
        Picker(text.copy("刷新方式", "Schedule"), selection: $mode) {
          Text(text.copy("手动", "Manual")).tag("manual")
          Text(text.copy("按间隔", "Interval")).tag("interval")
          Text(text.copy("每天", "Daily")).tag("daily")
        }
        if mode == "interval" {
          TextField(text.copy("间隔（分钟，15–10080）", "Minutes (15–10080)"), value: $minutes, format: .number)
        }
        if mode == "daily" {
          TextField(text.copy("时间（HH:mm）", "Time (HH:mm)"), text: $time)
          TextField(text.copy("时区", "Time Zone"), text: $timeZone)
        }
      }.disabled(model.busy)
      Text(
        text.copy(
          "仅在本地客户端运行时刷新线上目录，时间规则由运行时处理。",
          "Online catalogs refresh while the local client is running. The runtime owns scheduling.")
      )
      .font(.caption).foregroundStyle(.secondary)
      if let error = model.error { NativeErrorView(message: error) }
      HStack {
        Button(text.copy("关闭", "Close")) { dismiss() }.keyboardShortcut(.cancelAction).disabled(model.busy)
        Button(text.copy("重新载入来源", "Reload Sources")) {
          Task {
            await model.load(force: true)
            if model.error == nil, let snapshot = model.snapshot { expectedRevision = snapshot.revision }
          }
        }.disabled(model.busy || model.loading)
        Spacer()
        Button(text.copy("保存", "Save")) {
          Task { if await model.configure(source, revision: expectedRevision, policy: policy) { dismiss() } }
        }.disabled(
          model.busy || model.loading || model.snapshot?.localAvailable != true
            || model.snapshot?.sources.contains(where: { $0.id == source && $0.mode == "remote" }) != true
        )
        .buttonStyle(.borderedProminent)
      }
      Text(text.copy("重新载入会保留当前草稿，请核对后再保存。", "Reloading preserves this draft. Review it before saving again.")).font(
        .caption
      ).foregroundStyle(.secondary)
    }.padding(24).frame(width: 560).interactiveDismissDisabled(model.busy)
  }
}

import CraftHubMacCore
import SwiftUI

struct DiagnosticsView: View {
  @Bindable var model: DiagnosticsModel
  let findRequest: Int
  let node: ResolvedNode
  let openTarget: (DiagnosticSnapshot.Target) -> Void
  @FocusState private var searchFocused: Bool
  private var text: L10n { .text }

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        VStack(alignment: .leading, spacing: 4) {
          Text(text.copy("诊断中心", "Diagnostics")).font(.title2.bold())
          Text(text.copy("检查插件、来源和配置，定位需要处理的问题。", "Review plugins, sources and configuration issues."))
            .foregroundStyle(.secondary)
        }
        Spacer()
        if model.loading { ProgressView().controlSize(.small) }
        Button(text.copy("重新检查", "Check Again"), systemImage: "arrow.clockwise") {
          Task { await model.load(force: true) }
        }
        .disabled(model.loading)
      }.padding(.vertical, 16).nativePageContent()
      HStack {
        TextField(text.copy("搜索诊断信息", "Search diagnostics"), text: $model.query).textFieldStyle(.roundedBorder).focused(
          $searchFocused)
        Picker(text.copy("级别", "Severity"), selection: $model.severity) {
          Text(text.copy("全部", "All")).tag("all")
          Text(text.copy("错误", "Errors")).tag("error")
          Text(text.copy("警告", "Warnings")).tag("warning")
        }.labelsHidden().frame(width: 140)
        if let providers = model.snapshot?.providers, !providers.isEmpty {
          Picker(text.copy("诊断来源", "Diagnostic Provider"), selection: $model.providerID) {
            Text(text.copy("全部来源", "All Providers")).tag("all")
            ForEach(providers) { Text($0.title).tag($0.id) }
          }.labelsHidden().frame(maxWidth: 200)
        }
        if model.hasFilters {
          Button(text.copy("清除筛选", "Clear Filters")) { model.clearFilters() }
        }
      }.padding(.bottom, 16).nativePageContent()
      if let error = model.error { NativeErrorView(message: error).nativePageContent() }
      List(selection: $model.selectedID) {
        if model.loading && model.snapshot == nil {
          ProgressView(text.copy("正在检查插件、来源和配置…", "Checking plugins, sources and configuration…"))
        }
        Section(text.copy("本机运行时", "Local Runtime")) {
          LabeledContent("Node", value: node.version.description)
          LabeledContent(text.copy("可执行文件", "Executable")) {
            Text(node.path).font(.caption.monospaced()).textSelection(.enabled)
          }
        }
        if let snapshot = model.snapshot {
          Section {
            HStack {
              Label("\(snapshot.summary.errors) " + text.copy("错误", "errors"), systemImage: "xmark.circle")
              Label(
                "\(snapshot.summary.warnings) " + text.copy("警告", "warnings"), systemImage: "exclamationmark.triangle")
              Spacer()
              Text(snapshot.checkedAt).font(.caption).foregroundStyle(.secondary)
            }
            if model.stale {
              Label(
                text.copy("显示上次检查结果，请重新检查。", "Showing previous results. Check again to refresh."),
                systemImage: "clock.arrow.circlepath")
            } else if model.allClear {
              Label(text.copy("已完成的检查未发现问题", "Completed checks found no issues"), systemImage: "checkmark.circle")
            } else if !snapshot.reportsComplete {
              Label(
                text.copy("部分诊断尚未完成，请查看下方来源状态。", "Some reports are incomplete. Review provider status below."),
                systemImage: "exclamationmark.circle")
            }
          }
          if let providers = snapshot.providers, !providers.isEmpty {
            Section(text.copy("诊断来源", "Diagnostic Providers")) {
              ForEach(providers) { provider in
                DisclosureGroup {
                  LabeledContent(text.copy("插件", "Plugin"), value: provider.pluginId)
                  if let metadata = provider.metadata {
                    if let version = metadata.version { LabeledContent(text.copy("版本", "Version"), value: version) }
                    if let platform = metadata.platform { LabeledContent(text.copy("平台", "Platform"), value: platform) }
                  }
                  if let counts = provider.summary {
                    Text(
                      text.copy(
                        "通过 \(counts.passed)，警告 \(counts.warnings)，错误 \(counts.errors)",
                        "\(counts.passed) passed, \(counts.warnings) warnings, \(counts.errors) errors"))
                  }
                  if let date = provider.checkedAt { Text(date).font(.caption).foregroundStyle(.secondary) }
                  if let message = provider.message { Text(message).textSelection(.enabled) }
                  if provider.state == "error" {
                    Text(text.copy("来源检查未能完成，请重新检查。", "The provider could not complete. Check again to retry."))
                  } else if provider.state == "empty" {
                    Text(text.copy("此来源尚未返回检查结果。", "This provider has not returned any check results."))
                  } else if provider.state == "skipped" {
                    Text(text.copy("此次未执行该来源的检查。", "This provider was not checked in this run."))
                  }
                } label: {
                  HStack {
                    Text(provider.title)
                    Spacer()
                    Text(providerState(provider.state)).foregroundStyle(.secondary)
                  }
                }
              }
            }
          }
          ForEach(model.groups, id: \.self) { kind in
            Section("\(kindTitle(kind)) (\(model.filtered.filter { $0.kind == kind }.count))") {
              ForEach(model.filtered.filter { $0.kind == kind }) { item in
                HStack(alignment: .top, spacing: 12) {
                  Image(systemName: item.severity == "error" ? "xmark.circle" : "exclamationmark.triangle")
                    .foregroundStyle(item.severity == "error" ? Color.red : Color.orange)
                    .accessibilityLabel(
                      item.severity == "error" ? text.copy("错误", "Error") : text.copy("警告", "Warning"))
                  VStack(alignment: .leading, spacing: 5) {
                    if let subject = item.subject { Text(subject).fontWeight(.semibold) }
                    Text(item.message).textSelection(.enabled)
                    if let path = DiagnosticPresentation.location(item) {
                      Text(path).font(
                        .caption.monospaced()
                      ).textSelection(.enabled)
                    }
                    if let code = item.code { Text(code).font(.caption).foregroundStyle(.secondary) }
                  }
                  Spacer()
                  if let target = item.target {
                    Button(DiagnosticPresentation.targetTitle(target), systemImage: "arrow.right") {
                      openTarget(target)
                    }
                  }
                }.padding(.vertical, 6).tag(item.id)
              }
            }
          }
          if model.filtered.isEmpty && model.hasFilters {
            ContentUnavailableView(
              text.copy("没有匹配的诊断", "No Matching Diagnostics"), systemImage: "line.3.horizontal.decrease.circle",
              description: Text(text.copy("调整搜索、级别或来源筛选。", "Adjust the search, severity or provider filter.")))
          }
        }
      }.listStyle(.inset)
        .nativePageListContent()
        .contextMenu(forSelectionType: String.self) { selection in
          if let item = model.filtered.first(where: { selection.contains($0.id) }) {
            Button(text.copy("查看详情…", "Show Details…")) { model.detailID = item.id }
            if let target = item.target {
              Button(DiagnosticPresentation.targetTitle(target)) { openTarget(target) }
            }
          }
        } primaryAction: { selection in
          if let id = selection.first { model.detailID = id }
        }
      HStack {
        Text(text.copy("\(model.filtered.count) 条诊断", "\(model.filtered.count) diagnostics"))
          .font(.caption).foregroundStyle(.secondary)
        Spacer()
        Button(text.copy("查看详情…", "Show Details…")) { model.detailID = model.selectedID }
          .disabled(model.selected == nil)
      }.padding(.vertical, 12).nativePageContent()
    }.task { await model.load() }.onChange(of: findRequest) { searchFocused = true }
      .sheet(isPresented: Binding(get: { model.detail != nil }, set: { if !$0 { model.detailID = nil } })) {
        if let item = model.detail, let snapshot = model.snapshot {
          DiagnosticDetailView(
            item: item, provider: snapshot.providers?.first { $0.id == item.providerId },
            checkedAt: snapshot.checkedAt, stale: model.stale, openTarget: openTarget)
        }
      }
  }
  private func providerState(_ state: String) -> String {
    switch state {
    case "ready": text.copy("已完成", "Ready")
    case "empty": text.copy("无检查结果", "No Results")
    case "error": text.copy("检查失败", "Failed")
    case "skipped": text.copy("已跳过", "Skipped")
    default: text.copy("未知", "Unknown")
    }
  }
  private func kindTitle(_ kind: String) -> String {
    switch kind {
    case "host-plugin": text.copy("宿主插件", "Host Plugins")
    case "host-provider": text.copy("诊断来源", "Diagnostic Providers")
    case "integration": text.copy("集成", "Integrations")
    case "marketplace-plugin": text.copy("市场插件", "Marketplace Plugins")
    case "marketplace-source": text.copy("插件来源", "Marketplace Sources")
    case "project-config": text.copy("项目配置", "Project Configuration")
    case "settings": text.copy("设置", "Settings")
    case "user-config": text.copy("用户配置", "User Configuration")
    default: kind
    }
  }
}

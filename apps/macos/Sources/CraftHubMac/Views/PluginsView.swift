import AppKit
import CraftHubMacCore
import SwiftUI

struct PluginsView: View {
  @Bindable var model: PluginsModel
  let findRequest: Int
  let restart: () async throws -> Void
  @FocusState private var searchFocused: Bool
  @State private var restartError: String?
  @State private var selectedCatalogID: String?
  @State private var selectedInstalledID: String?
  private var text: L10n { .text }

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        VStack(alignment: .leading, spacing: 4) {
          Text(text.copy("插件管理", "Plugins")).font(.title2.bold())
          Text(text.copy("发现能力、管理已安装插件与来源。", "Discover capabilities and manage plugins and sources.")).foregroundStyle(
            .secondary)
        }
        Spacer()
        if model.loading || model.busy || model.hostComponents.loading || model.hostComponents.busy {
          ProgressView().controlSize(.small)
        }
        Button(text.copy("刷新", "Refresh"), systemImage: "arrow.clockwise") {
          Task {
            await model.load(force: true)
            if model.tab == .hosts { await model.hostComponents.load() }
          }
        }
        .disabled(model.busy || model.loading || model.hostComponents.loading || model.hostComponents.busy)
      }.padding(.vertical, 16).nativePageContent()
      Picker(text.copy("插件页面", "Plugin Page"), selection: $model.tab) {
        ForEach(PluginsModel.Tab.allCases, id: \.self) { tab in Text(tabTitle(tab)).tag(tab) }
      }.labelsHidden().pickerStyle(.segmented).fixedSize(horizontal: true, vertical: false)
        .padding(.bottom, 16).nativePageContent()
        .disabled(model.busy || model.hostComponents.busy)
      if model.tab != .hosts {
        HStack {
          TextField(text.copy("搜索插件或来源", "Search plugins or sources"), text: $model.query)
            .textFieldStyle(.roundedBorder).focused($searchFocused)
          if model.tab == .discover {
            Picker(text.copy("插件类型", "Plugin Type"), selection: $model.kind) {
              Text(text.copy("全部类型", "All Types")).tag("all")
              Text(text.copy("插件包", "Plugin Packs")).tag("pack")
              Text(text.copy("插件", "Plugins")).tag("plugin")
            }.labelsHidden().frame(width: 130)
            Picker(text.copy("筛选", "Filter"), selection: $model.filter) {
              Text(text.copy("全部", "All")).tag("all")
              Text(text.copy("已安装", "Installed")).tag("installed")
              Text(text.copy("可更新", "Updates")).tag("updates")
            }.labelsHidden().frame(width: 130)
          }
          if model.tab == .installed {
            Button(text.copy("链接本地插件…", "Link Local Plugin…"), systemImage: "folder.badge.plus", action: chooseLocal)
            Button(text.copy("检查更新", "Check Updates")) {
              Task { await model.checkUpdates() }
            }
          }
        }.padding(.bottom, 16).nativePageContent().disabled(model.busy)
      }
      if let error = model.error { NativeErrorView(message: error).nativePageContent() }
      if let message = model.message {
        Text(message).font(.callout).foregroundStyle(.secondary).padding(.vertical, 8).nativePageContent()
      }
      if let error = restartError { NativeErrorView(message: error).nativePageContent() }
      if model.tab != .hosts && model.stale {
        Label(
          text.copy(
            "目录已有变化或刷新未完成，当前显示上次结果。", "The catalog changed or refresh is incomplete. Showing previous results."),
          systemImage: "clock.arrow.circlepath"
        )
        .font(.callout).foregroundStyle(.secondary).padding(.vertical, 8).nativePageContent()
      }
      if model.loading && model.snapshot == nil && model.tab != .hosts {
        ProgressView(text.copy("正在读取插件目录…", "Loading plugins…")).padding()
      }
      switch model.tab {
      case .discover: catalogList
      case .installed: installedList
      case .sources: PluginSourcesView(model: model)
      case .hosts:
        PluginHostsView(
          model: model.hostComponents,
          restart: {
            do { try await restart() } catch { restartError = error.localizedDescription }
          })
      }
      if model.tab == .discover || model.tab == .installed { listFooter }
    }
    .task { await model.load() }
    .onDisappear { model.cancelChange() }
    .onChange(of: findRequest) { searchFocused = true }
    .onChange(of: model.catalog.map(\.id)) {
      if !model.catalog.contains(where: { $0.id == selectedCatalogID }) { selectedCatalogID = nil }
    }
    .onChange(of: model.installed.map(\.id)) {
      if !model.installed.contains(where: { $0.id == selectedInstalledID }) { selectedInstalledID = nil }
    }
    .sheet(item: $model.detail) { detail in PluginDetailView(model: model, detail: detail).id(detail.id) }
    .sheet(
      isPresented: Binding(
        get: { model.installReview != nil && model.detail == nil }, set: { if !$0 { model.cancelPreview() } })
    ) {
      PluginInstallReviewView(model: model)
    }
    .sheet(isPresented: $model.updatesPresented) { updatesSheet }
    .confirmationDialog(
      changeTitle,
      isPresented: Binding(get: { model.changeReview != nil }, set: { if !$0 { model.cancelChange() } }),
      titleVisibility: .visible
    ) {
      if let review = model.changeReview {
        switch review.operation {
        case .removePlugin(let plugin):
          Button(plugin.local ? text.copy("取消链接", "Unlink") : text.copy("移除", "Remove"), role: .destructive) {
            model.confirmChange(review)
          }
        case .rollbackPlugin:
          Button(text.copy("回滚", "Roll Back")) { model.confirmChange(review) }
        case .removeSource:
          Button(text.copy("移除", "Remove"), role: .destructive) { model.confirmChange(review) }
        }
      }
    } message: {
      Text(changeMessage)
    }
  }

  private var changeTitle: String {
    switch model.changeReview?.operation {
    case .removePlugin(let plugin):
      plugin.manifest.includesPlugins.isEmpty
        ? text.copy("移除插件？", "Remove Plugin?") : text.copy("移除插件包？", "Remove Plugin Pack?")
    case .rollbackPlugin: text.copy("回滚插件版本？", "Roll Back Plugin?")
    case .removeSource: text.copy("移除此来源？", "Remove Source?")
    case nil: ""
    }
  }
  private var changeMessage: String {
    switch model.changeReview?.operation {
    case .removePlugin(let plugin):
      plugin.package + "\n"
        + (plugin.manifest.includesPlugins.isEmpty
          ? text.copy("保留用户数据；本地插件的源文件不会删除。", "User data and local plugin source files are retained.")
          : text.copy("子插件会继续保留，并可独立管理。", "Included plugins remain installed and can be managed independently."))
    case .rollbackPlugin(let plugin): "\(plugin.package)\n\(plugin.version) → \(plugin.previousVersion ?? "")"
    case .removeSource(let source): source.name + "\n" + (source.catalogUrl ?? source.id)
    case nil: ""
    }
  }

  private var catalogList: some View {
    List(selection: $selectedCatalogID) {
      ForEach(model.catalog) { plugin in
        HStack(alignment: .top, spacing: 16) {
          if plugin.metadata.includesPlugins.isEmpty {
            PluginIconView(artwork: plugin.artwork, client: model.iconClient, revision: model.iconRevision)
          } else {
            PluginPackIconView(members: plugin.members, client: model.iconClient, revision: model.iconRevision)
          }
          VStack(alignment: .leading, spacing: 5) {
            Button {
              model.detail = model.catalogDetail(plugin)
            } label: {
              HStack {
                Text(plugin.metadata.name(chinese: text.chinese)).font(.headline)
                Text(
                  plugin.metadata.includesPlugins.isEmpty ? text.copy("插件", "Plugin") : text.copy("插件包", "Plugin Pack")
                )
                .font(.caption).foregroundStyle(.secondary)
              }
            }.buttonStyle(.plain)
            if let description = plugin.metadata.detail(chinese: text.chinese) {
              Text(description).foregroundStyle(.secondary).lineLimit(3)
            }
            Text("\(plugin.sourceName) · \(plugin.version)").font(.caption).foregroundStyle(.secondary)
            if !plugin.members.isEmpty {
              PluginPackMembersView(model: model, members: plugin.members).padding(.top, 4)
            }
            if let reason = plugin.statusReason {
              Label(reason, systemImage: "exclamationmark.triangle").font(.caption)
            }
          }
          Spacer()
          Button(PluginActionLabel.title(plugin.action, text: text, pack: !plugin.metadata.includesPlugins.isEmpty)) {
            Task { await model.performCatalogAction(plugin) }
          }.disabled(!model.canPerformCatalogAction(plugin))
        }.padding(.vertical, 10).tag(plugin.id)
      }
    }.listStyle(.inset)
      .nativePageListContent()
      .overlay { if model.catalog.isEmpty && !model.loading { empty } }
      .contextMenu(forSelectionType: String.self) { selection in
        if let plugin = model.catalog.first(where: { selection.contains($0.id) }) {
          Button(text.copy("查看详情…", "Show Details…")) {
            model.detail = model.catalogDetail(plugin)
          }
          Button(text.copy("复制包名", "Copy Package Name")) { copyPackage(plugin.package) }
        }
      } primaryAction: { selection in
        if let plugin = model.catalog.first(where: { selection.contains($0.id) }) {
          model.detail = model.catalogDetail(plugin)
        }
      }
  }
  private var installedList: some View {
    List(selection: $selectedInstalledID) {
      ForEach(model.installed) { plugin in
        VStack(alignment: .leading, spacing: 8) {
          HStack(alignment: .top) {
            if plugin.manifest.includesPlugins.isEmpty {
              PluginIconView(artwork: plugin.artwork, client: model.iconClient, revision: model.iconRevision)
            } else {
              PluginPackIconView(members: plugin.members ?? [], client: model.iconClient, revision: model.iconRevision)
            }
            VStack(alignment: .leading, spacing: 4) {
              Button {
                model.detail = .init(source: plugin.sourceId, package: plugin.package, version: plugin.version)
              } label: {
                HStack {
                  Text(plugin.manifest.name(chinese: text.chinese)).font(.headline)
                  if !plugin.manifest.includesPlugins.isEmpty {
                    Text(text.copy("插件包", "Plugin Pack")).font(.caption).foregroundStyle(.secondary)
                  }
                }
              }.buttonStyle(.plain)
              Text("\(plugin.package) · \(plugin.version)").font(.caption).foregroundStyle(.secondary).textSelection(
                .enabled)
              if plugin.local {
                Label(text.copy("本地开发插件", "Local Development Plugin"), systemImage: "folder").font(.caption)
              }
            }
            Spacer()
            if plugin.manifest.includesPlugins.isEmpty {
              Toggle(
                text.copy("启用", "Enabled"),
                isOn: Binding(get: { plugin.enabled }, set: { _ in Task { await model.enable(plugin) } })
              )
              .toggleStyle(.switch).fixedSize().disabled(model.busy)
              .accessibilityLabel(
                text.copy("启用插件：", "Enable plugin: ") + plugin.manifest.name(chinese: text.chinese))
            }
            Menu {
              if plugin.local {
                Button(text.copy("重新读取", "Reload Local Files")) { Task { await model.refreshLocal(plugin) } }
              }
              if plugin.previousVersion != nil && !plugin.local && plugin.manifest.includesPlugins.isEmpty {
                Button(text.copy("回滚到上一版本", "Roll Back")) { model.reviewRollback(plugin.package) }
                  .disabled(model.stale)
              }
              Button(plugin.local ? text.copy("取消链接…", "Unlink…") : text.copy("移除…", "Remove…"), role: .destructive) {
                model.reviewRemoval(plugin.package)
              }.disabled(model.stale)
            } label: {
              Image(systemName: "ellipsis.circle").accessibilityLabel(text.copy("插件操作", "Plugin Actions"))
            }.menuStyle(.borderlessButton).fixedSize().disabled(model.busy)
              .accessibilityLabel(
                text.copy("插件操作：", "Plugin actions: ") + plugin.manifest.name(chinese: text.chinese))
          }
          if let error = plugin.error {
            Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).textSelection(.enabled)
          }
          if let members = plugin.members, !members.isEmpty {
            PluginPackMembersView(model: model, members: members)
            Text(
              text.copy(
                "包内插件可独立管理；移除插件包会保留子插件。",
                "Included plugins are managed independently; removing the pack keeps them installed.")
            )
            .font(.caption).foregroundStyle(.secondary)
          }
        }.padding(.vertical, 8).tag(plugin.id)
      }
    }.listStyle(.inset)
      .nativePageListContent()
      .overlay { if model.installed.isEmpty && !model.loading { empty } }
      .contextMenu(forSelectionType: String.self) { selection in
        if let plugin = model.installed.first(where: { selection.contains($0.id) }) {
          Button(text.copy("查看详情…", "Show Details…")) {
            model.detail = .init(source: plugin.sourceId, package: plugin.package, version: plugin.version)
          }
          Button(text.copy("复制包名", "Copy Package Name")) { copyPackage(plugin.package) }
        }
      } primaryAction: { selection in
        if let plugin = model.installed.first(where: { selection.contains($0.id) }) {
          model.detail = .init(source: plugin.sourceId, package: plugin.package, version: plugin.version)
        }
      }
  }
  private var empty: some View {
    ContentUnavailableView {
      Label(
        model.error != nil && model.snapshot == nil
          ? text.copy("无法读取插件", "Could Not Load Plugins")
          : model.tab == .installed && model.searchTerm.isEmpty
            ? text.copy("尚未安装插件", "No Installed Plugins") : text.copy("没有匹配的插件", "No Matching Plugins"),
        systemImage: "puzzlepiece.extension")
    } description: {
      Text(text.copy("调整搜索，或从插件来源发现可用能力。", "Adjust the search or discover plugins from your sources."))
    } actions: {
      if model.error != nil {
        Button(text.copy("重试", "Retry")) { Task { await model.load(force: true) } }
      } else if !model.searchTerm.isEmpty || (model.tab == .discover && model.filter != "all" || model.kind != "all") {
        Button(text.copy("清除筛选", "Clear Filters")) {
          model.query = ""
          model.filter = "all"
          model.kind = "all"
        }
      } else {
        Button(text.copy("查看来源", "View Sources")) { model.tab = .sources }
      }
    }.nativePageContent(.emptyState)
  }
  private var selectedDetail: PluginsModel.Detail? {
    if model.tab == .discover, let plugin = model.catalog.first(where: { $0.id == selectedCatalogID }) {
      return model.catalogDetail(plugin)
    }
    if model.tab == .installed, let plugin = model.installed.first(where: { $0.id == selectedInstalledID }) {
      return .init(source: plugin.sourceId, package: plugin.package, version: plugin.version)
    }
    return nil
  }
  private var listFooter: some View {
    HStack {
      let packs =
        model.tab == .discover
        ? model.catalog.filter { !$0.metadata.includesPlugins.isEmpty }.count
        : model.installed.filter { !$0.manifest.includesPlugins.isEmpty }.count
      let count = (model.tab == .discover ? model.catalog.count : model.installed.count) - packs
      Text(text.copy("\(packs) 个插件包 · \(count) 个插件", "\(packs) packs · \(count) plugins"))
        .font(.caption).foregroundStyle(.secondary)
      Spacer()
      Button(text.copy("查看详情…", "Show Details…")) { model.detail = selectedDetail }
        .disabled(selectedDetail == nil)
    }.padding(.vertical, 12).nativePageContent()
  }
  private func copyPackage(_ package: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(package, forType: .string)
  }
  private var updatesSheet: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(text.copy("插件更新", "Plugin Updates")).font(.title2.bold())
      Text(
        text.copy(
          "仅自动更新权限与依赖边界不变的插件。需要新权限的更新请在发现页逐个审阅。",
          "Automatic updates preserve existing permissions and dependencies. Review other updates individually in Discover."
        ))
      if let result = model.updateResult {
        Text(
          text.copy(
            "已更新 \(result.updated.count)，待审阅 \(result.skipped.count)，失败 \(result.failures.count)",
            "\(result.updated.count) updated, \(result.skipped.count) need review, \(result.failures.count) failed"))
      }
      if let error = model.updatesError { NativeErrorView(message: error) }
      if model.updatesLoading {
        ProgressView(text.copy("正在检查更新…", "Checking for Updates…"))
      } else if model.busy {
        ProgressView(text.copy("正在应用更新…", "Applying Updates…"))
      } else if model.updatesStale {
        Label(
          text.copy("插件或来源已变化，请重新检查。", "Plugins or sources changed. Check again before updating."),
          systemImage: "arrow.clockwise")
      } else if model.updatesChecked && model.updates.isEmpty {
        Label(text.copy("当前来源没有可用更新。", "No updates in the current sources."), systemImage: "checkmark.circle")
      }
      List(model.updates) { item in
        VStack(alignment: .leading, spacing: 4) {
          Text(item.package).font(.headline)
          Text("\(item.currentVersion) → \(item.targetVersion)")
          Text(item.automatic ? text.copy("可自动更新", "Automatic Update") : text.copy("需要单独审阅", "Review Required"))
            .foregroundStyle(.secondary)
          if let error = item.error { Text(error).foregroundStyle(.red) }
          if !item.automatic {
            Button(text.copy("查看插件", "Review Plugin")) {
              model.updatesPresented = false
              Task { await model.show(package: item.package, source: item.sourceId) }
            }.disabled(model.busy)
          }
        }
      }.frame(minHeight: 180)
      HStack {
        Button(text.copy("关闭", "Close")) { model.updatesPresented = false }.keyboardShortcut(.cancelAction)
          .disabled(model.busy)
        Spacer()
        Button(text.copy("重新检查", "Check Again")) { Task { await model.checkUpdates() } }.disabled(model.busy)
        Button(text.copy("应用安全更新", "Apply Safe Updates")) { Task { await model.updateAll() } }
          .disabled(!model.canApplyUpdates)
      }
    }.padding(24).frame(width: 580, height: 460).interactiveDismissDisabled(model.busy)
  }
  private func chooseLocal() {
    let panel = NSOpenPanel()
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    panel.allowsMultipleSelection = false
    panel.message = text.copy(
      "选择含 package.json 的声明式插件目录。宿主代码扩展需单独管理。",
      "Choose a declarative plugin directory containing package.json. Host code extensions are managed separately.")
    panel.begin { result in
      guard result == .OK, let path = panel.url?.path else { return }
      Task { await model.link(path) }
    }
  }
  private func tabTitle(_ tab: PluginsModel.Tab) -> String {
    switch tab {
    case .discover: text.copy("发现", "Discover")
    case .installed: text.copy("已安装", "Installed")
    case .sources: text.copy("来源", "Sources")
    case .hosts: text.copy("宿主组件", "Host Components")
    }
  }
}

enum PluginActionLabel {
  static func title(_ action: String, text: L10n, pack: Bool = false) -> String {
    switch action {
    case "install": pack ? text.copy("一键安装…", "Install All…") : text.copy("安装…", "Install…")
    case "update": text.copy("更新…", "Update…")
    case "repair": text.copy("修复…", "Repair…")
    case "enable": text.copy("启用…", "Enable…")
    case "installed": text.copy("已安装", "Installed")
    case "newer": text.copy("已安装更新版本", "Newer Version Installed")
    case "local": text.copy("查看本地插件", "View Local Plugin")
    case "switchSource": text.copy("切换来源…", "Switch Source…")
    default: action
    }
  }
}

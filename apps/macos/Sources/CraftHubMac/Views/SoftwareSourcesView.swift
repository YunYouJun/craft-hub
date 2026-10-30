import CraftHubMacCore
import SwiftUI

struct SoftwareSourcesView: View {
  @Bindable var model: SoftwareSourcesModel
  @FocusState.Binding var searchFocused: Bool
  private struct Removal {
    let source: SoftwareRepositorySource
    let revision: String
  }
  private struct RefreshEdit: Identifiable {
    let id: String
    let revision: String
    let policy: SoftwareRefreshPolicy
  }
  @State private var removal: Removal?
  @State private var refresh: RefreshEdit?
  @State private var query = ""
  @State private var filter = "all"
  private var text: L10n { .text }
  private var sources: [SoftwareRepositorySource] { model.snapshot?.sources ?? [] }
  private var visible: [SoftwareRepositorySource] {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return sources.filter { source in
      (filter == "all" || source.mode == filter || (filter == "error" && source.error != nil))
        && (query.isEmpty
          || [source.title, source.repository ?? "", source.localPath ?? "", source.branch, source.catalogPath]
            .contains { $0.localizedStandardContains(query) })
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        Text(text.copy("软件来源", "Software Sources")).font(.headline)
        Text(
          text.copy(
            "\(sources.count) 个来源 · \(sources.reduce(0) { $0 + $1.cache.itemCount }) 款软件",
            "\(sources.count) sources · \(sources.reduce(0) { $0 + $1.cache.itemCount }) apps")
        )
        .font(.caption).foregroundStyle(.secondary)
        Spacer()
        if model.loading || model.busy { ProgressView().controlSize(.small) }
        Button {
          Task { await model.load(force: true) }
        } label: {
          Image(systemName: "arrow.clockwise")
        }
        .help(text.copy("重新载入来源状态", "Reload Source Status"))
        .accessibilityLabel(text.copy("重新载入来源状态", "Reload Source Status"))
        .disabled(model.loading || model.busy)
        Button {
          model.edit()
        } label: {
          Label(text.copy("添加来源…", "Add Source…"), systemImage: "plus")
        }
        .buttonStyle(.borderedProminent).disabled(model.busy)
      }.controlSize(.small).padding(.horizontal, NativePageLayout.horizontalInset).padding(.bottom, 14)
      HStack(spacing: 12) {
        SoftwarePageSearch(
          title: text.copy("搜索来源、仓库或分支", "Search sources, repositories or branches"),
          query: $query, focused: $searchFocused)
        Picker(text.copy("来源类型", "Source Type"), selection: $filter) {
          Text(text.copy("全部来源", "All Sources")).tag("all")
          Text(text.copy("线上仓库", "Online Repositories")).tag("remote")
          Text(text.copy("本地目录", "Local Checkouts")).tag("local")
          Text(text.copy("刷新失败", "Refresh Failed")).tag("error")
        }.labelsHidden().frame(width: 150).controlSize(.small)
        if !query.isEmpty || filter != "all" {
          Button(text.copy("重置筛选", "Reset Filters")) {
            query = ""
            filter = "all"
          }.buttonStyle(.link)
        }
        Spacer(minLength: 0)
      }.padding(.horizontal, NativePageLayout.horizontalInset).padding(.bottom, 14)
      if let error = model.error {
        NativeErrorView(message: error).padding(.horizontal, NativePageLayout.horizontalInset).padding(.bottom, 10)
      }
      content
      Text(
        text.copy(
          "自动刷新仅在应用运行时执行。本地目录由你手动读取。",
          "Automatic refresh runs while the app is open. Local checkouts are read manually.")
      )
      .font(.caption).foregroundStyle(.secondary).padding(.horizontal, NativePageLayout.horizontalInset).padding(
        .vertical, 12)
    }.task { await model.load() }
      .sheet(isPresented: Binding(get: { model.editing }, set: { if !$0 { model.dismiss() } })) {
        SoftwareSourceEditor(model: model)
      }
      .sheet(item: $refresh) { edit in
        SoftwareRefreshEditor(model: model, source: edit.id, revision: edit.revision, initial: edit.policy)
      }
      .confirmationDialog(
        text.copy("移除此软件来源？", "Remove Software Source?"),
        isPresented: Binding(
          get: { removal != nil }, set: { if !$0 { removal = nil } }
        ), titleVisibility: .visible
      ) {
        if let removal {
          Button(text.copy("移除", "Remove"), role: .destructive) {
            self.removal = nil
            Task { await model.remove(removal.source, revision: removal.revision) }
          }
        }
      } message: {
        Text(
          text.copy(
            "仅移除来源和缓存，保留仓库文件及已经安装的软件。",
            "Removes the source and cache. Repository files and installed software are retained."))
      }
  }
  @ViewBuilder private var content: some View {
    if let snapshot = model.snapshot {
      if sources.isEmpty {
        ContentUnavailableView {
          Label(text.copy("添加你的第一个软件来源", "Add Your First Software Source"), systemImage: "shippingbox")
        } description: {
          Text(
            text.copy(
              "内置目录仍可使用。连接仓库后，可在这里管理刷新与目录版本。",
              "The bundled catalog remains available. Connect a repository to manage refreshes and catalog versions."))
        } actions: {
          Button(text.copy("添加来源…", "Add Source…")) { model.edit() }.disabled(model.busy)
        }.nativePageContent(.emptyState).frame(maxHeight: .infinity)
      } else if visible.isEmpty {
        ContentUnavailableView {
          Label(text.copy("没有匹配的来源", "No Matching Sources"), systemImage: "magnifyingglass")
        } actions: {
          Button(text.copy("重置筛选", "Reset Filters")) {
            query = ""
            filter = "all"
          }
        }.nativePageContent(.emptyState).frame(maxHeight: .infinity)
      } else {
        ScrollView {
          LazyVStack(spacing: 12) {
            ForEach(visible) { source in
              SoftwareSourceCard(
                source: source, localAvailable: snapshot.localAvailable, busy: model.busy,
                edit: { model.edit(source) }, reload: { Task { await model.refresh(source) } },
                configure: {
                  refresh = .init(
                    id: source.id, revision: snapshot.revision,
                    policy: source.refreshPolicy ?? .init(mode: "interval", intervalMinutes: 1440))
                }, remove: { removal = .init(source: source, revision: snapshot.revision) })
            }
          }.nativePageContent().padding(.bottom, 12)
        }
      }
    } else if model.loading {
      ProgressView(text.copy("正在读取软件来源…", "Loading sources…")).frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      ContentUnavailableView(text.copy("无法读取软件来源", "Could Not Load Sources"), systemImage: "exclamationmark.triangle")
        .nativePageContent(.emptyState).frame(maxHeight: .infinity)
    }
  }

}

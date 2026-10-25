import AppKit
import CraftHubMacCore
import SwiftUI

/// Native catalog and reviewed installation workflows, backed by the runtime's trusted management providers.
struct SoftwareView: View {
  @Bindable var machine: MachineModel
  let findRequest: Int
  @FocusState private var searchFocused: Bool
  @State private var tab = "catalog"
  let showWorkbench: () -> Void
  private var text: L10n { L10n.text }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      Picker(text.copy("软件页面", "Software Page"), selection: $tab) {
        Text(text.copy("软件目录", "Catalog")).tag("catalog")
        Text(text.copy("常用工具", "Favorites")).tag("favorites")
        Text(text.copy("安装记录", "Installations")).tag("installations")
        Text(text.copy("来源", "Sources")).tag("sources")
      }.pickerStyle(.segmented).labelsHidden().frame(maxWidth: 440, alignment: .leading)
        .padding(.horizontal, 20).padding(.bottom, 16)
      if tab != "favorites", let error = machine.favorites.error {
        NativeErrorView(message: error).padding(.horizontal, 24)
      }
      if tab != "favorites", let notice = machine.favorites.notice {
        Text(notice).font(.callout).foregroundStyle(.secondary).padding(.horizontal, 20).padding(.bottom, 8)
      }
      if tab != "favorites", machine.favorites.uncertain || machine.favorites.stale {
        Text(text.copy("收藏状态需重新读取后才能修改。", "Reload favorites before making changes.")).font(.caption).foregroundStyle(
          .secondary
        ).padding(.horizontal, 24)
      }
      if tab == "catalog" {
        SoftwareCatalogView(machine: machine, searchFocused: $searchFocused)
      } else if tab == "favorites" {
        SoftwareFavoritesView(model: machine.favorites, findRequest: findRequest)
      } else if tab == "installations" {
        SoftwareInstallationsView(
          model: machine.installations, sources: machine.software?.sources ?? [],
          searchFocused: $searchFocused, showCatalog: { tab = "catalog" })
      } else {
        SoftwareSourcesView(model: machine.softwareSources, searchFocused: $searchFocused)
      }
    }
    .task {
      await machine.loadSoftware()
      guard !Task.isCancelled else { return }
      await machine.installations.loadRuns()
      guard !Task.isCancelled else { return }
      machine.installations.startObserving()
    }
    .onDisappear {
      machine.installations.stopObserving()
      machine.installations.dismissPlan()
    }
    .onChange(of: findRequest) {
      if tab != "favorites" {
        searchFocused = true
      }
    }
    .sheet(
      isPresented: Binding(
        get: { machine.installations.showsPlan }, set: { if !$0 { machine.installations.dismissPlan() } }
      )
    ) { SoftwarePlanView(model: machine.installations) }
  }

  private var header: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text(text.copy("软件中心", "Software")).font(.title2.bold())
        Text(text.copy("发现好用的软件，管理你的常用工具", "Discover software and manage your favorite tools"))
          .font(.caption).foregroundStyle(.secondary)
      }
      Spacer(minLength: 8)
      if machine.installations.planning { ProgressView().controlSize(.small) }
      Button {
        Task { await machine.loadSoftware(force: true) }
      } label: {
        Label(text.copy("重新检测", "Check Again"), systemImage: "arrow.clockwise")
      }
      .disabled(machine.checkingSoftware)
      Menu {
        Button(text.copy("完整软件管理…", "Manage Software…"), action: showWorkbench)
      } label: {
        Image(systemName: "ellipsis")
      }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        .accessibilityLabel(text.copy("软件中心更多操作", "More Software Actions"))
    }
    .controlSize(.small).padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 16)
  }
}

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
      }.pickerStyle(.segmented).padding(.horizontal, 24).padding(.bottom, 12)
      if let error = machine.favorites.error { NativeErrorView(message: error).padding(.horizontal, 24) }
      if let notice = machine.favorites.notice { Text(notice).foregroundStyle(.secondary).padding(.horizontal, 24) }
      if machine.favorites.uncertain || machine.favorites.stale {
        Text(text.copy("收藏状态需重新读取后才能修改。", "Reload favorites before making changes.")).font(.caption).foregroundStyle(
          .secondary
        ).padding(.horizontal, 24)
      }
      if tab == "catalog" {
        HStack {
          TextField(text.copy("搜索软件或分类", "Search software or categories"), text: $machine.search)
            .focused($searchFocused)
            .textFieldStyle(.roundedBorder).accessibilityLabel(text.copy("搜索软件", "Search software"))
          Picker(text.copy("安装状态", "Installation Status"), selection: $machine.softwareFilter) {
            Text(text.copy("全部", "All")).tag("all")
            Text(text.copy("已检测到", "Detected")).tag("detected")
            Text(text.copy("未检测到", "Not Detected")).tag("not-detected")
            Text(text.copy("未知", "Unknown")).tag("unknown")
          }
          .labelsHidden().frame(width: 160)
        }
        .padding(.horizontal, 24).padding(.bottom, 12)
        if machine.checkingSoftware { ProgressView().controlSize(.small).padding(.horizontal, 24).padding(.bottom, 12) }
        if let error = machine.softwareError { NativeErrorView(message: error).padding(.horizontal, 24) }
        if let message = machine.operationMessage {
          Text(message).font(.callout).foregroundStyle(.secondary).textSelection(.enabled).padding(.horizontal, 24)
            .padding(.bottom, 8)
        }
        catalog
      } else if tab == "favorites" {
        SoftwareFavoritesView(model: machine.favorites)
      } else if tab == "installations" {
        SoftwareInstallationsView(model: machine.installations)
      } else {
        SoftwareSourcesView(model: machine.softwareSources)
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
      tab = "catalog"
      searchFocused = true
    }
    .sheet(
      isPresented: Binding(
        get: { machine.installations.showsPlan }, set: { if !$0 { machine.installations.dismissPlan() } }
      )
    ) { SoftwarePlanView(model: machine.installations) }
  }

  private var header: some View {
    HStack {
      VStack(alignment: .leading, spacing: 5) {
        Text(text.copy("软件中心", "Software")).font(.largeTitle.bold())
        Text(text.copy("浏览本机软件，查找缺失项", "Browse local software and find missing tools")).foregroundStyle(.secondary)
      }
      Spacer()
      if machine.installations.planning { ProgressView().controlSize(.small) }
      Button(text.copy("完整软件管理…", "Manage Software…"), action: showWorkbench)
      Button {
        Task { await machine.loadSoftware(force: true) }
      } label: {
        Label(text.copy("重新检测", "Check Again"), systemImage: "arrow.clockwise")
      }
      .disabled(machine.checkingSoftware)
    }
    .padding(24)
  }

  @ViewBuilder private var catalog: some View {
    if let snapshot = machine.software {
      if snapshot.sources.isEmpty {
        ContentUnavailableView(text.copy("尚未接入软件目录", "No Software Catalog"), systemImage: "shippingbox")
      } else {
        List {
          if let error = machine.installations.error { NativeErrorView(message: error) }
          ForEach(snapshot.sources) { source in
            let selected = machine.installations.selectedIDs(source)
            if !selected.isEmpty {
              HStack {
                Text(
                  text.copy("已选择 \(selected.count) 项 · \(source.title)", "\(selected.count) selected · \(source.title)")
                )
                Spacer()
                Button(text.copy("审阅安装…", "Review Installation…")) {
                  Task { await machine.installations.preview(source: source.id, ids: selected) }
                }.disabled(
                  machine.installations.planning || machine.installations.installing
                    || machine.installations.sourceBusy(source.id))
                Button(text.copy("清除", "Clear")) {
                  for id in selected {
                    machine.installations.selected.remove(
                      machine.installations.selectionKey(source: source.id, item: id))
                  }
                }
              }
            }
          }
          ForEach(snapshot.sources) { source in
            let items = machine.visibleItems(source)
            if !items.isEmpty || source.error != nil {
              Section(source.title) {
                if source.error != nil {
                  Label(
                    text.copy("来源暂时不可用，请重新检测", "Source unavailable. Check again to retry."),
                    systemImage: "exclamationmark.triangle"
                  )
                  .foregroundStyle(.secondary)
                }
                ForEach(items) { item in row(item, source: source) }
              }
            }
          }
          if snapshot.sources.allSatisfy({ machine.visibleItems($0).isEmpty }) {
            Text(text.copy("没有匹配的软件", "No matching software")).foregroundStyle(.secondary)
          }
          Text(
            text.copy(
              "未检测到的软件可能安装在其他位置；未知表示来源尚未提供本机检测结果。",
              "Undetected software may be installed elsewhere. Unknown means the source has not provided local observations."
            )
          )
          .font(.caption).foregroundStyle(.secondary)
        }
        .listStyle(.inset)
      }
    } else {
      Spacer()
    }
  }

  private func row(_ item: SoftwareSnapshot.Item, source: SoftwareSnapshot.Source) -> some View {
    HStack(spacing: 14) {
      ZStack {
        if source.canInstall(item) {
          let key = machine.installations.selectionKey(source: source.id, item: item.id)
          Toggle(
            text.copy("选择 ", "Select ") + item.title.localized(chinese: text.chinese),
            isOn: Binding(
              get: { machine.installations.selected.contains(key) },
              set: { selected in
                if selected {
                  machine.installations.selected.insert(key)
                } else {
                  machine.installations.selected.remove(key)
                }
              }
            )
          ).labelsHidden().toggleStyle(.checkbox)
            .disabled(
              !machine.installations.selected.contains(key) && machine.installations.selectedIDs(source).count >= 50)
        }
      }.frame(width: 16)
      SoftwareIconView(title: item.title.localized(chinese: text.chinese), artwork: item.artwork)
      VStack(alignment: .leading, spacing: 4) {
        Text(item.title.localized(chinese: text.chinese)).fontWeight(.medium)
        Text(item.group.title.localized(chinese: text.chinese)).font(.caption).foregroundStyle(.secondary)
        if let platforms = item.platforms {
          Text(platforms.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
        }
        if let description = item.description, !description.isEmpty {
          Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
        }
      }
      Spacer()
      Button {
        Task { await machine.favorites.add(source: source.id, item: item.id) }
      } label: {
        Image(systemName: machine.favorites.favorite(source: source.id, item: item.id) ? "star.fill" : "star")
      }
      .accessibilityLabel(text.copy("添加到常用工具：", "Add to Favorites: ") + item.title.localized(chinese: text.chinese))
      .help(
        machine.favorites.favorite(source: source.id, item: item.id)
          ? text.copy("已在常用工具", "Already in Favorites") : text.copy("添加到常用工具", "Add to Favorites")
      )
      .disabled(
        !machine.favorites.canChange || machine.favorites.favorite(source: source.id, item: item.id)
          || (machine.favorites.snapshot?.tools.count ?? 100) >= 100)
      Text(text.softwareStatus(item.status)).font(.callout).foregroundStyle(.secondary)
      if source.canInstall(item) {
        Button(text.copy("安装…", "Install…")) {
          Task { await machine.installations.preview(source: source.id, ids: [item.id]) }
        }.disabled(
          machine.installations.planning || machine.installations.installing
            || machine.installations.sourceBusy(source.id))
      }
      if source.canOpen(item) {
        Button(text.copy("打开", "Open")) { Task { await machine.open(item, in: source) } }
          .disabled(machine.opening.contains(machine.key(source, item)))
          .accessibilityLabel(text.copy("打开 ", "Open ") + item.title.localized(chinese: text.chinese))
      }
      Menu {
        if let url = DesktopBridge.externalURL(item.url) {
          Button(text.copy("访问官网", "Visit Website")) { NSWorkspace.shared.open(url) }
        }
        if let url = DesktopBridge.externalURL(item.downloadUrl) {
          Button(text.copy("官方下载页", "Official Download Page")) { NSWorkspace.shared.open(url) }
        }
        if let url = DesktopBridge.externalURL(item.repositoryUrl) {
          Button(text.copy("源码仓库", "Source Repository")) { NSWorkspace.shared.open(url) }
        }
      } label: {
        Image(systemName: "arrow.up.right.square").accessibilityLabel(
          text.copy("软件链接：", "Software Links: ") + item.title.localized(chinese: text.chinese))
      }.menuStyle(.borderlessButton).fixedSize()
    }
    .buttonStyle(.bordered).padding(.vertical, 8)
    .accessibilityElement(children: .contain)
  }
}

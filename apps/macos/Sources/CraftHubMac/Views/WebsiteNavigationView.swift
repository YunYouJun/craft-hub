import AppKit
import CraftHubMacCore
import SwiftUI

struct WebsiteNavigationView: View {
  @Bindable var model: WebsiteNavigationModel
  let findRequest: Int
  let navigate: (String) -> Void
  @FocusState private var searchFocused: Bool
  @State private var openError: String?
  @State private var selectedPanelID: String?
  private var text: L10n { .text }
  private var locale: String { text.chinese ? "zh-CN" : "en" }
  private var visiblePanels: [NavigationPanel] {
    model.visiblePanels.filter { selectedPanelID == nil || $0.id == selectedPanelID }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      controls
      if let error = model.error { NativeErrorView(message: error).padding(.horizontal, 20).padding(.bottom, 8) }
      if let openError { NativeErrorView(message: openError).padding(.horizontal, 20).padding(.bottom, 8) }
      if model.stale {
        Text(text.copy("显示上次读取的导航，请刷新后打开链接。", "Showing the previous directory. Refresh before opening links."))
          .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 20).padding(.bottom, 8)
      }
      content
    }
    .task(id: locale) { await model.load(locale: locale) }
    .onChange(of: findRequest) { searchFocused = true }
    .onChange(of: model.panels?.map(\.id)) {
      if let selectedPanelID, model.panels?.contains(where: { $0.id == selectedPanelID }) != true {
        self.selectedPanelID = nil
      }
    }
  }

  private var header: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text(text.copy("网站导航", "Website Directory")).font(.title2.bold())
        Text(
          text.copy(
            "\(model.linkCount) 个网站 · \(model.panels?.count ?? 0) 个分组 · 在默认浏览器打开",
            "\(model.linkCount) websites · \(model.panels?.count ?? 0) groups · Open in your browser")
        ).font(.caption).foregroundStyle(.secondary)
      }
      Spacer(minLength: 8)
      Button(text.copy("常用工具", "Favorite Tools")) { navigate("/tools") }
      Button(text.copy("管理插件", "Manage Plugins")) { navigate("/marketplace") }
      Button {
        Task { await model.load(locale: locale, force: true) }
      } label: {
        Image(systemName: "arrow.clockwise")
      }.disabled(model.loading)
        .help(text.copy("刷新网站导航", "Refresh Website Directory"))
        .accessibilityLabel(text.copy("刷新网站导航", "Refresh Website Directory"))
    }.controlSize(.small).padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 14)
  }

  private var controls: some View {
    HStack(spacing: 14) {
      HStack(spacing: 6) {
        Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
        TextField(text.copy("搜索网站、描述或关键词", "Search websites or keywords"), text: $model.query)
          .textFieldStyle(.plain).focused($searchFocused)
          .accessibilityLabel(text.copy("搜索网站导航", "Search Website Directory"))
        if model.hasQuery {
          Button {
            model.query = ""
            searchFocused = true
          } label: {
            Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
          }.buttonStyle(.plain).accessibilityLabel(text.copy("清除搜索", "Clear Search"))
        }
        if model.loading { ProgressView().controlSize(.small) }
      }
      .padding(.horizontal, 10).padding(.vertical, 7)
      .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
      .frame(minWidth: 180, maxWidth: 320)
      ScrollView(.horizontal) {
        HStack(spacing: 6) {
          filter(title: text.copy("全部", "All"), count: model.linkCount, id: nil)
          ForEach(model.panels ?? []) { panel in
            filter(title: panel.title, count: panel.links.count, id: panel.id)
          }
        }
      }.scrollIndicators(.hidden)
    }.padding(.horizontal, 20).padding(.bottom, 16)
  }

  private func filter(title: String, count: Int, id: String?) -> some View {
    Button {
      selectedPanelID = id
    } label: {
      HStack(spacing: 5) {
        Text(title).fontWeight(selectedPanelID == id ? .semibold : .regular)
        Text(count.formatted()).font(.caption).monospacedDigit().opacity(0.7)
      }
      .padding(.horizontal, 10).padding(.vertical, 7)
      .foregroundStyle(selectedPanelID == id ? Color.accentColor : Color.secondary)
      .background(
        selectedPanelID == id ? Color.accentColor.opacity(0.1) : Color.clear,
        in: RoundedRectangle(cornerRadius: 7)
      )
      .contentShape(Rectangle())
    }.buttonStyle(.plain)
      .accessibilityAddTraits(selectedPanelID == id ? .isSelected : [])
      .accessibilityLabel(title + text.copy("，\(count) 个网站", ", \(count) websites"))
  }

  @ViewBuilder private var content: some View {
    if model.panels == nil {
      if model.loading {
        ProgressView(text.copy("正在读取网站导航…", "Loading website directory…"))
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        ContentUnavailableView {
          Label(text.copy("无法读取网站导航", "Could Not Load Website Directory"), systemImage: "exclamationmark.triangle")
        } description: {
          Text(text.copy("请重试，或前往插件管理检查导航来源。", "Retry or review navigation sources in plugin management."))
        } actions: {
          Button(text.copy("重试", "Retry")) { Task { await model.load(locale: locale, force: true) } }
        }
      }
    } else if model.panels?.isEmpty == true {
      ContentUnavailableView {
        Label(text.copy("添加第一个导航面板", "Add Your First Navigation Panel"), systemImage: "globe")
      } description: {
        Text(
          text.copy(
            "安装或启用一个提供导航面板的插件，即可在此查看网站入口。",
            "Install or enable a plugin with navigation panels to see its websites here."))
      } actions: {
        Button(text.copy("浏览插件", "Browse Plugins")) { navigate("/marketplace") }
      }
    } else if visiblePanels.isEmpty {
      ContentUnavailableView {
        Label(text.copy("没有匹配的网站", "No Matching Websites"), systemImage: "magnifyingglass")
      } description: {
        Text(text.copy("试试其他关键词或查看全部分组。", "Try another keyword or browse all groups."))
      } actions: {
        Button(text.copy("重置筛选", "Reset Filters")) {
          model.query = ""
          selectedPanelID = nil
          searchFocused = true
        }
      }
    } else {
      ScrollView {
        LazyVGrid(
          columns: [GridItem(.adaptive(minimum: 300), spacing: 14, alignment: .top)], alignment: .leading, spacing: 14
        ) {
          ForEach(visiblePanels) { panel in
            WebsiteNavigationGroup(
              panel: panel, entries: model.visibleEntries(panel), canOpen: model.canOpen, open: open)
          }
        }.padding(.horizontal, 20).padding(.bottom, 20)
      }
    }
  }

  private func open(_ link: NavigationPanel.Link) {
    guard model.canOpen, let url = link.destination else { return }
    openError =
      NSWorkspace.shared.open(url)
      ? nil : text.copy("无法打开网站，请检查默认浏览器设置后重试。", "Could not open the website. Check your default browser and retry.")
  }
}

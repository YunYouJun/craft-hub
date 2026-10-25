import AppKit
import CraftHubMacCore
import SwiftUI

struct SoftwareCatalogCard: View {
  @Bindable var machine: MachineModel
  let source: SoftwareSnapshot.Source
  let item: SoftwareSnapshot.Item
  @State private var hovered = false
  private var text: L10n { .text }
  private var title: String { item.title.localized(chinese: text.chinese) }
  private var selected: Bool { machine.installations.selected.contains(selectionKey) }
  private var selectionKey: String { machine.installations.selectionKey(source: source.id, item: item.id) }
  private var description: String {
    if let description = item.description, !description.isEmpty { return description }
    return URL(string: item.url)?.host ?? item.url
  }
  private var favorite: Bool { machine.favorites.favorite(source: source.id, item: item.id) }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 10) {
        SoftwareIconView(title: title, artwork: item.artwork)
        VStack(alignment: .leading, spacing: 4) {
          Text(title).font(.system(size: 14, weight: .semibold)).lineLimit(1).help(title)
          Text(item.group.title.localized(chinese: text.chinese)).font(.caption).foregroundStyle(.secondary).lineLimit(
            1)
        }.frame(maxWidth: .infinity, alignment: .leading)
        if source.canInstall(item) { selection }
        favoriteButton
      }
      Text(description)
        .font(.callout).foregroundStyle(.secondary).lineLimit(2)
        .frame(maxWidth: .infinity, minHeight: 34, maxHeight: 34, alignment: .topLeading)
        .help(description)
      HStack(spacing: 8) {
        HStack(spacing: 5) {
          Image(systemName: statusSymbol).foregroundStyle(item.status == "detected" ? Color.green : Color.secondary)
            .accessibilityHidden(true)
          Text(text.softwareStatus(item.status))
        }.font(.caption).foregroundStyle(.secondary)
        Spacer(minLength: 4)
        primaryAction
        moreMenu
      }.controlSize(.small).frame(height: 24)
    }
    .padding(14)
    .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
    .overlay {
      RoundedRectangle(cornerRadius: 12).strokeBorder(
        selected ? Color.accentColor.opacity(0.8) : Color.primary.opacity(hovered ? 0.18 : 0.08),
        lineWidth: selected ? 1.5 : 1)
    }
    .onHover { hovered = $0 }
    .accessibilityElement(children: .contain)
  }

  private var statusSymbol: String {
    switch item.status {
    case "detected": "checkmark.circle.fill"
    case "not-detected": "circle.dashed"
    default: "questionmark.circle"
    }
  }
  private var selection: some View {
    Toggle(
      text.copy("选择 ", "Select ") + title,
      isOn: Binding(
        get: { selected },
        set: { value in
          if value {
            machine.installations.selected.insert(selectionKey)
          } else {
            machine.installations.selected.remove(selectionKey)
          }
        }
      )
    ).labelsHidden().toggleStyle(.checkbox)
      .disabled(!selected && machine.installations.selectedIDs(source).count >= 50)
      .help(text.copy("选择以批量安装（每个来源最多 50 项）", "Select for batch installation (up to 50 per source)"))
  }
  private var favoriteButton: some View {
    Button {
      Task { await machine.favorites.add(source: source.id, item: item.id) }
    } label: {
      Image(systemName: favorite ? "star.fill" : "star")
        .foregroundStyle(favorite ? Color.orange : Color.secondary).frame(width: 22, height: 24)
        .contentShape(Rectangle())
    }.buttonStyle(.plain)
      .accessibilityLabel(
        (favorite ? text.copy("已收藏：", "Favorited: ") : text.copy("添加到常用工具：", "Add to Favorites: ")) + title
      )
      .help(favorite ? text.copy("已在常用工具", "Already in Favorites") : text.copy("添加到常用工具", "Add to Favorites"))
      .disabled(!machine.favorites.canChange || favorite || (machine.favorites.snapshot?.tools.count ?? 100) >= 100)
  }
  @ViewBuilder private var primaryAction: some View {
    if source.canOpen(item) {
      Button(text.copy("打开", "Open")) { Task { await machine.open(item, in: source) } }
        .buttonStyle(.bordered)
        .disabled(machine.opening.contains(machine.key(source, item)))
        .accessibilityLabel(text.copy("打开 ", "Open ") + title)
    } else if source.canInstall(item) {
      Button(text.copy("安装…", "Install…")) {
        Task { await machine.installations.preview(source: source.id, ids: [item.id]) }
      }
      .buttonStyle(.bordered)
      .disabled(
        machine.installations.planning || machine.installations.installing
          || machine.installations.sourceBusy(source.id)
      )
      .accessibilityLabel(text.copy("审阅安装 ", "Review Installation of ") + title)
    } else if item.status != "detected", let url = DesktopBridge.externalURL(item.downloadUrl) {
      Button(text.copy("官方下载", "Download")) { NSWorkspace.shared.open(url) }.buttonStyle(.bordered)
        .accessibilityLabel(text.copy("官方下载页：", "Official Download Page: ") + title)
    } else if let url = DesktopBridge.externalURL(item.url) {
      Button(text.copy("官网", "Website")) { NSWorkspace.shared.open(url) }.buttonStyle(.bordered)
        .accessibilityLabel(text.copy("访问官网：", "Visit Website: ") + title)
    }
  }
  private var moreMenu: some View {
    Menu {
      link(item.url, label: text.copy("访问官网", "Visit Website"), symbol: "globe")
      link(item.downloadUrl, label: text.copy("官方下载页", "Official Download Page"), symbol: "arrow.down.circle")
      link(
        item.repositoryUrl, label: text.copy("源码仓库", "Source Repository"),
        symbol: "chevron.left.forwardslash.chevron.right")
      if let platforms = item.platforms, !platforms.isEmpty {
        Divider()
        Text(text.copy("支持平台：", "Platforms: ") + platforms.joined(separator: " · "))
      }
    } label: {
      Image(systemName: "ellipsis").frame(width: 22, height: 24).contentShape(Rectangle())
    }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
      .accessibilityLabel(text.copy("更多操作：", "More Actions: ") + title)
      .help(text.copy("官网、下载与源码", "Website, downloads and source code"))
  }
  @ViewBuilder private func link(_ value: String?, label: String, symbol: String) -> some View {
    if let url = DesktopBridge.externalURL(value) {
      Button {
        NSWorkspace.shared.open(url)
      } label: {
        Label(label, systemImage: symbol)
      }
    }
  }
}

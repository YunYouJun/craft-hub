import AppKit
import CraftHubMacCore
import SwiftUI

/// A native catalog browser. Installation plans and other unported actions remain available in the workbench.
struct SoftwareView: View {
  @Bindable var machine: MachineModel
  let showWorkbench: () -> Void
  private let text = L10n.text

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      HStack {
        TextField(text.copy("搜索软件或分类", "Search software or categories"), text: $machine.search)
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
        Text(message).font(.callout).foregroundStyle(.secondary).textSelection(.enabled).padding(.horizontal, 24).padding(.bottom, 8)
      }
      catalog
    }
    .task { await machine.loadSoftware() }
  }

  private var header: some View {
    HStack {
      VStack(alignment: .leading, spacing: 5) {
        Text(text.copy("软件中心", "Software")).font(.largeTitle.bold())
        Text(text.copy("浏览本机软件，查找缺失项", "Browse local software and find missing tools")).foregroundStyle(.secondary)
      }
      Spacer()
      Button(text.copy("完整软件管理…", "Manage Software…"), action: showWorkbench)
      Button {
        Task { await machine.loadSoftware(force: true) }
      } label: { Label(text.copy("重新检测", "Check Again"), systemImage: "arrow.clockwise") }
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
          ForEach(snapshot.sources) { source in
            let items = machine.visibleItems(source)
            if !items.isEmpty || source.error != nil {
              Section(source.title) {
                if source.error != nil {
                  Label(text.copy("来源暂时不可用，请重新检测", "Source unavailable. Check again to retry."), systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.secondary)
                }
                ForEach(items) { item in row(item, source: source) }
              }
            }
          }
          if snapshot.sources.allSatisfy({ machine.visibleItems($0).isEmpty }) {
            Text(text.copy("没有匹配的软件", "No matching software")).foregroundStyle(.secondary)
          }
          Text(text.copy("未检测到的软件可能安装在其他位置；未知表示来源尚未提供本机检测结果。", "Undetected software may be installed elsewhere. Unknown means the source has not provided local observations."))
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
      Image(systemName: "app.dashed").font(.title2).foregroundStyle(.secondary).accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 4) {
        Text(item.title.localized(chinese: text.chinese)).fontWeight(.medium)
        Text(item.group.title.localized(chinese: text.chinese)).font(.caption).foregroundStyle(.secondary)
        if let description = item.description, !description.isEmpty {
          Text(description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
        }
      }
      Spacer()
      Text(text.softwareStatus(item.status)).font(.callout).foregroundStyle(.secondary)
      if source.canOpen(item) {
        Button(text.copy("打开", "Open")) { Task { await machine.open(item, in: source) } }
          .disabled(machine.opening.contains(machine.key(source, item)))
          .accessibilityLabel(text.copy("打开 ", "Open ") + item.title.localized(chinese: text.chinese))
      }
      if let url = DesktopBridge.externalURL(item.url) {
        Button { NSWorkspace.shared.open(url) } label: { Image(systemName: "arrow.up.right.square") }
          .help(text.copy("访问官网", "Visit Website"))
          .accessibilityLabel(text.copy("访问官网：", "Visit website: ") + item.title.localized(chinese: text.chinese))
      }
    }
    .buttonStyle(.bordered).padding(.vertical, 8)
    .accessibilityElement(children: .contain)
  }
}

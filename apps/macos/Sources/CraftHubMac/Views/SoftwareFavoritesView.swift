import AppKit
import CraftHubMacCore
import SwiftUI

struct SoftwareFavoritesView: View {
  let model: SoftwareFavoritesModel
  @State private var search = ""
  @State private var removing: Removal?
  private var text: L10n { L10n.text }
  private struct Removal: Identifiable {
    let tool: SoftwareFavoritesSnapshot.Tool
    let revision: String
    var id: String { tool.id }
  }
  private var tools: [SoftwareFavoritesSnapshot.Tool] {
    (model.snapshot?.tools ?? []).filter {
      search.isEmpty
        || [$0.title, $0.group, $0.url, $0.downloadUrl ?? "", $0.repositoryUrl ?? ""].contains {
          $0.localizedStandardContains(search)
        }
    }
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      TextField(text.copy("搜索常用工具", "Search Favorites"), text: $search).textFieldStyle(.roundedBorder).padding(
        .horizontal, 24)
      List {
        Text(
          text.copy(
            "与个人工作台共享收藏。移除收藏不会卸载软件。",
            "Favorites are shared with the personal workbench. Removing one does not uninstall software.")
        ).foregroundStyle(.secondary)
        if model.snapshot == nil {
          Text(
            text.copy("收藏尚不可用，请重新读取或使用完整软件管理。", "Favorites are unavailable. Reload or open full software management."))
        } else if tools.isEmpty {
          Text(text.copy("没有匹配的常用工具", "No Matching Favorites"))
        }
        ForEach(Array(Set(tools.map(\.group))).sorted(), id: \.self) { group in
          Section(group) {
            ForEach(tools.filter { $0.group == group }) { tool in
              HStack(spacing: 14) {
                SoftwareIconView(title: tool.title, artwork: tool.artwork)
                VStack(alignment: .leading, spacing: 5) {
                  Text(tool.title).fontWeight(.medium)
                  if let description = tool.description { Text(description).font(.caption).foregroundStyle(.secondary) }
                  Text(tool.url).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                }
                Spacer()
                Button(tool.launch == nil ? text.copy("打开网站", "Open Website") : text.copy("打开", "Open")) {
                  Task { await model.open(tool.id) }
                }.disabled(model.opening != nil || model.busy)
                Menu {
                  if let url = DesktopBridge.externalURL(tool.downloadUrl) {
                    Button(text.copy("下载页", "Download Page")) { NSWorkspace.shared.open(url) }
                  }
                  if let url = DesktopBridge.externalURL(tool.repositoryUrl) {
                    Button(text.copy("源码仓库", "Source Repository")) { NSWorkspace.shared.open(url) }
                  }
                  if let url = DesktopBridge.externalURL(tool.url) {
                    Button(text.copy("访问官网", "Visit Website")) { NSWorkspace.shared.open(url) }
                  }
                } label: {
                  Image(systemName: "arrow.up.right.square").accessibilityLabel(
                    text.copy("工具链接：", "Tool Links: ") + tool.title)
                }
                Button(text.copy("移除收藏…", "Remove Favorite…")) {
                  if let revision = model.snapshot?.revision { removing = Removal(tool: tool, revision: revision) }
                }.disabled(!model.canChange)
              }.padding(.vertical, 6)
            }
          }
        }
        if let count = model.snapshot?.tools.count { Text("\(count) / 100").font(.caption).foregroundStyle(.secondary) }
      }.listStyle(.inset)
    }
    .confirmationDialog(
      text.copy("移除收藏？", "Remove Favorite?"),
      isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), presenting: removing
    ) { request in
      Button(text.copy("移除收藏", "Remove Favorite")) {
        removing = nil
        Task { await model.remove(request.tool.id, revision: request.revision) }
      }.disabled(!model.canChange || model.snapshot?.revision != request.revision)
    } message: { request in
      Text(request.tool.title + "\n" + request.tool.url)
    }
  }
}

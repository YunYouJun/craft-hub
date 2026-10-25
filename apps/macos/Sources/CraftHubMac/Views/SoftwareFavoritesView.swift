import CraftHubMacCore
import SwiftUI

struct SoftwareFavoritesView: View {
  @Bindable var model: SoftwareFavoritesModel
  var findRequest = 0
  @State private var search = ""
  @FocusState private var searchFocused: Bool
  @State private var removing: Removal?
  private var text: L10n { L10n.text }
  private struct Removal: Identifiable {
    let tool: SoftwareFavoritesSnapshot.Tool
    let revision: String
    var id: String { tool.id }
  }
  private func groupTitle(_ group: String) -> String {
    switch group {
    case "AI Tools": text.copy("AI 工具", "AI Tools")
    case "Work tools": text.copy("执行工具", "Work Tools")
    default: group
    }
  }
  private var tools: [SoftwareFavoritesSnapshot.Tool] {
    let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
    return (model.snapshot?.tools ?? []).filter {
      query.isEmpty
        || [
          $0.title, $0.group, groupTitle($0.group), $0.url, $0.description ?? "", $0.downloadUrl ?? "",
          $0.repositoryUrl ?? "",
        ]
        .contains { $0.localizedStandardContains(query) }
    }
  }
  private var groups: [String] {
    tools.reduce(into: []) { result, tool in
      if !result.contains(tool.group) { result.append(tool.group) }
    }
  }
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        TextField(text.copy("搜索常用工具", "Search Favorites"), text: $search)
          .textFieldStyle(.roundedBorder).focused($searchFocused)
          .accessibilityLabel(text.copy("搜索常用工具", "Search Favorites"))
        if model.loading || model.busy { ProgressView().controlSize(.small) }
        Button {
          Task { await model.load(force: true) }
        } label: {
          Label(text.copy("重新读取", "Reload"), systemImage: "arrow.clockwise")
        }.disabled(model.loading || model.busy)
        Button {
          model.beginEditing()
        } label: {
          Label(text.copy("自定义工具", "Customize Tools"), systemImage: "square.and.pencil")
        }.disabled(!model.canChange)
      }.padding(.horizontal, 24)
      if let error = model.error { NativeErrorView(message: error).padding(.horizontal, 24) }
      if let notice = model.notice {
        Text(notice).font(.callout).foregroundStyle(.secondary).padding(.horizontal, 24)
      }
      if model.stale, model.snapshot != nil {
        Text(text.copy("正在显示上次读取的工具，请重新读取后编辑。", "Showing previously loaded tools. Reload before editing."))
          .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 24)
      }
      if model.snapshot == nil {
        ContentUnavailableView(
          text.copy("尚未读取常用工具", "Favorites Not Loaded"), systemImage: "star",
          description: Text(text.copy("重新读取以查看已保存的网站和应用。", "Reload to view your saved websites and apps.")))
      } else if tools.isEmpty {
        ContentUnavailableView {
          Label(text.copy("没有匹配的常用工具", "No Matching Favorites"), systemImage: "star")
        } description: {
          Text(
            search.isEmpty
              ? text.copy("添加工具，或在软件中心收藏软件。", "Add a tool or save software from the catalog.")
              : text.copy("试试其他关键词。", "Try another search."))
        } actions: {
          if search.isEmpty {
            Button(text.copy("添加工具", "Add Tool")) {
              model.beginEditing()
              model.appendTool()
            }.disabled(!model.canChange)
          }
        }
      } else {
        List {
          ForEach(groups, id: \.self) { group in
            Section(groupTitle(group)) {
              ForEach(tools.filter { $0.group == group }) { tool in row(tool) }
            }
          }
        }.listStyle(.inset)
      }
      HStack {
        Text(
          text.copy(
            "与软件中心共享收藏；移除工具不会卸载应用。", "Shared with Software favorites; removing a tool does not uninstall the app."))
        Spacer()
        if let count = model.snapshot?.tools.count { Text("\(count) / 100") }
      }.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 24).padding(.bottom, 16)
    }
    .onChange(of: findRequest) { searchFocused = true }
    .sheet(isPresented: $model.editing) { ToolEditorView(model: model) }
    .confirmationDialog(
      text.copy("移除收藏？", "Remove Favorite?"),
      isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), presenting: removing
    ) { request in
      Button(text.copy("移除收藏", "Remove Favorite"), role: .destructive) {
        removing = nil
        Task { await model.remove(request.tool.id, revision: request.revision) }
      }.disabled(!model.canChange || model.snapshot?.revision != request.revision)
    } message: { request in
      Text(request.tool.title + "\n" + request.tool.url)
    }
  }

  private func row(_ tool: SoftwareFavoritesSnapshot.Tool) -> some View {
    HStack(spacing: 14) {
      Button {
        Task { await model.open(tool.id) }
      } label: {
        HStack(spacing: 14) {
          SoftwareIconView(title: tool.title, artwork: model.artwork(tool))
          VStack(alignment: .leading, spacing: 5) {
            Text(tool.title).fontWeight(.medium).foregroundStyle(.primary)
            Text(subtitle(tool)).font(.caption).foregroundStyle(.secondary).lineLimit(2)
          }
          Spacer(minLength: 10)
          Image(systemName: model.opening == tool.id ? "hourglass" : "arrow.up.right")
            .foregroundStyle(.secondary)
        }.contentShape(Rectangle())
      }.buttonStyle(.plain).disabled(model.opening != nil || model.busy)
        .accessibilityLabel(text.copy("打开 ", "Open ") + tool.title)
        .help(tool.description ?? tool.url)
      SoftwareLinkButtons(
        title: tool.title, website: tool.url, download: tool.downloadUrl, repository: tool.repositoryUrl)
      Menu {
        Button(text.copy("编辑工具…", "Edit Tool…")) { model.beginEditing(select: tool.id) }
        Button(text.copy("移除收藏…", "Remove Favorite…"), role: .destructive) {
          if let revision = model.snapshot?.revision { removing = Removal(tool: tool, revision: revision) }
        }
      } label: {
        Image(systemName: "ellipsis").frame(width: 24, height: 24)
      }
      .menuStyle(.borderlessButton).fixedSize().disabled(!model.canChange)
      .accessibilityLabel(text.copy("管理工具：", "Manage Tool: ") + tool.title)
    }.padding(.vertical, 8)
  }

  private func subtitle(_ tool: SoftwareFavoritesSnapshot.Tool) -> String {
    if let launch = tool.launch {
      return launch.commandUrl == nil
        ? text.copy("打开本机应用", "Open Local App") : text.copy("运行已配置的 Raycast 命令", "Run Configured Raycast Command")
    }
    return tool.description?.isEmpty == false ? tool.description! : URL(string: tool.url)?.host ?? tool.url
  }
}

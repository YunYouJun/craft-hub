import CraftHubMacCore
import SwiftUI
import UniformTypeIdentifiers

struct ProjectsView: View {
  @Bindable var projects: ProjectsModel
  let findRequest: Int
  @FocusState private var searchFocused: Bool
  let openProject: (String) -> Void
  let showWorkbench: () -> Void
  @State private var choosingFolder = false
  @State private var receivingDrop = false
  private var text: L10n { L10n.text }

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text(text.copy("本机项目", "Local projects")).font(.title2)
        Text("\(projects.projects.count)").foregroundStyle(.secondary)
        if projects.loading || projects.adding { ProgressView().controlSize(.small) }
        Spacer()
        Button(text.copy("完整工作台", "Full Workbench"), action: showWorkbench)
        Button(text.copy("添加项目…", "Add Projects…"), systemImage: "folder.badge.plus") { choosingFolder = true }
          .disabled(projects.adding).keyboardShortcut("o", modifiers: [.command, .shift])
      }.padding()
      if let error = projects.error { NativeErrorView(message: error) }
      Table(projects.filtered, selection: $projects.selectedID) {
        TableColumn(text.copy("名称", "Name")) { project in
          Label(project.name, systemImage: "folder").lineLimit(1)
        }.width(min: 140, ideal: 230)
        TableColumn(text.copy("路径", "Path"), value: \.path)
        TableColumn(text.copy("信任", "Trust")) { project in
          Text(project.trust == "trusted" ? text.copy("已信任", "Trusted") : text.copy("未信任", "Untrusted"))
            .foregroundStyle(project.trust == "trusted" ? .primary : .secondary)
        }.width(90)
      }
      .contextMenu(forSelectionType: String.self) { selection in
        if let id = selection.first {
          Button(text.copy("查看项目与能力", "View Project and Capabilities")) { openProject(id) }
        }
      } primaryAction: { selection in
        if let id = selection.first { openProject(id) }
      }
      .overlay {
        if projects.filtered.isEmpty && !projects.loading {
          ContentUnavailableView(
            projects.search.isEmpty
              ? text.copy("添加第一个项目", "Add your first project") : text.copy("没有匹配项目", "No matching projects"),
            systemImage: "folder",
            description: Text(text.copy("拖入文件夹，或使用“添加项目”。", "Drop a folder here, or choose Add Projects.")))
        }
      }
      HStack {
        Text(text.copy("添加项目不会授予信任。运行命令前仍需审阅。", "Adding a project does not grant trust. Commands require review."))
          .font(.caption).foregroundStyle(.secondary)
        Spacer()
        Button(text.copy("查看项目", "View Project")) {
          if let selected = projects.selected { openProject(selected.id) }
        }.disabled(projects.selected == nil).keyboardShortcut(.return, modifiers: [])
      }.padding()
      if !projects.diagnostics.isEmpty {
        DisclosureGroup(text.copy("项目发现提示", "Project discovery notices")) {
          ForEach(projects.diagnostics) { item in
            Text(item.message).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
          }
        }.padding([.horizontal, .bottom])
      }
    }
    .searchable(text: $projects.search, prompt: text.copy("按名称或路径搜索", "Search by name or path"))
    .searchFocused($searchFocused)
    .onChange(of: findRequest) { searchFocused = true }
    .overlay { if receivingDrop { RoundedRectangle(cornerRadius: 8).stroke(.tint, lineWidth: 2).padding(4) } }
    .dropDestination(for: URL.self) { urls, _ in
      guard urls.contains(where: \.isFileURL), !projects.adding else { return false }
      Task { await projects.add(urls) }
      return true
    } isTargeted: {
      receivingDrop = $0
    }
    .fileImporter(isPresented: $choosingFolder, allowedContentTypes: [.folder], allowsMultipleSelection: true) {
      result in
      switch result {
      case .success(let urls): Task { await projects.add(urls) }
      case .failure(let error): projects.report(error)
      }
    }
    .task { await projects.load() }
  }
}

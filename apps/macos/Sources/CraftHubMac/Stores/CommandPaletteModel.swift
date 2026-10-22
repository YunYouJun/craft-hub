import CraftHubMacCore
import Foundation
import Observation

@MainActor @Observable
final class CommandPaletteModel {
  enum Category: String, CaseIterable, Identifiable {
    case all, projects, pages, commands, skills
    var id: String { rawValue }
    var title: String {
      let text = L10n.text
      return switch self {
      case .all: text.copy("全部", "All")
      case .projects: text.copy("项目", "Projects")
      case .pages: text.copy("页面", "Pages")
      case .commands: text.copy("命令", "Commands")
      case .skills: text.copy("技能", "Skills")
      }
    }
  }
  enum Action {
    case destination(Destination), settings, capture, reload, webPath(String)
    case project(String, String?)
  }
  struct Item: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let symbol: String
    let category: Category
    let action: Action
    var projectName = ""
  }
  var query = ""
  var category: Category = .all
  var selectedID: String?
  var focus = UUID()
  private(set) var loading = false
  private(set) var error: String?
  private(set) var catalog: [Item] = []
  private(set) var extraPages: [Item] = []
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var generation = 0
  @ObservationIgnored private var task: Task<Void, Never>?

  var results: [Item] {
    let text = L10n.text
    let pages = Destination.allCases.map {
      Item(id: "page:\($0.id)", title: $0.title, subtitle: text.copy("前往页面", "Go to page"), symbol: $0.symbol, category: .pages, action: .destination($0))
    } + [
      Item(id: "capture", title: text.copy("快速记录", "Quick Capture"), subtitle: "⇧⌘Space · Microsoft To Do", symbol: "square.and.pencil", category: .pages, action: .capture),
      Item(id: "settings", title: text.settings, subtitle: "⌘,", symbol: "gearshape", category: .pages, action: .settings),
      Item(id: "reload", title: text.reload, subtitle: "⌘R", symbol: "arrow.clockwise", category: .pages, action: .reload),
    ]
    var term = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let commandOnly = term.hasPrefix(">")
    if commandOnly { term.removeFirst(); term = term.trimmingCharacters(in: .whitespaces) }
    let components = term.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
    let projectTerm = components.count == 2 ? String(components[0]) : nil
    let search = components.count == 2 ? String(components[1]) : term
    return Array((pages + extraPages + catalog).filter { item in
      guard category == .all || item.category == category else { return false }
      if commandOnly && item.category != .commands && item.category != .pages { return false }
      if let projectTerm, item.projectName.isEmpty || !item.projectName.lowercased().contains(projectTerm) { return false }
      return search.isEmpty || (item.title + " " + item.subtitle).localizedStandardContains(search)
    }.sorted { a, b in
      func rank(_ item: Item) -> Int {
        if item.title.lowercased() == search { return 0 }
        if item.title.lowercased().hasPrefix(search) { return 1 }
        return 2
      }
      let ar = rank(a), br = rank(b)
      return ar == br ? a.title.localizedStandardCompare(b.title) == .orderedAscending : ar < br
    }.prefix(50))
  }
  var selected: Item? { results.first { $0.id == selectedID } ?? results.first }
  func move(_ offset: Int) {
    let values = results
    guard !values.isEmpty else { return }
    let current = values.firstIndex { $0.id == selected?.id } ?? 0
    selectedID = values[(current + offset + values.count) % values.count].id
  }
  func connect(_ client: RuntimeAPIClient?) {
    task?.cancel()
    generation += 1
    self.client = client
    catalog = []
    extraPages = []
    loading = false
  }
  func opened(mode: Category = .all) {
    query = ""; category = mode; selectedID = nil; focus = UUID()
    refresh()
  }
  func refresh() {
    task?.cancel()
    generation += 1
    let version = generation
    guard let client else {
      error = L10n.text.copy("运行时尚未就绪；仍可前往页面。", "Runtime unavailable; pages remain available.")
      return
    }
    loading = true
    error = nil
    task = Task {
      defer { if version == generation { loading = false } }
      do {
        async let pageRequest = client.palettePages(locale: L10n.text.chinese ? "zh-CN" : "en")
        let projects = try await client.projects()
        guard version == generation, !Task.isCancelled else { return }
        catalog = projects.map { project in
          Item(id: "project:\(project.id)", title: project.name, subtitle: project.path, symbol: "folder", category: .projects,
               action: .project(project.id, nil), projectName: project.name)
        }
        if let pages = try? await pageRequest, version == generation {
          extraPages = pages.map { Item(id: $0.id, title: $0.title, subtitle: L10n.text.copy("插件页面", "Plugin page"),
            symbol: "puzzlepiece.extension", category: .pages, action: .webPath($0.path)) }
        }
        // Read-only discovery, four projects at a time. A broken project does not hide the others.
        for start in stride(from: 0, to: projects.count, by: 4) {
          guard version == generation, !Task.isCancelled else { return }
          let batch = Array(projects[start..<min(start + 4, projects.count)])
          let values = await withTaskGroup(of: (PaletteProject, [PaletteCapability]?).self) { group in
            for project in batch { group.addTask { (project, try? await client.capabilities(projectID: project.id)) } }
            var results: [(PaletteProject, [PaletteCapability]?)] = []
            for await value in group { results.append(value) }
            return results
          }
          guard version == generation, !Task.isCancelled else { return }
          for (project, capabilities) in values {
            guard let capabilities else {
              error = L10n.text.copy("部分项目发现失败，可刷新重试。", "Some projects could not be discovered. Retry refresh.")
              continue
            }
            catalog += capabilities.map { capability in
              Item(id: "\(project.id):\(capability.id)", title: capability.name,
                   subtitle: "\(project.name) · \(capability.description ?? capability.kind)",
                   symbol: capability.kind == "skill" ? "sparkles" : "terminal",
                   category: capability.kind == "skill" ? .skills : .commands,
                   action: .project(project.id, capability.id), projectName: project.name)
            }
          }
        }
      } catch {
        if version == generation { self.error = error.localizedDescription }
      }
    }
  }
}

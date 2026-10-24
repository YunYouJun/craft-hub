import CraftHubMacCore
import Foundation
import Observation

/// App-owned catalog shared by the native project page and menu. Navigation never grants trust or runs commands.
@MainActor @Observable
final class ProjectsModel {
  var search = ""
  var selectedID: String?
  private(set) var projects: [PaletteProject] = []
  private(set) var diagnostics: [ProjectCatalog.Diagnostic] = []
  private(set) var loading = false
  private(set) var adding = false
  private(set) var error: String?
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private var loadedRevision = -1
  @ObservationIgnored private var loadTask: Task<Void, Never>?

  var filtered: [PaletteProject] {
    let term = search.trimmingCharacters(in: .whitespacesAndNewlines)
    return projects.filter {
      term.isEmpty || $0.name.localizedStandardContains(term) || $0.path.localizedStandardContains(term)
    }
  }
  var selected: PaletteProject? { projects.first { $0.id == selectedID } }

  func connect(_ client: RuntimeAPIClient?) {
    generation = UUID()
    loadTask?.cancel()
    loadTask = nil
    self.client = client
    projects = []
    diagnostics = []
    loading = false
    adding = false
    error = nil
    revision += 1
    loadedRevision = -1
  }

  func invalidate(_ changes: Set<RuntimeChange>) {
    if !changes.isDisjoint(with: [.projects, .projectCatalog, .configurationSync, .userConfig]) { revision += 1 }
  }

  func load(force: Bool = false) async {
    if force { revision += 1 }
    if let loadTask {
      await loadTask.value
      return
    }
    guard let client, loadedRevision != revision else { return }
    let attempt = generation
    loading = true
    loadTask = Task {
      defer {
        if generation == attempt {
          loading = false
          loadTask = nil
        }
      }
      repeat {
        let requestedRevision = revision
        do {
          let snapshot = try await client.projectCatalog()
          guard attempt == generation, !Task.isCancelled else { return }
          projects = snapshot.projects
          diagnostics = snapshot.diagnostics
          loadedRevision = requestedRevision
          error = nil
          if let selectedID, !projects.contains(where: { $0.id == selectedID }) { self.selectedID = nil }
        } catch {
          if attempt == generation { self.error = error.localizedDescription }
          return
        }
      } while loadedRevision != revision && attempt == generation && !Task.isCancelled
    }
    await loadTask?.value
  }

  /// Folder selection and dropping share the same runtime registration path; failures retain successful additions.
  func add(_ urls: [URL]) async {
    guard let client, !adding else { return }
    let attempt = generation
    adding = true
    error = nil
    var failures: [String] = []
    defer { if attempt == generation { adding = false } }
    let paths = Set(
      urls.filter { $0.isFileURL && ($0.host == nil || $0.host == "" || $0.host == "localhost") }.map(\.path))
    guard !paths.isEmpty, paths.count <= 100 else {
      error = L10n.text.copy("请选择 1–100 个本机文件夹。", "Choose 1–100 local folders.")
      return
    }
    for path in paths.sorted() {
      guard attempt == generation, !Task.isCancelled else { return }
      do {
        let project = try await client.addProject(path: path)
        guard attempt == generation else { return }
        if let index = projects.firstIndex(where: { $0.id == project.id }) {
          projects[index] = project
        } else {
          projects.append(project)
        }
        selectedID = project.id
      } catch { failures.append("\(URL(fileURLWithPath: path).lastPathComponent): \(error.localizedDescription)") }
    }
    guard attempt == generation else { return }
    await load(force: true)
    if !failures.isEmpty { error = failures.joined(separator: "\n") }
  }

  func report(_ error: Error) { self.error = error.localizedDescription }
}

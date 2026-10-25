import CraftHubMacCore
import Foundation
import Observation

/// One cached directory per runtime connection. Plugin changes and language changes supersede in-flight reads.
@MainActor @Observable final class WebsiteNavigationModel {
  private(set) var panels: [NavigationPanel]?
  private(set) var loading = false
  private(set) var error: String?
  var query = ""
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var request: Task<Void, Never>?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private var loadedRevision = -1
  @ObservationIgnored private var locale = ""

  var stale: Bool { panels != nil && loadedRevision != revision }
  var canOpen: Bool { client != nil && panels != nil && !stale && !loading && error == nil }
  var linkCount: Int { (panels ?? []).reduce(0) { $0 + $1.links.count } }
  var pluginCount: Int { Set((panels ?? []).map(\.pluginId)).count }
  var hasQuery: Bool { !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
  var visiblePanels: [NavigationPanel] { (panels ?? []).filter { !visibleLinks($0).isEmpty } }

  struct Entry: Identifiable {
    struct ID: Hashable {
      let panel: String
      let link: String
    }
    let id: ID
    let link: NavigationPanel.Link
  }

  // List flattens section rows, so link IDs must include their plugin and panel scope.
  func visibleEntries(_ panel: NavigationPanel) -> [Entry] {
    visibleLinks(panel).map { Entry(id: .init(panel: panel.id, link: $0.id), link: $0) }
  }

  func visibleLinks(_ panel: NavigationPanel) -> [NavigationPanel.Link] {
    let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return panel.links.filter { link in
      term.isEmpty
        || ([panel.title, panel.description ?? "", panel.pluginName, link.title, link.description ?? "", link.url]
          + link.keywords)
          .contains { $0.localizedStandardContains(term) }
    }
  }

  func connect(_ client: RuntimeAPIClient?) {
    request?.cancel()
    request = nil
    generation = UUID()
    self.client = client
    panels = nil
    loading = false
    error = nil
    revision += 1
  }

  func invalidate(_ changes: Set<RuntimeChange>) {
    if !changes.isDisjoint(with: [.plugins, .pluginUpdate, .settings, .userConfig, .configurationSync]) {
      revision += 1
    }
  }

  func load(locale: String, force: Bool = false) async {
    if self.locale != locale {
      self.locale = locale
      revision += 1
    }
    if force { revision += 1 }
    if let request {
      await request.value
      return
    }
    guard let client, loadedRevision != revision else { return }
    let attempt = generation
    loading = true
    error = nil
    request = Task {
      defer {
        if generation == attempt {
          loading = false
          request = nil
        }
      }
      repeat {
        let version = revision
        let language = self.locale
        do {
          let result = try await client.navigationPanels(locale: language)
          guard attempt == generation, !Task.isCancelled else { return }
          if version == revision {
            panels = result
            loadedRevision = version
            error = nil
          }
        } catch {
          guard attempt == generation, !Task.isCancelled else { return }
          if version == revision {
            self.error = error.localizedDescription
            return
          }
        }
      } while loadedRevision != revision && !Task.isCancelled
    }
    await request?.value
  }
}

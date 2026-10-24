import CraftHubMacCore
import Foundation
import Observation

@MainActor @Observable final class DiagnosticsModel {
  private(set) var snapshot: DiagnosticSnapshot?
  private(set) var loading = false
  private(set) var error: String?
  var query = "" { didSet { reconcileSelection() } }
  var severity = "all" { didSet { reconcileSelection() } }
  var providerID = "all" { didSet { reconcileSelection() } }
  var selectedID: String?
  var detailID: String?
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var request: Task<Void, Never>?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private var loadedRevision = -1

  var stale: Bool { snapshot != nil && loadedRevision != revision }
  var allClear: Bool { snapshot?.allClear == true && !stale && !loading && error == nil }
  var selected: DiagnosticSnapshot.Item? { filtered.first { $0.id == selectedID } }
  var detail: DiagnosticSnapshot.Item? { snapshot?.diagnostics.first { $0.id == detailID } }

  private func reconcileSelection() {
    if selected == nil { selectedID = nil }
    if detail == nil { detailID = nil }
  }

  var filtered: [DiagnosticSnapshot.Item] {
    let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return (snapshot?.diagnostics ?? []).filter { item in
      (severity == "all" || item.severity == severity)
        && (providerID == "all" || item.providerId == providerID)
        && (term.isEmpty
          || [item.subject, item.message, item.path, item.code, item.providerId].compactMap { $0 }.contains {
            $0.localizedStandardContains(term)
          })
    }
  }
  var hasFilters: Bool {
    !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || severity != "all" || providerID != "all"
  }
  func clearFilters() {
    query = ""
    severity = "all"
    providerID = "all"
  }
  var groups: [String] { Array(Set(filtered.map(\.kind))).sorted() }
  func connect(_ client: RuntimeAPIClient?) {
    request?.cancel()
    request = nil
    generation = UUID()
    self.client = client
    snapshot = nil
    selectedID = nil
    detailID = nil
    providerID = "all"
    error = nil
    loading = false
    revision += 1
  }
  func invalidate(_ changes: Set<RuntimeChange>) {
    if !changes.isDisjoint(with: [
      .projects, .projectCatalog, .plugins, .pluginUpdate, .settings, .userConfig, .configurationSync, .integrations,
    ]) {
      revision += 1
    }
  }
  func load(force: Bool = false) async {
    if force { revision += 1 }
    if let request {
      await request.value
      return
    }
    guard let client, loadedRevision != revision else { return }
    let attempt = generation
    loading = true
    request = Task {
      defer {
        if generation == attempt {
          loading = false
          request = nil
        }
      }
      repeat {
        let version = revision
        do {
          let result = try await client.diagnostics()
          guard attempt == generation, !Task.isCancelled else { return }
          snapshot = result
          reconcileSelection()
          if providerID != "all", !(result.providers ?? []).contains(where: { $0.id == providerID }) {
            providerID = "all"
          }
          loadedRevision = version
          error = nil
        } catch {
          if attempt == generation { self.error = error.localizedDescription }
          return
        }
      } while loadedRevision != revision && !Task.isCancelled
    }
    await request?.value
  }
}

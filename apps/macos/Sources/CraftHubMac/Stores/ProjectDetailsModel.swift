import CraftHubMacCore
import Foundation
import Observation

/// App-owned inspection state survives window recreation; runtime replacement discards its observations.
@MainActor @Observable
final class ProjectDetailsModel {
  private(set) var projectID: String?
  private(set) var snapshot: ProjectDetails?
  private(set) var loading = false
  private(set) var stale = true
  private(set) var error: String?
  private(set) var loadIdentity = UUID()
  var search = ""
  var kind = "all"
  var packagePath = ""
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private var loadedRevision = -1
  @ObservationIgnored private var loadingTask: Task<Void, Never>?

  var canReview: Bool { snapshot != nil && !stale && !loading && error == nil }
  var filtered: [ProjectDetails.Capability] {
    let term = search.trimmingCharacters(in: .whitespacesAndNewlines)
    return (snapshot?.discovery.capabilities ?? []).filter {
      (kind == "all" || $0.kind == kind)
        && (packagePath.isEmpty || $0.packagePath == packagePath)
        && (term.isEmpty
          || [$0.name, $0.description ?? "", $0.source, $0.packagePath ?? ""]
            .joined(separator: " ").localizedStandardContains(term))
    }
  }

  func connect(_ client: RuntimeAPIClient?) {
    resetRead()
    self.client = client
  }

  func select(_ projectID: String) {
    guard self.projectID != projectID else { return }
    resetRead()
    self.projectID = projectID
    search = ""
    kind = "all"
    packagePath = ""
  }

  func close() {
    resetRead()
    projectID = nil
  }

  private func resetRead() {
    loadingTask?.cancel()
    loadingTask = nil
    loadIdentity = UUID()
    snapshot = nil
    error = nil
    stale = true
    loading = false
    revision += 1
    loadedRevision = -1
  }

  func invalidate(_ changes: Set<RuntimeChange>) {
    guard
      !changes.isDisjoint(with: [
        .projects, .projectCatalog, .plugins, .pluginUpdate, .userConfig,
        .settings, .configurationSync,
      ])
    else { return }
    revision += 1
    stale = true
  }

  func load(force: Bool = false) async {
    if force {
      revision += 1
      stale = true
    }
    if let loadingTask {
      await loadingTask.value
      return
    }
    guard let client, let projectID, revision != loadedRevision else { return }
    let identity = loadIdentity
    loading = true
    loadingTask = Task {
      defer {
        if identity == loadIdentity {
          loading = false
          loadingTask = nil
        }
      }
      repeat {
        let requestedRevision = revision
        do {
          let value = try await client.projectDetails(projectID: projectID)
          guard identity == loadIdentity, !Task.isCancelled else { return }
          snapshot = value
          if !packagePath.isEmpty, !value.discovery.packages.contains(where: { $0.relativePath == packagePath }) {
            packagePath = ""
          }
          error = nil
          loadedRevision = requestedRevision
          stale = loadedRevision != revision
        } catch {
          guard identity == loadIdentity, !Task.isCancelled else { return }
          self.error = error.localizedDescription
          stale = true
          return
        }
      } while loadedRevision != revision && identity == loadIdentity && !Task.isCancelled
    }
    await loadingTask?.value
  }
}

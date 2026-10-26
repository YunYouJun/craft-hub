import CraftHubMacCore
import Foundation
import Observation

@MainActor
@Observable
final class ApplicationMaintenanceModel {
  private let client: RuntimeAPIClient
  private(set) var snapshot: ApplicationMaintenanceSnapshot?
  private(set) var guidance: ApplicationUninstallGuidance?
  private(set) var loading = false
  private(set) var inspecting = false
  private(set) var revealing = false
  private(set) var error: String?
  private(set) var notice: String?
  var query = ""
  var bundleId: String?
  var selection: String?
  private var generation = 0
  private var closed = false
  private var text: L10n { .text }

  init(client: RuntimeAPIClient) { self.client = client }

  var applications: [MaintainedApplication] {
    (snapshot?.applications ?? []).filter {
      (bundleId == nil || $0.bundleId == bundleId)
        && (query.isEmpty || "\($0.name) \($0.bundleId) \($0.path)".localizedCaseInsensitiveContains(query))
    }
  }

  func disconnect() {
    closed = true
    generation += 1
  }

  func load(force: Bool = false) async {
    guard !closed, !loading, force || snapshot == nil else { return }
    generation += 1
    loading = true
    guidance = nil
    selection = nil
    error = nil
    defer { loading = false }
    do {
      let result = try await client.maintainedApplications()
      guard !closed, !Task.isCancelled else { return }
      snapshot = result
      selection = applications.first?.id
    } catch {
      if !closed, !Task.isCancelled { self.error = error.localizedDescription }
    }
  }

  func inspect() async {
    generation += 1
    let request = generation
    guidance = nil
    notice = nil
    error = nil
    guard !closed, let selection else {
      inspecting = false
      return
    }
    inspecting = true
    defer { if request == generation { inspecting = false } }
    do {
      let result = try await client.applicationUninstallGuidance(id: selection)
      guard !closed, !Task.isCancelled, request == generation else { return }
      guidance = result
    } catch {
      if !closed, !Task.isCancelled, request == generation { self.error = error.localizedDescription }
    }
  }

  func reveal(candidate: String? = nil) async {
    guard !closed, !revealing, let guidance else { return }
    let id = guidance.application.id
    revealing = true
    error = nil
    defer { revealing = false }
    do {
      try await client.revealMaintainedApplication(id: id, candidate: candidate)
      guard !closed, selection == id else { return }
      notice = text.copy("已请求在 Finder 中显示。", "Requested reveal in Finder.")
    } catch {
      if !closed, selection == id { self.error = error.localizedDescription }
    }
  }
}

import CraftHubMacCore
import Foundation
import Observation

/// Cached native page state for one sidecar session. A restart replaces the store and its credentials together.
@MainActor
@Observable
final class MachineModel {
  private let client: RuntimeAPIClient
  private(set) var environment: EnvironmentSnapshot?
  private(set) var software: SoftwareSnapshot?
  private(set) var checkingEnvironment = false
  private(set) var checkingSoftware = false
  private(set) var environmentError: String?
  private(set) var softwareError: String?
  private(set) var opening = Set<String>()
  var operationMessage: String?
  var search = ""
  var softwareFilter = "all"

  init(client: RuntimeAPIClient) { self.client = client }

  func loadEnvironment(force: Bool = false) async {
    guard !checkingEnvironment, force || environment == nil else { return }
    checkingEnvironment = true
    environmentError = nil
    defer { checkingEnvironment = false }
    do { environment = try await client.environment() }
    catch { if !Task.isCancelled { environmentError = error.localizedDescription } }
  }

  func loadSoftware(force: Bool = false) async {
    guard !checkingSoftware, force || software == nil else { return }
    checkingSoftware = true
    softwareError = nil
    defer { checkingSoftware = false }
    do { software = try await client.software() }
    catch { if !Task.isCancelled { softwareError = error.localizedDescription } }
  }

  func visibleItems(_ source: SoftwareSnapshot.Source) -> [SoftwareSnapshot.Item] {
    let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
    return source.items.filter { item in
      (softwareFilter == "all" || item.status == softwareFilter)
        && (query.isEmpty || [item.title.en, item.title.zh ?? "", item.group.title.en, item.group.title.zh ?? "", item.id]
          .contains { $0.localizedStandardContains(query) })
    }
  }

  func key(_ source: SoftwareSnapshot.Source, _ item: SoftwareSnapshot.Item) -> String { "\(source.id.count):\(source.id)\(item.id)" }

  func open(_ item: SoftwareSnapshot.Item, in source: SoftwareSnapshot.Source) async {
    let key = key(source, item)
    guard source.canOpen(item), !opening.contains(key) else { return }
    opening.insert(key)
    operationMessage = nil
    defer { opening.remove(key) }
    do {
      try await client.openApplication(sourceID: source.id, softwareID: item.id)
      operationMessage = L10n.text.copy("已请求打开 \(item.title.localized(chinese: L10n.text.chinese))", "Requested to open \(item.title.en)")
    }
    catch { operationMessage = error.localizedDescription }
  }
}

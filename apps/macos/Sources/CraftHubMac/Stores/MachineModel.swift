import CraftHubMacCore
import Foundation
import Observation

/// Cached native page state for one sidecar session. A restart replaces the store and its credentials together.
@MainActor
@Observable
final class MachineModel {
  private let client: RuntimeAPIClient
  let installations: SoftwareInstallationModel
  let softwareSources: SoftwareSourcesModel
  let favorites: SoftwareFavoritesModel
  let applicationMaintenance: ApplicationMaintenanceModel
  var softwareTab = "catalog"
  private(set) var software: SoftwareSnapshot?
  private(set) var checkingSoftware = false
  private(set) var softwareError: String?
  private(set) var opening = Set<String>()
  var operationMessage: String?
  var search = ""
  var softwareFilter = "all"
  private var softwareRevision = 0
  private var loadedSoftwareRevision = -1

  init(client: RuntimeAPIClient) {
    self.client = client
    installations = SoftwareInstallationModel(client: client)
    softwareSources = SoftwareSourcesModel(client: client)
    favorites = SoftwareFavoritesModel(client: client)
    applicationMaintenance = ApplicationMaintenanceModel(client: client)
    favorites.changed = { [weak self] in
      guard let self else { return }
      softwareRevision += 1
      if !favorites.uncertain { Task { await self.favorites.load() } }
    }
    installations.detectionChanged = { [weak self] in await self?.loadSoftware(force: true) }
    softwareSources.changed = { [weak self] in await self?.loadSoftware(force: true) }
  }

  func disconnect() {
    applicationMaintenance.disconnect()
    installations.disconnect()
    softwareSources.disconnect()
    favorites.disconnect()
  }

  /// Mark observations stale; the visible page refreshes now, other pages refresh when next opened.
  func invalidate(_ changes: Set<RuntimeChange>) {
    if changes.contains(.settings) { favorites.invalidate() }
    if changes.contains(.softwareSources) || changes.contains(.configurationSync) { softwareSources.invalidate() }
    if !changes.isDisjoint(with: [
      .runs, .settings, .plugins, .userConfig, .configurationSync, .softwareSources, .pluginUpdate,
    ]) {
      softwareRevision += 1
    }
  }

  func loadSoftware(force: Bool = false) async {
    if force {
      softwareRevision += 1
      favorites.invalidate()
    }
    guard !checkingSoftware, software == nil || loadedSoftwareRevision != softwareRevision else { return }
    checkingSoftware = true
    softwareError = nil
    defer { checkingSoftware = false }
    repeat {
      let revision = softwareRevision
      let favoritesVersion = favorites.readVersion
      do {
        let result = try await client.software()
        guard !Task.isCancelled else { return }
        software = result
        if revision == softwareRevision { favorites.receiveCatalog(result, version: favoritesVersion) }
        installations.updateSources(result.sources)
        loadedSoftwareRevision = revision
        softwareError = nil
      } catch {
        if !Task.isCancelled { softwareError = error.localizedDescription }
      }
      if Task.isCancelled || revision == softwareRevision { return }
    } while true
  }

  func visibleItems(_ source: SoftwareSnapshot.Source) -> [SoftwareSnapshot.Item] {
    let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
    return source.items.filter { item in
      (softwareFilter == "all" || item.status == softwareFilter)
        && (query.isEmpty
          || [item.title.en, item.title.zh ?? "", item.group.title.en, item.group.title.zh ?? "", item.id]
            .contains { $0.localizedStandardContains(query) })
    }
  }

  func key(_ source: SoftwareSnapshot.Source, _ item: SoftwareSnapshot.Item) -> String {
    "\(source.id.count):\(source.id)\(item.id)"
  }

  func open(_ item: SoftwareSnapshot.Item, in source: SoftwareSnapshot.Source) async {
    let key = key(source, item)
    guard source.canOpen(item), !opening.contains(key) else { return }
    opening.insert(key)
    operationMessage = nil
    defer { opening.remove(key) }
    do {
      try await client.openApplication(sourceID: source.id, softwareID: item.id)
      operationMessage = L10n.text.copy(
        "已请求打开 \(item.title.localized(chinese: L10n.text.chinese))", "Requested to open \(item.title.en)")
    } catch { operationMessage = error.localizedDescription }
  }
}

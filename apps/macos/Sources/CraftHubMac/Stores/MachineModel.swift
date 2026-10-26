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
  let environmentProfile: EnvironmentProfileModel
  let environmentSources: EnvironmentSourcesModel
  let configuration: ConfigurationModel
  let favorites: SoftwareFavoritesModel
  let applicationMaintenance: ApplicationMaintenanceModel
  var softwareTab = "catalog"
  var environmentTab = "inspection"
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
  private var environmentRevision = 0
  private var softwareRevision = 0
  private var loadedEnvironmentRevision = -1
  private var loadedSoftwareRevision = -1

  init(client: RuntimeAPIClient) {
    self.client = client
    installations = SoftwareInstallationModel(client: client)
    softwareSources = SoftwareSourcesModel(client: client)
    environmentProfile = EnvironmentProfileModel(client: client)
    environmentSources = EnvironmentSourcesModel(client: client)
    configuration = ConfigurationModel(client: client)
    favorites = SoftwareFavoritesModel(client: client)
    applicationMaintenance = ApplicationMaintenanceModel(client: client)
    favorites.changed = { [weak self] in
      guard let self else { return }
      softwareRevision += 1
      if !favorites.uncertain { Task { await self.favorites.load() } }
    }
    configuration.changed = { [weak self] in self?.environmentProfile.invalidate() }
    environmentSources.connected = { [weak self] in self?.environmentProfile.invalidate() }
    installations.detectionChanged = { [weak self] in await self?.loadSoftware(force: true) }
    softwareSources.changed = { [weak self] in await self?.loadSoftware(force: true) }
  }

  func disconnect() {
    applicationMaintenance.disconnect()
    installations.disconnect()
    softwareSources.disconnect()
    environmentProfile.disconnect()
    environmentSources.disconnect()
    configuration.disconnect()
    favorites.disconnect()
  }

  /// Mark observations stale; the visible page refreshes now, other pages refresh when next opened.
  func invalidate(_ changes: Set<RuntimeChange>) {
    if changes.contains(.settings) { favorites.invalidate() }
    if !changes.isDisjoint(with: [.integrations, .plugins, .configurationSync, .userConfig]) {
      configuration.invalidate(clearApproval: !changes.isDisjoint(with: [.plugins, .configurationSync, .userConfig]))
    }
    if changes.contains(.softwareSources) || changes.contains(.configurationSync) { softwareSources.invalidate() }
    if !changes.isDisjoint(with: [
      .runs, .settings, .plugins, .userConfig, .configurationSync, .softwareSources, .pluginUpdate,
    ]) {
      environmentRevision += 1
      softwareRevision += 1
      environmentProfile.invalidate()
    }
  }

  func loadEnvironment(force: Bool = false) async {
    if force { environmentRevision += 1 }
    guard !checkingEnvironment, environment == nil || loadedEnvironmentRevision != environmentRevision else { return }
    checkingEnvironment = true
    environmentError = nil
    defer { checkingEnvironment = false }
    repeat {
      let revision = environmentRevision
      do {
        let result = try await client.environment()
        guard !Task.isCancelled else { return }
        environment = result
        loadedEnvironmentRevision = revision
        environmentError = nil
      } catch {
        if !Task.isCancelled { environmentError = error.localizedDescription }
      }
      if Task.isCancelled || revision == environmentRevision { return }
      // An event during the request requires one more snapshot; never lose it behind the loading guard.
    } while true
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

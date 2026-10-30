import CraftHubMacCore
import Foundation
import Observation

/// App-owned marketplace state. Read-only previews and explicit mutations share the runtime's lifecycle APIs.
@MainActor @Observable final class PluginsModel {
  let hostComponents = HostExtensionsModel()
  enum Tab: String, CaseIterable { case discover, installed, sources, hosts }
  struct InstallReview: Identifiable {
    let id = UUID()
    let request: PluginInstallRequest
    let plan: PluginInstallPlan
  }
  struct SourceReview: Identifiable {
    let id = UUID()
    let input: PluginSourceInput
    let preview: PluginSourcePreview
  }
  struct Detail: Identifiable {
    let source: String
    let package: String
    var version: String
    var id: String { "\(source):\(package):\(version)" }
  }
  struct ChangeReview: Identifiable {
    enum Operation {
      case removePlugin(InstalledPlugin)
      case rollbackPlugin(InstalledPlugin)
      case removeSource(PluginSource)
    }
    let id = UUID()
    let operation: Operation
  }
  var tab = Tab.discover { didSet { if oldValue != tab { cancelChange() } } }
  var query = ""
  var filter = "all"
  var kind = "all"
  var sourceName = ""
  var sourceCatalogURL = ""
  var sourceRegistry = ""
  var detail: Detail?
  var updatesPresented = false
  private(set) var snapshot: MarketplaceOverview?
  private(set) var updates: [PluginUpdate] = []
  private(set) var updateResult: PluginUpdateResult?
  private(set) var updatesError: String?
  private(set) var updatesChecked = false
  private(set) var updatesLoading = false
  private(set) var error: String?
  private(set) var message: String?
  private(set) var loading = false
  private(set) var busy = false
  private(set) var installReview: InstallReview?
  private(set) var sourceReview: SourceReview?
  private(set) var changeReview: ChangeReview?
  private(set) var document: PluginDocument?
  private(set) var documentError: String?
  private(set) var documentLoading = false
  @ObservationIgnored private var client: RuntimeAPIClient?
  var iconClient: RuntimeAPIClient? { client }
  var iconRevision: Int { loadedRevision }
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var previewGeneration = UUID()
  @ObservationIgnored private var documentGeneration = UUID()
  @ObservationIgnored private var navigationGeneration = UUID()
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private var loadedRevision = -1
  @ObservationIgnored private var updatesRevision = -1
  @ObservationIgnored private var loadTask: Task<Void, Never>?

  var stale: Bool { snapshot != nil && loadedRevision != revision }
  var searchTerm: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
  var sources: [PluginSource] {
    (snapshot?.sources ?? []).filter { source in
      searchTerm.isEmpty
        || [source.id, source.name, source.catalogUrl ?? ""].contains { $0.localizedStandardContains(searchTerm) }
    }
  }
  var catalog: [CatalogPlugin] {
    let term = searchTerm
    return (snapshot?.catalog ?? []).filter { item in
      item.preferred && (term.isEmpty && kind == "all" ? !item.included : matches(item.package, item.metadata, term))
        && (kind == "all"
          || (kind == "pack" ? !item.metadata.includesPlugins.isEmpty : item.metadata.includesPlugins.isEmpty))
        && (filter == "all"
          || (filter == "updates"
            ? item.action == "update" : snapshot?.installed.contains { $0.package == item.package } == true))
    }
  }
  var installed: [InstalledPlugin] {
    (snapshot?.installed ?? []).filter { matches($0.package, $0.manifest, searchTerm) }
  }
  var updatesStale: Bool { updatesChecked && updatesRevision != revision }
  var canApplyUpdates: Bool {
    updatesChecked && !updatesStale && updatesError == nil && !busy && updates.contains { $0.automatic }
  }
  var sourceInput: PluginSourceInput {
    .init(
      name: sourceName.trimmingCharacters(in: .whitespacesAndNewlines),
      catalogUrl: sourceCatalogURL.trimmingCharacters(in: .whitespacesAndNewlines),
      registry: sourceRegistry.isEmpty ? nil : sourceRegistry.trimmingCharacters(in: .whitespacesAndNewlines))
  }
  /// Navigation only: loading the remote catalog still requires the explicit Preview Source action.
  func prepareSourceImport(_ catalogURL: String) {
    cancelPreview()
    detail = nil
    query = ""
    tab = .sources
    sourceName = ""
    sourceCatalogURL = catalogURL
    sourceRegistry = ""
    error = nil
    message = L10n.text.copy("请预览并核对来源，再确认添加。", "Preview and review this source before adding it.")
  }
  private func matches(_ package: String, _ metadata: PluginMetadata, _ term: String) -> Bool {
    term.isEmpty
      || ([package, metadata.displayName, metadata.description ?? ""]
        + (metadata.localizations ?? [:]).values.flatMap { [$0.displayName ?? "", $0.description ?? ""] }).contains {
          $0.localizedStandardContains(term)
        }
  }
  func connect(_ client: RuntimeAPIClient?) {
    hostComponents.connect(client)
    generation = UUID()
    cancelPreview()
    cancelChange()
    documentGeneration = UUID()
    navigationGeneration = UUID()
    loadTask?.cancel()
    loadTask = nil
    self.client = client
    detail = nil
    snapshot = nil
    updates = []
    updatesPresented = false
    updatesChecked = false
    updatesLoading = false
    updatesError = nil
    error = nil
    message = nil
    updateResult = nil
    loading = false
    busy = false
    document = nil
    documentError = nil
    documentLoading = false
    revision += 1
    loadedRevision = -1
  }
  func invalidate(_ changes: Set<RuntimeChange>) {
    if !changes.isDisjoint(with: [.plugins, .pluginUpdate, .configurationSync, .userConfig]) {
      revision += 1
      if changeReview != nil {
        message = L10n.text.copy("插件目录已变化，请重新审阅操作。", "The plugin catalog changed. Review the action again.")
        cancelChange()
      }
    }
  }
  func load(force: Bool = false) async {
    if force {
      revision += 1
      cancelChange()
    }
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
        let version = revision
        do {
          let result = try await client.marketplace()
          guard generation == attempt, !Task.isCancelled else { return }
          snapshot = result
          loadedRevision = version
          error = nil
        } catch {
          if generation == attempt { self.error = error.localizedDescription }
          return
        }
      } while loadedRevision != revision && !Task.isCancelled
    }
    await loadTask?.value
  }
  func cancelPreview() {
    previewGeneration = UUID()
    installReview = nil
    sourceReview = nil
  }
  func catalogDetail(_ plugin: CatalogPlugin) -> Detail {
    if let active = localOverride(plugin) {
      return .init(source: active.sourceId, package: active.package, version: active.version)
    }
    return .init(source: plugin.sourceId, package: plugin.package, version: plugin.version)
  }
  func canPerformCatalogAction(_ plugin: CatalogPlugin) -> Bool {
    guard !busy else { return false }
    if plugin.action == "local" { return localOverride(plugin) != nil }
    return !["installed", "newer"].contains(plugin.action) && plugin.status != "blocked"
  }
  func performCatalogAction(_ plugin: CatalogPlugin) async {
    guard canPerformCatalogAction(plugin) else { return }
    if plugin.action == "local" {
      detail = catalogDetail(plugin)
    } else {
      await preview(plugin)
    }
  }
  private func localOverride(_ plugin: CatalogPlugin) -> InstalledPlugin? {
    guard plugin.action == "local" else { return nil }
    return snapshot?.installed.first { $0.package == plugin.package && $0.local }
  }
  func preview(_ plugin: CatalogPlugin) async {
    guard let client, !busy, plugin.status != "blocked", plugin.action != "local" else { return }
    cancelPreview()
    let attempt = generation
    let preview = previewGeneration
    busy = true
    error = nil
    message = nil
    defer { if generation == attempt { busy = false } }
    do {
      let input = PluginInstallRequest(sourceId: plugin.sourceId, package: plugin.package, version: plugin.version)
      let plan = try await client.previewPlugin(input)
      guard attempt == generation, preview == previewGeneration else { return }
      installReview = InstallReview(request: input, plan: plan)
    } catch { if attempt == generation, preview == previewGeneration { self.error = error.localizedDescription } }
  }
  func confirmInstall() async {
    guard let client, let review = installReview, !busy else { return }
    let attempt = generation
    let preview = previewGeneration
    busy = true
    error = nil
    defer { if attempt == generation { busy = false } }
    do {
      // A new catalog or local override must not silently change the dependency/permission review.
      let latest = try await client.previewPlugin(review.request)
      guard attempt == generation, preview == previewGeneration else { return }
      guard latest == review.plan else {
        installReview = InstallReview(request: review.request, plan: latest)
        message = L10n.text.copy(
          "安装计划已变化，请重新确认版本和权限。", "The install plan changed. Review the versions and permissions again.")
        return
      }
      _ = try await client.installPlugin(review.request, reviewedPlan: review.plan)
      guard attempt == generation else { return }
      cancelPreview()
      await load(force: true)
      message = L10n.text.copy("插件已安装。", "Plugin installed.")
    } catch { if attempt == generation { self.error = error.localizedDescription } }
  }
  func previewSource(_ input: PluginSourceInput) async {
    guard let client, !busy else { return }
    cancelPreview()
    let attempt = generation
    let preview = previewGeneration
    busy = true
    error = nil
    message = nil
    defer { if generation == attempt { busy = false } }
    do {
      let result = try await client.previewPluginSource(input)
      guard attempt == generation, preview == previewGeneration else { return }
      sourceReview = SourceReview(
        input: PluginSourceInput(name: result.name, catalogUrl: result.catalogUrl, registry: result.registry),
        preview: result)
    } catch { if attempt == generation, preview == previewGeneration { self.error = error.localizedDescription } }
  }
  func confirmSource() async {
    guard let review = sourceReview else { return }
    await mutate { client in
      _ = try await client.addPluginSource(review.input)
    }
    if error == nil { cancelPreview() }
  }
  func enable(_ plugin: InstalledPlugin) async {
    await mutate { _ = try await $0.setPluginEnabled(plugin.package, enabled: !plugin.enabled) }
  }
  func reviewRemoval(_ package: String) {
    guard client != nil, !busy, !stale, let plugin = snapshot?.installed.first(where: { $0.package == package }) else {
      return
    }
    changeReview = ChangeReview(operation: .removePlugin(plugin))
  }
  func reviewRollback(_ package: String) {
    guard client != nil, !busy, !stale, let plugin = snapshot?.installed.first(where: { $0.package == package }),
      !plugin.local, plugin.previousVersion != nil
    else { return }
    changeReview = ChangeReview(operation: .rollbackPlugin(plugin))
  }
  func reviewSourceRemoval(_ id: String) {
    guard client != nil, !busy, !stale, let source = snapshot?.sources.first(where: { $0.id == id }),
      source.kind == "user"
    else { return }
    changeReview = ChangeReview(operation: .removeSource(source))
  }
  func cancelChange() { changeReview = nil }

  /// Consume synchronously in the button action, before SwiftUI dismisses the confirmation dialog.
  /// The queued mutation must still belong to the same runtime connection when it starts.
  @discardableResult func confirmChange(_ review: ChangeReview) -> Task<Void, Never>? {
    guard changeReview?.id == review.id, !busy, !stale else { return nil }
    changeReview = nil
    let attempt = generation
    let version = revision
    return Task {
      guard version == revision else { return }
      await mutate(generation: attempt) { client in
        switch review.operation {
        case .removePlugin(let plugin): try await client.removePlugin(plugin.package, local: plugin.local)
        case .rollbackPlugin(let plugin): _ = try await client.rollbackPlugin(plugin.package)
        case .removeSource(let source): try await client.removePluginSource(source.id)
        }
      }
    }
  }
  func link(_ path: String) async { await mutate { _ = try await $0.linkPlugin(path) } }
  func refreshLocal(_ plugin: InstalledPlugin) async {
    await mutate { _ = try await $0.refreshLocalPlugin(plugin.package) }
  }
  func refreshSource(_ source: PluginSource) async { await mutate { _ = try await $0.refreshPluginSource(source.id) } }
  private func mutate(generation expected: UUID? = nil, _ action: (RuntimeAPIClient) async throws -> Void) async {
    guard let client, !busy, expected == nil || expected == generation else { return }
    let attempt = generation
    busy = true
    error = nil
    message = nil
    defer { if generation == attempt { busy = false } }
    do {
      try await action(client)
      guard generation == attempt else { return }
      await load(force: true)
    } catch {
      if generation == attempt {
        self.error = error.localizedDescription
        // A missing acknowledgement may hide a completed write. Read current state before reviewing another change.
        revision += 1
        cancelChange()
      }
    }
  }
  func checkUpdates() async {
    guard let client, !busy else { return }
    let attempt = generation
    let version = revision
    updatesPresented = true
    updates = []
    updatesChecked = false
    updatesLoading = true
    updatesError = nil
    busy = true
    updateResult = nil
    defer {
      if attempt == generation {
        busy = false
        updatesLoading = false
      }
    }
    do {
      let plans = try await client.pluginUpdates()
      guard attempt == generation else { return }
      updates = plans
      updatesChecked = true
      updatesRevision = version
    } catch { if attempt == generation { updatesError = error.localizedDescription } }
  }
  func updateAll() async {
    guard let client, canApplyUpdates else { return }
    let attempt = generation
    busy = true
    updatesError = nil
    // Applying changes consumes this check. A retry requires a fresh check of the runtime state.
    updatesChecked = false
    defer { if attempt == generation { busy = false } }
    do {
      let result = try await client.updatePlugins()
      guard attempt == generation else { return }
      updateResult = result
      updates = result.skipped + result.failures
      await load(force: true)
    } catch { if attempt == generation { updatesError = error.localizedDescription } }
  }
  func loadDocument(_ detail: Detail) async {
    guard let client else { return }
    documentGeneration = UUID()
    let attempt = generation
    let request = documentGeneration
    document = nil
    documentError = nil
    documentLoading = true
    defer { if attempt == generation, request == documentGeneration { documentLoading = false } }
    do {
      let result = try await client.pluginDocument(
        source: detail.source, package: detail.package, version: detail.version)
      guard attempt == generation, request == documentGeneration, !Task.isCancelled else { return }
      document = result
    } catch {
      if attempt == generation, request == documentGeneration, !Task.isCancelled {
        documentError = error.localizedDescription
      }
    }
  }
  func cancelNavigation() { navigationGeneration = UUID() }
  func show(package: String?, source: String?, isCurrent: () -> Bool = { true }) async {
    let attempt = generation
    let navigation = UUID()
    navigationGeneration = navigation
    await load()
    guard attempt == generation, navigation == navigationGeneration, !Task.isCancelled, isCurrent() else { return }
    detail = nil
    query = ""
    filter = "all"
    if let package {
      if let item = snapshot?.installed.first(where: {
        $0.package == package && (source == nil || $0.sourceId == source)
      }) {
        tab = .installed
        detail = Detail(source: item.sourceId, package: package, version: item.version)
      } else if let item = snapshot?.catalog.first(where: {
        $0.package == package && $0.preferred && (source == nil || $0.sourceId == source)
      }) {
        tab = .discover
        detail = catalogDetail(item)
      } else {
        tab = .discover
        query = package
        message = L10n.text.copy(
          "当前来源中找不到此插件，请检查来源或刷新目录。",
          "This plugin is unavailable in the current sources. Review the sources or refresh the catalog.")
      }
    } else if let source {
      tab = .sources
      query = source
    }
  }
}

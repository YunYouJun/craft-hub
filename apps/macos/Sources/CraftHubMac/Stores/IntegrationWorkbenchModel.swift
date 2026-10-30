import CraftHubMacCore
import Foundation
import Observation

@MainActor @Observable final class IntegrationBlockState {
  struct ResourceLocation: Equatable {
    let input: [String: IntegrationValue]
    let project: String?
  }
  var page: IntegrationPresentation.Page? {
    didSet { rebuildDescriptionPreviews(reusing: page?.currentUser?.id == oldValue?.currentUser?.id) }
  }
  private struct DescriptionPreview {
    let source: String
    let text: String?
  }
  @ObservationIgnored private var descriptionPreviews: [String: DescriptionPreview] = [:]
  @ObservationIgnored private let renderDescription: (String) -> String

  init(renderDescription: @escaping (String) -> String = WorkItemText.plainDescription) {
    self.renderDescription = renderDescription
  }

  /// Convert only changed descriptions when data arrives; scrolling reads a bounded, inert preview.
  func descriptionPreview(for item: IntegrationPresentation.Entity) -> String? {
    guard let cached = descriptionPreviews[item.key], cached.source == item.description else { return nil }
    return cached.text
  }

  private func rebuildDescriptionPreviews(reusing: Bool) {
    var next: [String: DescriptionPreview] = [:]
    for item in page?.items ?? [] {
      guard let source = item.description else { continue }
      if reusing, let cached = descriptionPreviews[item.key], cached.source == source {
        next[item.key] = cached
      } else {
        // List rows need a short preview. Keep the complete source on the entity for search and details.
        let plain = renderDescription(String(source.prefix(32_768)))
        let preview = plain.count > 512 ? String(plain.prefix(511)) + "…" : plain
        next[item.key] = DescriptionPreview(source: source, text: preview.isEmpty ? nil : preview)
      }
    }
    descriptionPreviews = next
  }
  var resourcePage: IntegrationResourcePage?
  var resourceLocation: ResourceLocation?
  var resourceHistory: [ResourceLocation] = []
  var connection: IntegrationPresentation.Connection?
  var loading = false
  var stale = true
  var error: String?
  var query = ""
  var searchesSource = false
  var remoteKeyword: String?
  var activeOnly = false
  var personalOnly = false
  var seenCursors = Set<String>()
  var unsupported = false
  var stamp = UUID()
  var visibleItems: [IntegrationPresentation.Entity] {
    (page?.items ?? []).filter {
      (!activeOnly || $0.active) && (!personalOnly || $0.personal)
        && (searchesSource || query.isEmpty
          || [$0.title, $0.description ?? "", $0.statusLabel ?? $0.status ?? ""]
            .contains { $0.localizedStandardContains(query) })
    }
  }
}

/// Declarative views use existing action endpoints. Trusted providers own configuration changes and account scopes.
@MainActor @Observable final class IntegrationWorkbenchModel {
  let connections = IntegrationConnectionModel()
  let forms = IntegrationFormModel()
  struct Entry: Identifiable {
    let contribution: NativeIntegrationCatalog.Contribution
    let view: NativeIntegrationCatalog.View
    var id: String { "\(contribution.id)/\(view.id)" }
    var path: String { "/integrations/\(id)" }
    @MainActor func text(_ value: String) -> String {
      contribution.translations?[L10n.text.chinese ? "zh-CN" : "en"]?[value] ?? value
    }
    func action(_ block: NativeIntegrationCatalog.Block) -> NativeIntegrationCatalog.Action? {
      contribution.actions.first { $0.id == block.actionId }
    }
  }
  struct Review: Identifiable {
    let id = UUID()
    let context: UUID
    let blockID: String
    let item: IntegrationPresentation.Entity
    let enabled: Bool?
    let actionID: String
    let project: String?
  }
  private(set) var entries: [Entry] = []
  private(set) var diagnostics: [NativeIntegrationCatalog.Diagnostic] = []
  private(set) var entryID = ""
  private(set) var projectID = ""
  private(set) var states: [String: IntegrationBlockState] = [:]
  private(set) var loadingCatalog = false
  private(set) var refreshing = false
  private var configurationBusy = false
  var busy: Bool { configurationBusy || connections.busy || forms.executing }
  private(set) var uncertain: String?
  private(set) var review: Review?
  private(set) var error: String?
  private(set) var notice: String?
  var search = ""
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var session = UUID()
  @ObservationIgnored private var context = UUID()
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private var catalogLoaded = false
  @ObservationIgnored private var catalogRead: Task<Bool, Never>?
  @ObservationIgnored private var catalogRequest: UUID?
  @ObservationIgnored private var refreshRequested = false
  var entry: Entry? { entries.first { $0.id == entryID } }
  var project: String? { entry?.view.scope == "global" || projectID.isEmpty ? nil : projectID }
  var requiresProject: Bool { entry?.view.scope == "project" && project == nil }
  var canChangeContext: Bool { !busy && uncertain == nil && !connections.uncertain && !forms.uncertain }
  var visibleEntries: [Entry] {
    entries.filter { search.isEmpty || $0.text($0.view.title).localizedStandardContains(search) }
  }
  func connect(_ client: RuntimeAPIClient?) {
    catalogRead?.cancel()
    catalogRead = nil
    catalogRequest = nil
    connections.reset()
    forms.reset()
    session = UUID()
    context = UUID()
    self.client = client
    entries = []
    states = [:]
    entryID = ""
    projectID = ""
    catalogLoaded = false
    loadingCatalog = false
    refreshing = false
    refreshRequested = false
    configurationBusy = false
    uncertain = nil
    review = nil
    error = nil
    notice = nil
  }
  @discardableResult func invalidate(_ changes: Set<RuntimeChange>) -> Bool {
    guard
      !changes.isDisjoint(with: [
        .plugins, .integrations, .settings, .userConfig, .projectCatalog, .projects,
      ])
    else { return false }
    revision += 1
    connections.invalidate(hard: !changes.isDisjoint(with: [.plugins, .userConfig]))
    forms.invalidate()
    review = nil
    for state in states.values { state.stale = true }
    if !changes.isDisjoint(with: [.plugins, .userConfig]) { catalogLoaded = false }
    return true
  }
  /// Concurrent navigation waits for the same catalog; unavailable or discarded reads never confirm absence.
  @discardableResult func loadCatalog(force: Bool = false) async -> Bool {
    guard !Task.isCancelled else { return false }
    let token = session
    if let catalogRead {
      let loaded = await catalogRead.value
      return loaded && token == session && catalogLoaded && !Task.isCancelled
    }
    guard let client, !busy else { return false }
    if !force && catalogLoaded { return true }
    revision += 1
    review = nil
    for state in states.values { state.stale = true }
    let epoch = revision
    let request = UUID()
    catalogRequest = request
    catalogLoaded = false
    loadingCatalog = true
    let read = Task { [weak self] in
      guard let self else { return false }
      return await self.readCatalog(client, token: token, epoch: epoch, request: request)
    }
    catalogRead = read
    let loaded = await read.value
    return loaded && token == session && catalogLoaded && !Task.isCancelled
  }

  private func readCatalog(_ client: RuntimeAPIClient, token: UUID, epoch: Int, request: UUID) async -> Bool {
    defer {
      if catalogRequest == request {
        catalogRead = nil
        catalogRequest = nil
        loadingCatalog = false
      }
    }
    do {
      let result = try await client.nativeIntegrations()
      guard token == session, epoch == revision, !Task.isCancelled else { return false }
      entries = result.integrations.flatMap { contribution in
        contribution.views.map { Entry(contribution: contribution, view: $0) }
      }.sorted { ($0.view.order ?? 0, $0.id) < ($1.view.order ?? 0, $1.id) }
      diagnostics = result.diagnostics
      catalogLoaded = true
      error = nil
      if uncertain == nil { states = [:] }
      if !entries.contains(where: { $0.id == entryID }), uncertain == nil {
        entryID = ""
        states = [:]
        review = nil
        context = UUID()
        refreshing = false
        refreshRequested = false
      }
      for block in entry?.view.blocks ?? [] { _ = state(block) }
      return true
    } catch {
      if token == session, epoch == revision, !Task.isCancelled { self.error = error.localizedDescription }
      return false
    }
  }
  func select(_ id: String, project: String = "") async {
    guard let selected = entries.first(where: { $0.id == id }) else { return }
    let selectedProject = selected.view.scope == "global" ? "" : project
    // Reopening the current source preserves its snapshot, filters and any pending write receipt.
    if entryID == id, projectID == selectedProject {
      search = ""
      return
    }
    guard canChangeContext else { return }
    context = UUID()
    connections.reset()
    forms.reset()
    entryID = id
    projectID = selectedProject
    search = ""
    states = [:]
    review = nil
    error = nil
    notice = nil
    refreshing = false
    refreshRequested = false
    for block in entry?.view.blocks ?? [] { _ = state(block) }
    await refresh()
  }
  func state(_ block: NativeIntegrationCatalog.Block) -> IntegrationBlockState {
    if let state = states[block.id] { return state }
    let state = IntegrationBlockState()
    state.activeOnly = block.statusFilter == "active"
    state.personalOnly = block.assigneeFilter == "current-user"
    state.searchesSource = block.type == "entity-search"
    states[block.id] = state
    return state
  }
  func readable(_ block: NativeIntegrationCatalog.Block) -> Bool {
    guard let action = entry?.action(block), !requiresProject, block.requiresProject != true || project != nil else {
      return false
    }
    return ["connection-status", "entity-list", "entity-search", "resource-browser"].contains(block.type)
      && (block.type != "resource-browser" || action.operation == "resources.read")
      && ["local-read", "remote-read"].contains(action.effect) && action.effectiveConfirmation == "never"
  }
  func refreshIfIdle() async {
    guard !busy, uncertain == nil, review == nil, !connections.isPresented, !forms.isPresented else {
      return
    }
    if refreshing {
      // Multiple invalidations during one read need one follow-up, after the old responses are discarded.
      refreshRequested = true
      return
    }
    guard await loadCatalog(), let entry else { return }
    guard
      entry.view.blocks.contains(where: {
        ["connection-status", "entity-list", "resource-browser"].contains($0.type) && readable($0)
          && states[$0.id]?.stale != false
      })
    else { return }
    await refresh()
  }
  func canManageConnection(_ block: NativeIntegrationCatalog.Block) -> Bool {
    readable(block) && entry?.action(block)?.operation == "connection.status"
      && entry?.contribution.actions.contains { $0.operation == "connection.update" && $0.effect == "local-write" }
        == true
  }
  func openForm(_ block: NativeIntegrationCatalog.Block, resource: IntegrationResourcePage.Form? = nil) async {
    guard let client, let entry, canChangeContext else { return }
    let state = state(block)
    if resource != nil && (state.stale || state.loading || state.resourcePage == nil) { return }
    let selectedProject = resource == nil ? project : state.resourceLocation?.project
    let selector = IntegrationFormSelector(
      viewId: entry.view.id, blockId: block.id,
      resourceInput: resource == nil ? nil : state.resourceLocation?.input, formId: resource?.id)
    let token = context
    await forms.open(client: client, integration: entry.contribution.id, project: selectedProject, selector: selector)
    guard token == context else { return }
    forms.completed = { [weak self] result in
      guard let self, self.context == token else { return }
      if let page = result.resources, resource != nil {
        state.resourcePage = page
        state.resourceLocation = .init(input: page.input, project: selectedProject)
      }
      state.stale = true
    }
  }
  func manageConnection(_ block: NativeIntegrationCatalog.Block) async {
    guard let client, let entry, canChangeContext, canManageConnection(block) else { return }
    review = nil
    await connections.open(client: client, entry: entry, block: block, project: project)
  }
  func refresh() async {
    guard !busy, !refreshing, entry != nil, entry?.view.rendering != "web", !requiresProject else { return }
    let token = context
    refreshing = true
    review = nil
    for state in states.values { state.stale = true }
    defer {
      if token == context {
        refreshing = false
        if refreshRequested {
          refreshRequested = false
          Task { await self.refreshIfIdle() }
        }
      }
    }
    await loadCatalog()
    guard token == context, catalogLoaded, let entry = self.entry else { return }
    let epoch = revision
    // Establish account identity before reading independent list and resource blocks concurrently.
    for block in entry.view.blocks where block.type == "connection-status" {
      await read(block)
      guard token == context, epoch == revision, !Task.isCancelled else { return }
    }
    let blocks = entry.view.blocks.filter { ["entity-list", "resource-browser"].contains($0.type) && readable($0) }
    await withTaskGroup(of: Void.self) { group in
      var next = blocks.makeIterator()
      for _ in 0..<4 {
        guard let block = next.next() else { break }
        group.addTask { await self.readDuringRefresh(block, token: token, epoch: epoch) }
      }
      for await _ in group {
        guard token == context, epoch == revision, !Task.isCancelled else {
          group.cancelAll()
          return
        }
        if let block = next.next() {
          group.addTask { await self.readDuringRefresh(block, token: token, epoch: epoch) }
        }
      }
    }
  }
  private func readDuringRefresh(_ block: NativeIntegrationCatalog.Block, token: UUID, epoch: Int) async {
    guard token == context, epoch == revision, !Task.isCancelled else { return }
    await read(block)
  }
  private func connectionIdentity() -> String? {
    entry?.view.blocks.compactMap { states[$0.id]?.connection?.session?.cacheKey }.first
  }
  func read(_ block: NativeIntegrationCatalog.Block, append: Bool = false, keyword: String? = nil) async {
    if block.type == "resource-browser" {
      await readResource(block)
      return
    }
    guard let client, let entry, !busy, catalogLoaded, readable(block) else { return }
    let state = state(block)
    guard !state.loading else { return }
    let token = context
    // Recheck account identity before requesting a subsequent page. Old cursors never cross a detected account switch.
    if append {
      let identity = connectionIdentity()
      for connection in entry.view.blocks where connection.type == "connection-status" {
        await read(connection)
        guard token == context, states[connection.id]?.stale == false else { return }
      }
      if identity != connectionIdentity() {
        await read(block)
        return
      }
    }
    let disconnected = entry.view.blocks.contains {
      $0.type == "connection-status" && states[$0.id]?.connection?.connected == false
        && states[$0.id]?.connection?.session?.cacheReads != true
    }
    if disconnected && entry.action(block)?.operation.hasPrefix("work-items.") == true {
      state.page = nil
      state.stale = true
      state.error = L10n.text.copy("请先连接账号。", "Connect an account first.")
      return
    }
    let cursor = append ? state.page?.nextCursor : nil
    if append && (cursor == nil || state.stale) { return }
    let epoch = revision
    let stamp = UUID()
    state.stamp = stamp
    state.loading = true
    state.error = nil
    if !append { state.seenCursors = [] }
    func current() -> Bool { token == context && epoch == revision && state.stamp == stamp && !Task.isCancelled }
    defer { if token == context && state.stamp == stamp { state.loading = false } }
    var input = block.input ?? [:]
    input["locale"] = .string(L10n.text.chinese ? "zh-CN" : "en")
    if let cursor { input["cursor"] = .string(cursor) }
    if let keyword, state.remoteKeyword != keyword {
      state.remoteKeyword = keyword
      state.page = nil
    }
    if let keyword = state.remoteKeyword { input["keyword"] = .string(keyword) }
    do {
      if state.page == nil, let preview = block.previewInput {
        if let result = try? await client.integrationPresentation(
          integration: entry.contribution.id, action: block.actionId, project: project,
          input: input.merging(preview) { _, next in next }), current()
        {
          state.page = result.page
          state.stale = true
        }
      }
      guard current() else { return }
      let result = try await client.integrationPresentation(
        integration: entry.contribution.id, action: block.actionId, project: project, input: input)
      guard current() else { return }
      if result.kind == "connection", let connection = result.connection {
        if state.connection?.session?.cacheKey != connection.session?.cacheKey
          || (!connection.connected && connection.session?.cacheReads != true)
        {
          review = nil
          for other in states.values where other !== state {
            other.stamp = UUID()
            other.loading = false
            other.page = nil
            other.resourcePage = nil
            other.resourceLocation = nil
            other.resourceHistory = []
            other.seenCursors = []
            other.stale = true
            other.query = ""
            other.remoteKeyword = nil
          }
        }
        state.connection = connection
      } else if ["entities", "entity"].contains(result.kind), var page = result.entityPage {
        if append, let previous = state.page, previous.currentUser?.id == page.currentUser?.id {
          var items = previous.items
          for item in page.items {
            if let index = items.firstIndex(where: { $0.key == item.key }) {
              items[index] = item
            } else {
              items.append(item)
            }
          }
          page.items = items
          if let cursor { state.seenCursors.insert(cursor) }
        } else {
          state.seenCursors = []
        }
        if let next = page.nextCursor, state.seenCursors.contains(next) {
          page.nextCursor = nil
          page.coverage = "partial"
          state.error = L10n.text.copy("来源重复返回分页游标，请重新读取。", "The source repeated a cursor. Refresh to continue.")
        }
        state.page = page
        if uncertain == block.id && page.cache == nil {
          uncertain = nil
          notice = L10n.text.copy("已重新读取当前配置，请核对后再操作。", "Current configuration reloaded. Review before continuing.")
        }
      } else {
        state.unsupported = true
        state.stale = true
        return
      }
      state.unsupported = false
      state.stale = false
    } catch {
      if current() {
        state.stale = true
        state.error = error.localizedDescription
      }
    }
  }
  /// Resource navigation invokes only the declaration's reviewed read action, retaining the selected project per page.
  func readResource(
    _ block: NativeIntegrationCatalog.Block, link: IntegrationResourcePage.Link? = nil,
    home: Bool = false, back: Bool = false
  ) async {
    guard let client, let entry, let action = entry.action(block), !busy, catalogLoaded,
      block.type == "resource-browser", readable(block)
    else { return }
    let state = state(block)
    guard !state.loading, (!back && link == nil) || !state.stale else { return }
    let root = IntegrationBlockState.ResourceLocation(input: block.input ?? [:], project: project)
    let target: IntegrationBlockState.ResourceLocation
    if back {
      guard let previous = state.resourceHistory.last else { return }
      target = previous
    } else if let link {
      guard
        state.resourcePage?.links?.contains(where: {
          $0.title == link.title && $0.input == link.input && $0.projectId == link.projectId
        }) == true
      else { return }
      target = .init(input: link.input, project: link.projectId ?? state.resourceLocation?.project ?? project)
    } else {
      target = home ? root : state.resourceLocation ?? root
    }
    let token = context
    let epoch = revision
    let stamp = UUID()
    state.stamp = stamp
    state.loading = true
    state.error = nil
    defer { if token == context && state.stamp == stamp { state.loading = false } }
    do {
      let result = try await client.integrationPresentation(
        integration: entry.contribution.id, action: action.id, project: target.project,
        input: target.input.merging(["locale": .string(L10n.text.chinese ? "zh-CN" : "en")]) { _, next in next },
        reviewedAction: ["operation": "resources.read", "effect": action.effect])
      guard token == context, epoch == revision, state.stamp == stamp, !Task.isCancelled else { return }
      guard result.kind == "resources", let page = result.resources else {
        state.unsupported = true
        state.stale = true
        return
      }
      let accepted = IntegrationBlockState.ResourceLocation(input: page.input, project: target.project)
      if back {
        state.resourceHistory.removeLast()
      } else if let previous = state.resourceLocation, previous != accepted {
        state.resourceHistory.append(previous)
        state.resourceHistory = Array(state.resourceHistory.suffix(50))
      }
      state.resourcePage = page
      state.resourceLocation = accepted
      state.unsupported = page.collection != nil
      state.stale = false
    } catch {
      if token == context, epoch == revision, state.stamp == stamp {
        state.stale = true
        state.error = error.localizedDescription
      }
    }
  }
  func canToggle(_ block: NativeIntegrationCatalog.Block, _ item: IntegrationPresentation.Entity) -> Bool {
    guard let entry, let toggle = item.configurationToggle, let state = states[block.id] else { return false }
    return !busy && !refreshing && uncertain == nil && catalogLoaded && !state.loading && !state.stale
      && state.page?.cache == nil
      && entry.action(block)?.operation == "configuration.list"
      && entry.contribution.actions.contains { $0.operation == "configuration.update" && $0.effect == "local-write" }
      && toggle.scope == (project == nil ? "global" : "project")
      && state.page?.items.contains { $0.key == item.key && $0.configurationToggle?.revision == toggle.revision }
        == true
  }
  func prepareToggle(_ block: NativeIntegrationCatalog.Block, item: IntegrationPresentation.Entity, enabled: Bool?) {
    guard canToggle(block, item), enabled != nil || project != nil,
      let action = entry?.contribution.actions.first(where: {
        $0.operation == "configuration.update" && $0.effect == "local-write"
      })
    else { return }
    review = Review(
      context: context, blockID: block.id, item: item, enabled: enabled, actionID: action.id, project: project)
  }
  func cancelReview() { review = nil }
  func confirm(_ pending: Review) async {
    guard let client, let entry, review?.id == pending.id, context == pending.context,
      let block = entry.view.blocks.first(where: { $0.id == pending.blockID }), canToggle(block, pending.item),
      let toggle = pending.item.configurationToggle
    else { return }
    let token = context
    let writeEpoch = revision
    review = nil
    configurationBusy = true
    error = nil
    notice = nil
    for state in states.values {
      state.stamp = UUID()
      state.stale = true
      state.loading = false
    }
    defer { if token == context { configurationBusy = false } }
    do {
      let result = try await client.integrationPresentation(
        integration: entry.contribution.id, action: pending.actionID, project: pending.project,
        input: [
          "id": .string(pending.item.id), "revision": .string(toggle.revision),
          "enabled": pending.enabled.map(IntegrationValue.bool) ?? .null,
          "locale": .string(L10n.text.chinese ? "zh-CN" : "en"),
        ], confirmed: true,
        reviewedAction: ["operation": "configuration.update", "effect": "local-write"])
      guard token == context else { return }
      guard result.kind == "entities", let page = result.page, page.cache == nil else {
        throw RuntimeAPIError.invalidResponse
      }
      let state = state(block)
      state.page = page
      state.stale = writeEpoch != revision
      state.seenCursors = []
      notice = L10n.text.copy("配置已保存。现有任务可能需要重新打开。", "Configuration saved. Existing tasks may need to be reopened.")
    } catch {
      if token == context {
        uncertain = block.id
        self.error = error.localizedDescription
      }
    }
  }
}

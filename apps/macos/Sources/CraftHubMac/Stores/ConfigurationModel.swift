import CraftHubMacCore
import Foundation
import Observation

/// Native presentation of declared configuration blocks. Runtime/provider plans own revisions, file writes and backups.
@MainActor @Observable final class ConfigurationModel {
  struct Entry: Identifiable {
    let contribution: NativeIntegrationCatalog.Contribution
    let view: NativeIntegrationCatalog.View
    let block: NativeIntegrationCatalog.Block
    let read: NativeIntegrationCatalog.Action
    var id: String { "\(contribution.id)/\(view.id)/\(block.id)" }
    var update: NativeIntegrationCatalog.Action? {
      contribution.actions.first { $0.operation == "configuration.update" }
    }
    var execute: NativeIntegrationCatalog.Action? {
      contribution.actions.first { $0.operation == "configuration.execute" }
    }
    var path: String { "/integrations/\(contribution.id)/\(view.id)" }
    @MainActor func text(_ value: String) -> String {
      contribution.translations?[L10n.text.chinese ? "zh-CN" : "en"]?[value] ?? value
    }
  }
  struct Uncertain {
    let operation: String
    let planID: String?
  }
  struct RegistryReview: Identifiable {
    let id = UUID()
    let entryID: String
    let mutation: ConfigurationRegistryMutation
    let draftID: UUID?
  }
  private(set) var registryDraft: ConfigurationRegistryDraft?
  private(set) var registryReview: RegistryReview?
  private(set) var entries: [Entry] = []
  private(set) var catalogDiagnostics: [NativeIntegrationCatalog.Diagnostic] = []
  private(set) var entryID = ""
  private(set) var page: ConfigurationPage?
  private(set) var plan: ConfigurationPage.Preview?
  private(set) var planPurpose = "configuration"
  private(set) var choices: [String: ConfigurationDecision] = [:]
  private(set) var loading = false
  private(set) var busy = false
  private(set) var stale = true
  private(set) var uncertain: Uncertain?
  private(set) var error: String?
  private(set) var notice: String?
  var selected: String?
  var search = ""
  var section = "configuration"
  var status = "all"
  var kind = "all"
  @ObservationIgnored var changed: (() -> Void)?
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var reviewGeneration = UUID()
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private var catalogLoaded = false
  init(client: RuntimeAPIClient) { self.client = client }
  var entry: Entry? { entries.first { $0.id == entryID } }
  var selectedItem: ConfigurationPage.Item? { page?.items.first { $0.id == selected } }
  var canStage: Bool {
    !busy && !loading && !stale && uncertain == nil && entry?.update != nil
      && page?.presentation?.version == 1 && page?.supports("preview") == true && page?.supports("apply") == true
  }
  var decisions: [ConfigurationDecision] {
    (page?.items ?? []).compactMap { page?.writable($0.id) == true ? choices[$0.id] : nil }
  }
  var canPreview: Bool {
    canStage && !decisions.isEmpty
      && decisions.allSatisfy { decision in
        decision.choice != "merge"
          || page?.items.first { $0.id == decision.id }?.fields.allSatisfy {
            ["local", "source"].contains(decision.fields[$0] ?? "")
          } == true
      }
  }
  var canApply: Bool {
    !busy && !loading && uncertain == nil && plan != nil && entry?.update != nil && page?.supports("apply") == true
  }
  var rows: [ConfigurationPage.Item] {
    (page?.items ?? []).filter { item in
      (kind == "all" || item.kind == kind)
        && (status == "all"
          || (status == "attention" ? !["synced", "read-only"].contains(item.status) : item.status == status))
        && (search.isEmpty
          || [item.title, item.localPath, item.sourcePath ?? "", item.manager ?? "", item.origin, item.client ?? ""]
            .contains { $0.localizedStandardContains(search) })
    }
  }
  var canManageRegistry: Bool {
    !busy && !loading && !stale && uncertain == nil && entry?.update != nil
      && page?.registry?.version == 1 && page?.supports("repositories-update") == true
  }
  func eligibleBackupSources(_ audience: String) -> [String] {
    page?.presentation?.version == 1 ? page?.presentation?.backupSourceIds?[audience] ?? [] : []
  }
  func editRegistry(category: String, id: String? = nil) {
    guard canManageRegistry, let registry = page?.registry else { return }
    discardPlan()
    registryReview = nil
    choices = [:]
    if category == "source" {
      registryDraft = .init(entryID: entryID, registry: registry, source: registry.sources.first { $0.id == id })
    } else if category == "target" {
      registryDraft = .init(entryID: entryID, registry: registry, target: registry.targets.first { $0.id == id })
    }
  }
  func closeRegistryDraft() {
    guard !busy else { return }
    registryDraft = nil
    registryReview = nil
  }
  func discardRegistryReview() { registryReview = nil }
  func reviewRegistryDraft() {
    guard let draft = registryDraft, draft.entryID == entryID else { return }
    prepareRegistry(draft.mutation(eligibleSourceIDs: eligibleBackupSources(draft.target.audience)), draftID: draft.id)
  }
  func prepareRegistry(_ mutation: ConfigurationRegistryMutation, draftID: UUID? = nil) {
    guard canManageRegistry, mutation.revision == page?.registry?.revision,
      ["save-source", "save-target", "remove-source", "remove-target", "claim"].contains(mutation.action)
    else { return }
    discardPlan()
    registryReview = RegistryReview(entryID: entryID, mutation: mutation, draftID: draftID)
  }
  func canConfirmRegistry(_ request: RegistryReview) -> Bool {
    canManageRegistry && request.id == registryReview?.id && request.entryID == entryID
      && request.mutation.revision == page?.registry?.revision
  }
  func confirmRegistry(_ request: RegistryReview) async {
    guard canConfirmRegistry(request) else { return }
    registryReview = nil
    var command = ConfigurationCommand(operation: "repositories-update")
    command.registry = request.mutation
    if await invoke(command) != nil, request.draftID == registryDraft?.id { registryDraft = nil }
  }
  func canPreviewBackup(_ target: ConfigurationRegistry.Target) -> Bool {
    !busy && !loading && !stale && uncertain == nil && entry?.update != nil
      && page?.registry?.version == 1 && page?.registry?.targets.contains(target) == true
      && target.driver == "workstation" && target.root?.isEmpty == false
      && page?.supports("backup-preview") == true && page?.supports("apply") == true
  }
  func previewBackup(_ target: ConfigurationRegistry.Target, action: String, replace: Bool = false) async {
    guard canPreviewBackup(target), ["save", "restore"].contains(action) else { return }
    discardPlan()
    registryReview = nil
    let stamp = reviewGeneration
    var command = ConfigurationCommand(operation: "backup-preview")
    command.targetId = target.id
    command.revision = page?.registry?.revision
    command.action = action
    command.resolution = action == "save" && replace ? "replace" : nil
    let result = await invoke(command)
    guard stamp == reviewGeneration, let result else { return }
    guard let prepared = result.preview, !prepared.planId.isEmpty else {
      error = L10n.text.copy("提供方未返回可审阅的计划。", "The provider returned no reviewable plan.")
      return
    }
    planPurpose = "backup-\(action)"
    plan = prepared
  }
  func disconnect() {
    generation = UUID()
    reviewGeneration = UUID()
    client = nil
    plan = nil
    choices = [:]
    registryDraft = nil
    registryReview = nil
    busy = false
    loading = false
    stale = true
  }
  func invalidate(clearApproval: Bool = false) {
    revision += 1
    stale = true
    if clearApproval {
      discardPlan()
      registryReview = nil
      catalogLoaded = false
    }
  }
  func choose(_ item: ConfigurationPage.Item, choice: String) {
    guard canStage, page?.writable(item.id) == true, ["skip", "source", "local", "merge"].contains(choice) else {
      return
    }
    discardPlan()
    if choice == "skip" {
      choices[item.id] = nil
    } else {
      choices[item.id] = .init(
        id: item.id, revision: item.revision, choice: choice, fields: choices[item.id]?.fields ?? [:])
    }
  }
  func chooseField(_ item: ConfigurationPage.Item, field: String, value: String) {
    guard canStage, page?.writable(item.id) == true, choices[item.id]?.choice == "merge", item.fields.contains(field),
      ["source", "local"].contains(value)
    else { return }
    discardPlan()
    choices[item.id]?.fields[field] = value
  }
  func clearChoices() {
    guard !busy else { return }
    discardPlan()
    choices = [:]
  }
  func refreshIfIdle() async {
    guard !busy, !loading, plan == nil, registryReview == nil, choices.isEmpty, uncertain == nil else { return }
    await loadCatalog()
    if stale, entry?.read.effectiveConfirmation == "never" { await refresh() }
  }
  func discardPlan() {
    reviewGeneration = UUID()
    plan = nil
    planPurpose = "configuration"
  }
  func loadCatalog(force: Bool = false) async {
    guard let client, !loading, !busy, force || !catalogLoaded else { return }
    let session = generation
    loading = true
    defer { if session == generation { loading = false } }
    do {
      let result = try await client.nativeIntegrations()
      guard session == generation, !Task.isCancelled else { return }
      entries = result.integrations.flatMap { contribution in
        contribution.views.filter { $0.scope != "project" }.flatMap { view in
          view.blocks.compactMap { block -> Entry? in
            guard block.type == "configuration-manager", block.requiresProject != true,
              let read = contribution.actions.first(where: {
                $0.id == block.actionId && $0.operation == "configuration.read" && $0.effect == "local-read"
              })
            else { return nil }
            return Entry(contribution: contribution, view: view, block: block, read: read)
          }
        }
      }
      catalogDiagnostics = result.diagnostics
      catalogLoaded = true
      error = nil
      if !entries.contains(where: { $0.id == entryID }) {
        entryID = entries.first?.id ?? ""
        page = nil
        choices = [:]
        registryDraft = nil
        registryReview = nil
        discardPlan()
      }
    } catch { if session == generation { self.error = error.localizedDescription } }
  }
  func select(_ id: String, item: String? = nil) async {
    guard !busy, !loading, uncertain == nil, entries.contains(where: { $0.id == id }) else { return }
    if entryID != id {
      generation = UUID()
      entryID = id
      page = nil
      choices = [:]
      registryDraft = nil
      registryReview = nil
      discardPlan()
      stale = true
    }
    selected = item
    if entry?.read.effectiveConfirmation == "never" { await refresh() }
  }
  /// Refresh is the recovery boundary after an uncertain write. It never resends a plan.
  func refresh(confirmed: Bool = false) async {
    guard let client, let entry, !busy, !loading,
      entry.read.effectiveConfirmation == "never" || confirmed
    else { return }
    let session = generation
    loading = true
    stale = true
    discardPlan()
    registryReview = nil
    choices = [:]
    error = nil
    defer { if session == generation { loading = false } }
    repeat {
      let epoch = revision
      do {
        let result = try await client.configurationAction(
          integration: entry.contribution.id, action: entry.read.id, command: .init(operation: "inspect"),
          confirmed: confirmed)
        guard session == generation, !Task.isCancelled else { return }
        if epoch != revision { continue }
        page = result
        stale = false
        selectAvailable()
        if let pending = uncertain {
          let readable =
            pending.operation == "repositories-update"
            ? result.registry?.version == 1 && result.supports("repositories")
            : pending.operation == "git-action"
              ? result.supports("git-status") && result.repositories != nil
              : result.supports("history") && result.history != nil
          if readable {
            uncertain = nil
            notice = L10n.text.copy(
              "已重新读取当前状态；请核对记录，后续操作需重新审阅。", "Current state reloaded. Review the records before another operation.")
            section =
              pending.operation == "repositories-update"
              ? "sources" : pending.operation == "git-action" ? "repositories" : "history"
          }
        }
        return
      } catch {
        guard session == generation, !Task.isCancelled else { return }
        if epoch != revision { continue }
        self.error = error.localizedDescription
        return
      }
    } while session == generation && !Task.isCancelled
  }
  func preview() async {
    guard canPreview else { return }
    let stamp = reviewGeneration
    let result = await invoke(.init(operation: "preview", decisions: decisions))
    guard stamp == reviewGeneration, let result else { return }
    guard let prepared = result.preview, !prepared.planId.isEmpty else {
      error = L10n.text.copy("提供方未返回可审阅的计划。", "The provider returned no reviewable plan.")
      return
    }
    plan = prepared
  }
  func apply() async {
    guard canApply, let plan else { return }
    discardPlan()
    if await invoke(.init(operation: "apply", planId: plan.planId)) != nil {
      choices = [:]
      section = "history"
    }
  }
  func canRestore(_ record: ConfigurationPage.History) -> Bool {
    !busy && !loading && uncertain == nil && entry?.update != nil && page?.supports("restore") == true
      && ["applied", "failed", "applying", "restoring"].contains(record.state)
      && page?.history?.contains(where: { $0.planId == record.planId && $0.state == record.state }) == true
  }
  func restore(_ record: ConfigurationPage.History, entryID expected: String) async {
    guard expected == entryID, canRestore(record) else { return }
    discardPlan()
    _ = await invoke(.init(operation: "restore", planId: record.planId))
  }
  func git(_ command: ConfigurationCommand, entryID expected: String) async -> Bool {
    guard expected == entryID, command.operation == "git-action",
      ["fetch", "commit", "publish"].contains(command.action ?? ""),
      page?.repositories?.contains(where: {
        $0.id == command.repository && $0.revision == command.revision && $0.error == nil
      }) == true
    else { return false }
    return await invoke(command) != nil
  }
  private func invoke(_ command: ConfigurationCommand) async -> ConfigurationPage? {
    let operation = command.operation == "git-action" ? "git-\(command.action ?? "")" : command.operation
    guard let client, let entry, !busy, !loading, uncertain == nil, page?.supports(operation) == true,
      let action = command.operation == "git-action" ? entry.execute : entry.update
    else { return nil }
    let session = generation
    let epoch = revision
    busy = true
    error = nil
    notice = nil
    defer { if session == generation { busy = false } }
    do {
      let result = try await client.configurationAction(
        integration: entry.contribution.id, action: action.id, command: command, confirmed: true)
      guard session == generation else { return nil }
      page = result
      stale = epoch != revision
      notice = result.message.map(entry.text)
      selectAvailable()
      if !["preview", "backup-preview"].contains(command.operation) { changed?() }
      return result
    } catch {
      if session == generation {
        self.error = error.localizedDescription
        stale = true
        if !["preview", "backup-preview"].contains(command.operation) {
          uncertain = .init(operation: command.operation, planID: command.planId)
          discardPlan()
        }
      }
      return nil
    }
  }
  private func selectAvailable() {
    if page?.items.contains(where: { $0.id == selected }) != true { selected = page?.items.first?.id }
  }
}

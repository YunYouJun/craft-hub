import CraftHubMacCore
import CryptoKit
import Foundation
import Observation

/// One window owns the pending work-item operation. Provider actions remain behind the runtime's trust boundary.
@MainActor @Observable final class WorkItemQuickActionsModel {
  enum Mode { case detail, status }
  struct Review: Identifiable {
    let id = UUID()
    let title: String
    let from: String
    let to: String
    let fields: [String: String]
    fileprivate let generation: UUID
    fileprivate let revision: Int
    fileprivate let createdAt: Date
    fileprivate let item: IntegrationPresentation.Entity
    fileprivate let transition: WorkItemStatusTransitions.Transition
    fileprivate let input: [String: IntegrationValue]
  }
  private struct Actions: Equatable {
    let get: String?
    let connection: String?
    let transitions: String?
    let update: String?
    let signature: [String]
  }
  private(set) var target: WorkItemActionTarget?
  private(set) var item: IntegrationPresentation.Entity?
  private(set) var mode = Mode.detail
  private(set) var loading = false
  private(set) var executing = false
  private(set) var uncertain = false
  private(set) var stale = true
  private(set) var error: String?
  private(set) var review: Review?
  private(set) var transitions: [WorkItemStatusTransitions.Transition] = []
  private(set) var selectedID = ""
  private(set) var fields: [String: String] = [:]
  @ObservationIgnored var completed: ((IntegrationPresentation.Entity) async -> Void)?
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private var actions: Actions?
  @ObservationIgnored private var connectionIdentity: String?
  @ObservationIgnored private let now: () -> Date
  var pending: Bool { executing || uncertain }
  var selected: WorkItemStatusTransitions.Transition? { transitions.first { $0.id == selectedID } }
  var canChangeStatus: Bool {
    !loading && !pending && !stale && target?.readOnly == false && item?.archived != true
      && actions?.get != nil && actions?.update != nil && !(item?.status ?? "").isEmpty
      && (connectionIdentity != nil || item?.sourceRef != nil)
      && (actions?.transitions != nil ? item?.statusUpdateAvailable != false : item?.statusUpdateAvailable == true)
  }
  var canReview: Bool {
    guard canChangeStatus, review == nil, let selected else { return false }
    return selected.requiredFields.allSatisfy {
      !(fields[$0] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
  }
  init(now: @escaping () -> Date = Date.init) { self.now = now }

  func connect(_ client: RuntimeAPIClient?) {
    reset()
    self.client = client
  }
  private func reset() {
    generation = UUID()
    revision += 1
    target = nil
    item = nil
    review = nil
    actions = nil
    connectionIdentity = nil
    transitions = []
    selectedID = ""
    fields = [:]
    loading = false
    executing = false
    uncertain = false
    stale = true
    error = nil
  }
  func close() { if !pending { reset() } }
  func invalidate() {
    revision += 1
    stale = true
    review = nil
    transitions = []
    selectedID = ""
    fields = [:]
  }
  func open(_ target: WorkItemActionTarget, mode: Mode = .detail) async {
    guard !pending else { return }
    reset()
    self.target = target
    self.item = target.item
    self.mode = mode
    if target.readOnly {
      stale = true
      return
    }
    await reload()
  }
  func show(_ mode: Mode) { if !pending && review == nil { self.mode = mode } }
  func select(_ id: String) {
    guard canChangeStatus, review == nil, transitions.contains(where: { $0.id == id }) else { return }
    selectedID = id
    fields = [:]
    error = nil
  }
  func edit(_ field: String, value: String) {
    guard canChangeStatus, review == nil, selected?.requiredFields.contains(field) == true else { return }
    fields[field] = value
  }

  func reload() async {
    guard let client, let target, !loading, !pending, !target.readOnly else { return }
    let token = generation
    let epoch = revision
    loading = true
    stale = true
    error = nil
    review = nil
    selectedID = ""
    fields = [:]
    transitions = []
    defer { if token == generation { loading = false } }
    do {
      let catalog = try await client.nativeIntegrations()
      try check(token, epoch)
      let resolved = try resolve(catalog, target)
      let identity = try await readConnection(client, target, resolved)
      try check(token, epoch)
      if let expected = target.connectionCacheKey, identity != expected { throw Failure.accountChanged }
      var detail = target.item
      if let get = resolved.get {
        let result = try await readItem(client, target, action: get, original: target.item)
        try check(token, epoch)
        detail = target.item.merging(result)
        item = detail
      }
      var options: [WorkItemStatusTransitions.Transition] = []
      if resolved.update != nil, detail.archived != true, !((detail.status ?? "").isEmpty) {
        options = try await statusOptions(client, target, actions: resolved, item: detail)
        try check(token, epoch)
      }
      actions = resolved
      connectionIdentity = identity
      transitions = options
      if resolved.transitions == nil, options.count == 1 { selectedID = options[0].id }
      stale = false
    } catch {
      if token == generation, epoch == revision, !(error is CancellationError) {
        self.error = message(error)
      }
    }
  }

  /// Freeze native status, transition and required values before showing the explicit remote-write review.
  func prepareReview() {
    guard canReview, let item, let selected else { return }
    var input = statusInput(item)
    if actions?.transitions != nil {
      input["transitionId"] = .string(selected.id)
      input["status"] = .string(selected.toStatus)
      input["fields"] = .object(
        Dictionary(uniqueKeysWithValues: selected.requiredFields.map { ($0, .string(fields[$0] ?? "")) }))
    } else {
      input["statusCategory"] = .string(selected.toStatus)
    }
    let selectedFields = Dictionary(uniqueKeysWithValues: selected.requiredFields.map { ($0, fields[$0] ?? "") })
    review = Review(
      title: item.title, from: item.statusLabel ?? item.status ?? "", to: selected.title, fields: selectedFields,
      generation: generation, revision: revision, createdAt: now(), item: item, transition: selected, input: input)
  }
  func cancelReview() { if !executing { review = nil } }

  /// Verify the live declaration, account, item status and workflow again; never retry an ambiguous write.
  func confirm(_ pending: Review) async {
    guard let client, let target, let actions, review?.id == pending.id, !executing, !uncertain, !stale,
      pending.generation == generation, pending.revision == revision
    else { return }
    let reviewAge = now().timeIntervalSince(pending.createdAt)
    guard reviewAge >= 0, reviewAge < 120 else {
      invalidate()
      error = L10n.text.copy("确认已过期，请重新读取事项。", "This review expired. Reload the item.")
      return
    }
    let token = generation
    let epoch = revision
    review = nil
    executing = true
    error = nil
    var sent = false
    defer { if token == generation { executing = false } }
    do {
      let catalog = try await client.nativeIntegrations()
      try check(token, epoch)
      guard try resolve(catalog, target) == actions else { throw Failure.declarationChanged }
      let identity = try await readConnection(client, target, actions)
      try check(token, epoch)
      guard identity == connectionIdentity, let get = actions.get, let update = actions.update else {
        throw Failure.accountChanged
      }
      let current = try await readItem(client, target, action: get, original: pending.item)
      try check(token, epoch)
      guard current.status == pending.item.status, current.archived != true, current.statusUpdateAvailable != false
      else {
        throw Failure.itemChanged
      }
      let options = try await statusOptions(client, target, actions: actions, item: pending.item.merging(current))
      try check(token, epoch)
      guard options.contains(pending.transition) else { throw Failure.workflowChanged }
      sent = true
      let result = try await client.integrationPresentation(
        integration: target.integrationId, action: update, project: target.projectId,
        input: pending.input, confirmed: true,
        reviewedAction: ["operation": "work-items.update-status", "effect": "remote-write"])
      guard token == generation else { return }
      guard epoch == revision, !Task.isCancelled, result.kind == "entity", let receipt = result.entity,
        pending.item.refersToSameWorkItem(as: receipt)
      else { throw RuntimeAPIError.invalidResponse }
      let updated = pending.item.merging(receipt)
      executing = false
      close()
      await completed?(updated)
    } catch {
      if token == generation {
        stale = true
        if sent {
          uncertain = true
          self.error = L10n.text.copy(
            "操作未返回可确认的结果。请到来源核对；不会自动重试。",
            "The operation did not return a confirmed result. Check the source; it will not retry automatically.")
        } else if !(error is CancellationError) {
          self.error = message(error)
        }
      }
    }
  }
  func acknowledgeUncertain() {
    guard uncertain, !executing else { return }
    uncertain = false
    close()
  }

  private func check(_ token: UUID, _ epoch: Int) throws {
    guard token == generation, epoch == revision, !Task.isCancelled else { throw CancellationError() }
  }
  private func resolve(_ catalog: NativeIntegrationCatalog, _ target: WorkItemActionTarget) throws -> Actions {
    guard let contribution = catalog.integrations.first(where: { $0.id == target.integrationId }) else {
      throw Failure.declarationChanged
    }
    func read(_ operation: String) -> String? {
      contribution.actions.first {
        $0.operation == operation && $0.effect == "remote-read" && $0.effectiveConfirmation == "never"
      }?.id
    }
    let transitions = read("work-items.transitions")
    let hasWorkflow = contribution.actions.contains { $0.operation == "work-items.transitions" }
    let update = contribution.actions.first {
      $0.operation == "work-items.update-status" && $0.effect == "remote-write" && $0.effectiveConfirmation == "always"
    }?.id
    return Actions(
      get: read("work-items.get"), connection: read("connection.status"), transitions: transitions,
      update: hasWorkflow && transitions == nil ? nil : update,
      signature: contribution.actions.map {
        [$0.id, $0.operation, $0.effect, $0.effectiveConfirmation].joined(separator: "\u{0}")
      }.sorted())
  }
  private func readConnection(_ client: RuntimeAPIClient, _ target: WorkItemActionTarget, _ actions: Actions)
    async throws -> String?
  {
    guard let connection = actions.connection else {
      if target.connectionCacheKey != nil { throw Failure.accountChanged }
      return nil
    }
    let result = try await client.integrationPresentation(
      integration: target.integrationId, action: connection, project: target.projectId,
      input: localized(target.connectionInput),
      reviewedAction: ["operation": "connection.status", "effect": "remote-read"])
    guard result.kind == "connection", let status = result.connection, status.connected else {
      throw Failure.disconnected
    }
    return status.session?.cacheKey
  }
  private func readItem(
    _ client: RuntimeAPIClient, _ target: WorkItemActionTarget, action: String, original: IntegrationPresentation.Entity
  ) async throws -> IntegrationPresentation.Entity {
    let result = try await client.integrationPresentation(
      integration: target.integrationId, action: action, project: target.projectId,
      input: localized(original.workItemInput),
      reviewedAction: ["operation": "work-items.get", "effect": "remote-read"])
    guard result.kind == "entity", let item = result.entity, original.refersToSameWorkItem(as: item) else {
      throw Failure.itemChanged
    }
    if let expected = original.sourceRef, item.sourceRef != expected { throw Failure.itemChanged }
    if let account = item.sourceRef?.accountId, let expected = target.accountKey,
      SHA256.hash(data: Data(account.utf8)).map({ String(format: "%02x", $0) }).joined() != expected
    {
      throw Failure.accountChanged
    }
    return item
  }
  private func statusOptions(
    _ client: RuntimeAPIClient, _ target: WorkItemActionTarget, actions: Actions, item: IntegrationPresentation.Entity
  ) async throws -> [WorkItemStatusTransitions.Transition] {
    guard let action = actions.transitions else {
      guard item.statusUpdateAvailable == true else { return [] }
      let done = ["done", "resolved", "closed", "cancelled"].contains(item.statusCategory ?? "")
      return [
        .init(
          id: done ? "reopen" : "complete",
          title: done ? L10n.text.copy("重新打开", "Reopen") : L10n.text.copy("标记完成", "Mark Complete"),
          fromStatus: item.status ?? "", toStatus: done ? "open" : "done")
      ]
    }
    let result = try await client.workItemTransitions(
      integration: target.integrationId, action: action, project: target.projectId, input: statusInput(item))
    guard result.currentStatus == item.status, Set(result.transitions.map(\.id)).count == result.transitions.count,
      result.transitions.allSatisfy({
        $0.fromStatus == result.currentStatus && !$0.id.isEmpty && !$0.toStatus.isEmpty
          && Set($0.requiredFields).count == $0.requiredFields.count
      })
    else { throw Failure.workflowChanged }
    return result.transitions
  }
  private func localized(_ input: [String: IntegrationValue]) -> [String: IntegrationValue] {
    input.merging(["locale": .string(L10n.text.chinese ? "zh-CN" : "en")]) { _, next in next }
  }
  private func statusInput(_ item: IntegrationPresentation.Entity) -> [String: IntegrationValue] {
    localized(item.workItemInput).merging(["title": .string(item.title), "currentStatus": .string(item.status ?? "")]) {
      _, next in next
    }
  }
  private enum Failure: Error { case disconnected, accountChanged, declarationChanged, itemChanged, workflowChanged }
  private func message(_ error: Error) -> String {
    switch error {
    case Failure.disconnected: L10n.text.copy("请先连接来源账号。", "Connect the source account first.")
    case Failure.accountChanged:
      L10n.text.copy("来源账号已变化，请刷新列表后重试。", "The source account changed. Refresh the list before continuing.")
    case Failure.declarationChanged:
      L10n.text.copy("插件操作已变化，请刷新后重试。", "The plugin actions changed. Refresh before continuing.")
    case Failure.itemChanged: L10n.text.copy("事项已变化，请重新读取并确认。", "The item changed. Reload and review it again.")
    case Failure.workflowChanged:
      L10n.text.copy("可用状态已变化，请重新读取并确认。", "Available transitions changed. Reload and review them again.")
    default: error.localizedDescription
    }
  }
}

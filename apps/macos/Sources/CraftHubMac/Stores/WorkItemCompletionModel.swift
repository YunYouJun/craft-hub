import CraftHubMacCore
import CryptoKit
import Foundation
import Observation

extension WorkItemActionTarget {
  var isMicrosoftTodo: Bool { item.sourceRef?.providerId == "microsoft-todo" }
  var canCompleteInline: Bool {
    isMicrosoftTodo && !readOnly && item.active && item.archived != true && item.statusUpdateAvailable == true
      && !(item.status ?? "").isEmpty
  }
  func replacingItem(_ item: IntegrationPresentation.Entity) -> Self {
    Self(
      integrationId: integrationId, projectId: projectId, item: item, readOnly: readOnly,
      accountKey: accountKey, connectionCacheKey: connectionCacheKey, connectionInput: connectionInput)
  }
}

/// Single-task writes use the runtime's existing confirmation contract. The circle click is the confirmation.
@MainActor @Observable final class WorkItemCompletionModel {
  struct Notice {
    let target: WorkItemActionTarget
    let receipt: IntegrationPresentation.Entity
  }
  private(set) var notice: Notice?
  private(set) var error: String?
  private(set) var processing = false
  private(set) var uncertain = false
  private(set) var activeTarget: WorkItemActionTarget?
  private(set) var openingApplication = false
  private(set) var applicationError: String?
  @ObservationIgnored var canStart: () -> Bool = { true }
  @ObservationIgnored var completed: ((WorkItemActionTarget, IntegrationPresentation.Entity, Bool) -> Void)?
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var revision = 0
  var pending: Bool { processing || uncertain }

  func connect(_ client: RuntimeAPIClient?) {
    generation = UUID()
    self.client = client
    notice = nil
    error = nil
    processing = false
    uncertain = false
    activeTarget = nil
    openingApplication = false
    applicationError = nil
  }

  func invalidate() {
    revision += 1
    notice = nil
  }

  func complete(_ target: WorkItemActionTarget) async {
    guard target.canCompleteInline else { return }
    await update(target, undoing: false)
  }

  func undo() async {
    guard let notice else { return }
    await update(notice.target.replacingItem(notice.receipt), undoing: true)
  }

  private func update(_ target: WorkItemActionTarget, undoing: Bool) async {
    guard let client, !pending, canStart(), !target.readOnly, target.isMicrosoftTodo,
      let ref = target.item.sourceRef, let previousStatus = target.item.status,
      !previousStatus.isEmpty, !undoing || notice != nil
    else { return }
    let token = generation
    let epoch = revision
    let original = undoing ? notice!.target : target
    processing = true
    activeTarget = target
    error = nil
    var sent = false
    defer {
      if token == generation {
        processing = false
        if !uncertain { activeTarget = nil }
      }
    }
    do {
      let catalog = try await client.nativeIntegrations()
      try check(token, epoch)
      let actions = try resolve(catalog, integration: target.integrationId)
      let connection = try await client.integrationPresentation(
        integration: target.integrationId, action: actions.connection, project: target.projectId,
        input: target.connectionInput,
        reviewedAction: ["operation": "connection.status", "effect": "remote-read"])
      try check(token, epoch)
      guard connection.kind == "connection", let status = connection.connection, status.connected,
        target.connectionCacheKey == nil || status.session?.cacheKey == target.connectionCacheKey
      else { throw CompletionFailure.accountChanged }
      if let expected = target.accountKey {
        let account = SHA256.hash(data: Data(ref.accountId.utf8)).map { String(format: "%02x", $0) }.joined()
        guard account == expected else { throw CompletionFailure.accountChanged }
      }
      // Re-read declarations after account verification; providers with workflow transitions never use this shortcut.
      let current = try await client.nativeIntegrations()
      try check(token, epoch)
      guard try resolve(current, integration: target.integrationId) == actions else {
        throw CompletionFailure.unavailable
      }
      var input = target.item.workItemInput
      input["statusCategory"] = .string(undoing ? "open" : "done")
      input["currentStatus"] = .string(previousStatus)
      input["title"] = .string(target.item.title)
      input["locale"] = .string(L10n.text.chinese ? "zh-CN" : "en")
      if undoing { input["status"] = .string(original.item.status!) }
      sent = true
      let result = try await client.integrationPresentation(
        integration: target.integrationId, action: actions.update, project: target.projectId,
        input: input, confirmed: true,
        reviewedAction: ["operation": "work-items.update-status", "effect": "remote-write"])
      try check(token, epoch)
      guard result.kind == "entity", let receipt = result.entity, receipt.sourceRef == ref,
        target.item.refersToSameWorkItem(as: receipt),
        undoing
          ? receipt.status == original.item.status && receipt.active : receipt.status == "completed" && !receipt.active
      else { throw RuntimeAPIError.invalidResponse }
      let updated = target.item.merging(receipt)
      notice = undoing ? nil : Notice(target: original, receipt: updated)
      completed?(original, updated, undoing)
    } catch {
      guard token == generation else { return }
      // A rejected request has a definite outcome. Transport errors and unverified receipts may have written.
      let rejected: Bool
      if case RuntimeAPIError.rejected(let code, _) = error {
        rejected = (400..<500).contains(code) && code != 408
      } else {
        rejected = false
      }
      uncertain = sent && !rejected
      if uncertain {
        notice = nil
        self.error = L10n.text.copy(
          "结果暂无法确认，请在 To Do 中核对；不会自动重试。",
          "The result is uncertain. Check To Do; this action will not retry automatically.")
      } else {
        self.error = (error as? CompletionFailure)?.message ?? error.localizedDescription
      }
    }
  }

  func acknowledgeUncertain() {
    guard uncertain, !processing else { return }
    uncertain = false
    activeTarget = nil
    error = nil
  }

  func openMicrosoftTodo() async {
    guard let client, !openingApplication else { return }
    let token = generation
    openingApplication = true
    applicationError = nil
    defer { if token == generation { openingApplication = false } }
    do { try await client.openMicrosoftTodo() } catch {
      if token == generation {
        applicationError = L10n.text.copy("无法打开 Microsoft To Do，请重试。", "Could not open Microsoft To Do. Try again.")
      }
    }
  }

  private struct Actions: Equatable {
    let connection: String
    let update: String
  }
  private func resolve(_ catalog: NativeIntegrationCatalog, integration: String) throws -> Actions {
    guard let contribution = catalog.integrations.first(where: { $0.id == integration }),
      !contribution.actions.contains(where: { $0.operation == "work-items.transitions" }),
      let connection = contribution.actions.first(where: {
        $0.operation == "connection.status" && $0.effect == "remote-read" && $0.effectiveConfirmation == "never"
      }),
      let update = contribution.actions.first(where: {
        $0.operation == "work-items.update-status" && $0.effect == "remote-write"
          && $0.effectiveConfirmation == "always"
      })
    else { throw CompletionFailure.unavailable }
    return Actions(connection: connection.id, update: update.id)
  }
  private func check(_ token: UUID, _ epoch: Int) throws {
    guard token == generation, epoch == revision, !Task.isCancelled else { throw CancellationError() }
  }
  private enum CompletionFailure: Error {
    case accountChanged, unavailable
    @MainActor var message: String {
      switch self {
      case .accountChanged:
        L10n.text.copy("来源账号已变化，请刷新后重试。", "The source account changed. Refresh before continuing.")
      case .unavailable:
        L10n.text.copy(
          "当前无法快捷完成，请刷新来源或在 To Do 中操作。", "Quick completion is unavailable. Refresh the source or use To Do.")
      }
    }
  }
}

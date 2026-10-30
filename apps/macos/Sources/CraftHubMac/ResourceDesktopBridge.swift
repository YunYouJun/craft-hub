import AppKit
import CraftHubMacCore
import SwiftUI

/// Grants local credential actions only to rows resolved from a current, installed resource declaration.
@MainActor @Observable final class ResourceDesktopBridge {
  struct Context: Decodable {
    let integrationId: String
    let viewId: String
    let blockId: String
    let projectId: String?
    let input: [String: IntegrationValue]
  }
  struct Session {
    let id: String
    let context: Context
    let source: IntegrationResourcePage.BrowserImport
    let keys: [String: String]
    let vault: ResourceCredentialVault
  }
  struct ImportRequest: Identifiable {
    let id = UUID()
    let session: Session
    var declaration: IntegrationResourcePage.BrowserImport { session.source }
    var vault: ResourceCredentialVault { session.vault }
  }
  private var client: RuntimeAPIClient?
  private var generation = UUID()
  private var session: Session?
  private var busy = false
  private var completion: CheckedContinuation<Bool, Never>?
  private var imported = false
  private(set) var importRequest: ImportRequest?
  private let makeVault: (String) -> ResourceCredentialVault
  var isActive: () -> Bool = { NSApp?.isActive == true }

  init(profile: URL = NativeStorage.directory, makeVault: ((String) -> ResourceCredentialVault)? = nil) {
    self.makeVault = makeVault ?? { ResourceCredentialVault(profile: profile, scope: $0) }
  }

  func connect(_ client: RuntimeAPIClient?) {
    invalidate()
    self.client = client
  }

  func invalidate() {
    generation = UUID()
    session = nil
    importRequest = nil
    imported = false
    completion?.resume(returning: false)
    completion = nil
  }

  func perform(_ action: String, input: [String: Any]) async throws -> Any {
    if action == "close-resource-session" {
      guard Set(input.keys) == ["sessionId"] else { throw ResourceCredentialError.invalid }
      if input["sessionId"] as? String == session?.id { invalidate() }
      return ["closed": true]
    }
    guard !busy else { throw ResourceCredentialError.unavailable }
    if action == "open-resource-session" {
      guard importRequest == nil,
        Set(input.keys).isSubset(of: ["integrationId", "viewId", "blockId", "projectId", "input"]),
        JSONSerialization.isValidJSONObject(input),
        let data = try? JSONSerialization.data(withJSONObject: input), data.count <= 65536,
        let context = try? JSONDecoder().decode(Context.self, from: data),
        [context.integrationId, context.viewId, context.blockId].allSatisfy({
          !$0.isEmpty && $0.count <= 256 && $0.range(of: "^[a-z0-9][a-z0-9._-]*$", options: .regularExpression) != nil
        }), context.projectId.map({ !$0.isEmpty && $0.count <= 256 }) ?? true,
        context.input.values.allSatisfy({
          if case .object = $0 { return false }
          if case .array = $0 { return false }
          return true
        })
      else { throw ResourceCredentialError.invalid }
      generation = UUID()
      session = nil
      let stamp = generation
      let page = try await read(context)
      guard let source = page.browserImport else { throw ResourceCredentialError.unavailable }
      try source.validate()
      guard let url = URL(string: source.url), let origin = IntegrationResourcePage.BrowserImport.origin(url) else {
        throw ResourceCredentialError.invalid
      }
      var keys: [String: String] = [:]
      for row in page.collection?.rows ?? [] {
        if let key = row.credentialKey {
          guard keys[row.id] == nil else { throw ResourceCredentialError.invalid }
          keys[row.id] = key
        }
      }
      let vault = makeVault(context.integrationId + ":" + source.id + ":" + origin)
      var available: [String] = []
      for (id, key) in keys where await vault.contains(key) { available.append(id) }
      guard stamp == generation, !Task.isCancelled else { throw ResourceCredentialError.unavailable }
      let session = Session(id: UUID().uuidString, context: context, source: source, keys: keys, vault: vault)
      self.session = session
      return ["sessionId": session.id, "availableRowIds": available.sorted()] as [String: Any]
    }
    guard let session, input["sessionId"] as? String == session.id else { throw ResourceCredentialError.unavailable }
    if action == "import-resource-accounts" {
      guard Set(input.keys) == ["sessionId"], importRequest == nil else { throw ResourceCredentialError.invalid }
      _ = try await currentPage(session)
      imported = false
      importRequest = ImportRequest(session: session)
      let result = await withCheckedContinuation { completion = $0 }
      return ["imported": result]
    }
    guard action == "resource-credential", Set(input.keys) == ["sessionId", "rowId", "operation"],
      let row = input["rowId"] as? String, let key = session.keys[row],
      let operation = input["operation"] as? String, ["show", "copy", "remove"].contains(operation),
      importRequest == nil, isActive()
    else { throw ResourceCredentialError.invalid }
    busy = true
    defer { busy = false }
    let page = try await currentPage(session)
    guard page.collection?.rows.contains(where: { $0.id == row && $0.credentialKey == key }) == true else {
      throw ResourceCredentialError.unavailable
    }
    if operation == "remove" {
      try await session.vault.remove(key)
      return ["removed": true]
    }
    let value = try await session.vault.read(key)
    guard self.session?.id == session.id, isActive(), !Task.isCancelled else {
      throw ResourceCredentialError.unavailable
    }
    if operation == "show" { return ["value": value] }
    NSPasteboard.general.clearContents()
    guard NSPasteboard.general.setString(value, forType: .string) else { throw ResourceCredentialError.unavailable }
    NSPasteboard.general.setData(Data(), forType: .init("org.nspasteboard.ConcealedType"))
    return ["copied": true]
  }

  func saveImport(_ request: ImportRequest, metadata: String) async -> Bool {
    guard request.id == importRequest?.id, let client else { return false }
    var planID: String?
    do {
      let page = try await currentPage(request.session)
      guard page.forms?.contains(where: { $0.id == request.declaration.formId && $0.effect == "update" }) == true else {
        return false
      }
      let context = request.session.context
      let plan = try await client.prepareIntegrationForm(
        integration: context.integrationId, project: context.projectId,
        selector: .init(
          viewId: context.viewId, blockId: context.blockId, resourceInput: page.input,
          formId: request.declaration.formId),
        values: ["content": metadata], locale: L10n.text.chinese ? "zh-CN" : "en")
      planID = plan.planId
      guard request.id == importRequest?.id, self.session?.id == request.session.id, !Task.isCancelled else {
        try? await client.discardIntegrationForm(
          integration: context.integrationId, project: context.projectId, plan: plan.planId)
        return false
      }
      let result = try await client.executeIntegrationForm(
        integration: context.integrationId, project: context.projectId, plan: plan.planId, confirmed: true)
      guard request.id == importRequest?.id, result.resources != nil else { return false }
      imported = true
      return true
    } catch {
      if let planID {
        try? await client.discardIntegrationForm(
          integration: request.session.context.integrationId, project: request.session.context.projectId, plan: planID)
      }
      return false
    }
  }

  func closeImport() {
    importRequest = nil
    completion?.resume(returning: imported)
    completion = nil
    imported = false
  }

  private func currentPage(_ session: Session) async throws -> IntegrationResourcePage {
    guard self.session?.id == session.id else { throw ResourceCredentialError.unavailable }
    let page = try await read(session.context)
    guard self.session?.id == session.id, let source = page.browserImport,
      source == session.source, !Task.isCancelled
    else { throw ResourceCredentialError.unavailable }
    return page
  }

  private func read(_ context: Context) async throws -> IntegrationResourcePage {
    guard let client else { throw ResourceCredentialError.unavailable }
    let catalog = try await client.nativeIntegrations()
    guard self.client === client,
      let contribution = catalog.integrations.first(where: { $0.id == context.integrationId }),
      let view = contribution.views.first(where: { $0.id == context.viewId }),
      view.scope != "project" || context.projectId != nil,
      view.scope != "global" || context.projectId == nil,
      let block = view.blocks.first(where: { $0.id == context.blockId && $0.type == "resource-browser" }),
      let action = contribution.actions.first(where: {
        $0.id == block.actionId && $0.operation == "resources.read" && $0.effect == "remote-read"
          && $0.effectiveConfirmation == "never"
      })
    else { throw ResourceCredentialError.unavailable }
    let result = try await client.integrationPresentation(
      integration: contribution.id, action: action.id, project: context.projectId, input: context.input,
      reviewedAction: ["operation": "resources.read", "effect": "remote-read"])
    guard self.client === client, let page = result.resources else { throw ResourceCredentialError.unavailable }
    return page
  }
}

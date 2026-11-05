import CraftHubMacCore
import Foundation
import Observation

/// The workbench supplies identities only. The native host resolves the current login policy and submits secrets directly.
@MainActor @Observable final class ConnectionBrowserBridge {
  struct Request: Identifiable {
    let id = UUID()
    let integration: String
    let project: String?
    let form: String
    let declaration: ConnectionBrowserAuthorization
    let revision: String
    let action: String
  }
  private(set) var request: Request?
  private var client: RuntimeAPIClient?
  private var generation = UUID()
  private var opening = false
  private var completion: CheckedContinuation<Bool, Never>?

  func connect(_ client: RuntimeAPIClient?) {
    invalidate()
    self.client = client
  }

  func invalidate() {
    generation = UUID()
    request = nil
    completion?.resume(returning: false)
    completion = nil
  }

  func open(_ input: [String: Any]) async throws -> Any {
    guard !opening, request == nil, let client,
      Set(input.keys).isSubset(of: ["integrationId", "formId", "projectId"]),
      let integration = input["integrationId"] as? String, let formID = input["formId"] as? String,
      [integration, formID].allSatisfy({
        $0.range(of: "^[a-z0-9][a-z0-9._-]{0,255}$", options: .regularExpression) != nil
      }),
      input["projectId"] == nil || input["projectId"] is String
    else { throw ConnectionBrowserError.invalid }
    opening = true
    let stamp = generation
    defer { opening = false }
    let project = input["projectId"] as? String
    let catalog = try await client.nativeIntegrations()
    guard let contribution = catalog.integrations.first(where: { $0.id == integration }),
      contribution.views.contains(where: { view in
        (project == nil ? view.scope != "project" : view.scope != "global")
          && view.blocks.contains(where: { $0.type == "connection-status" })
      }),
      let status = contribution.actions.first(where: {
        $0.operation == "connection.status" && $0.effect == "remote-read" && $0.effectiveConfirmation == "never"
      }),
      let update = contribution.actions.first(where: {
        $0.operation == "connection.update" && $0.effect == "local-write" && $0.effectiveConfirmation != "never"
      })
    else { throw ConnectionBrowserError.unavailable }
    let result = try await client.integrationPresentation(
      integration: integration, action: status.id, project: project,
      input: ["locale": .string(L10n.text.chinese ? "zh-CN" : "en")],
      reviewedAction: ["operation": "connection.status", "effect": "remote-read"])
    guard generation == stamp, self.client === client, !Task.isCancelled,
      let connection = result.connection, let revision = connection.reviewRevision,
      let form = connection.forms?.first(where: { $0.id == formID }), let policy = form.browserAuthorization,
      form.fields.contains(where: { $0.id == policy.cookieField && $0.type == "password" }),
      form.fields.contains(where: {
        $0.id == policy.originField && $0.type == "text" && $0.value == policy.cookieOrigin
      })
    else { throw ConnectionBrowserError.unavailable }
    try policy.validate()
    request = Request(
      integration: integration, project: project, form: formID, declaration: policy, revision: revision,
      action: update.id)
    return ["connected": await withCheckedContinuation { completion = $0 }]
  }

  func save(_ target: Request, cookie: String) async -> Bool {
    guard let client, request?.id == target.id else { return false }
    let stamp = generation
    do {
      // Runtime rechecks both the current action and the complete connection review, including the browser policy.
      let result = try await client.integrationPresentation(
        integration: target.integration, action: target.action, project: target.project,
        input: [
          "method": .string(target.form), "locale": .string(L10n.text.chinese ? "zh-CN" : "en"),
          target.declaration.cookieField: .string(cookie),
          target.declaration.originField: .string(target.declaration.cookieOrigin),
        ], confirmed: true, reviewedAction: ["operation": "connection.update", "effect": "local-write"],
        reviewedConnection: target.revision)
      guard generation == stamp, self.client === client, request?.id == target.id, result.connection?.connected == true
      else {
        return false
      }
      request = nil
      completion?.resume(returning: true)
      completion = nil
      return true
    } catch { return false }
  }
}

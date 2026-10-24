import CraftHubMacCore
import Foundation
import Observation

/// Native editing and lifecycle only. Field conversion, immutable reviews and execution belong to the runtime.
@MainActor @Observable final class IntegrationFormModel {
  private(set) var isPresented = false
  private(set) var title = ""
  private(set) var description: String?
  private(set) var project: String?
  private(set) var fields: [IntegrationFormField] = []
  private(set) var values: [String: String] = [:]
  private(set) var plan: IntegrationFormPlan?
  private(set) var result: IntegrationPresentation?
  private(set) var receiptNeedsRefresh = false
  private(set) var loading = false
  private(set) var preparing = false
  private(set) var executing = false
  private(set) var uncertain = false
  private(set) var stale = true
  private(set) var error: String?
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var integration = ""
  @ObservationIgnored private var selector: IntegrationFormSelector?
  @ObservationIgnored private var translations: [String: [String: String]]?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var epoch = 0
  @ObservationIgnored private var readStamp = UUID()
  @ObservationIgnored var completed: ((IntegrationPresentation) -> Void)?
  var busy: Bool { loading || preparing || executing }
  var pending: Bool { executing || uncertain }
  var canPrepare: Bool {
    !busy && !stale && !uncertain && !receiptNeedsRefresh && plan == nil && result == nil && selector != nil
  }
  func text(_ value: String) -> String { translations?[L10n.text.chinese ? "zh-CN" : "en"]?[value] ?? value }
  func value(_ field: IntegrationFormField) -> String { values[field.id] ?? field.initialValue }
  func edit(_ field: IntegrationFormField, value: String) {
    guard !busy, plan == nil, !uncertain else { return }
    values[field.id] = value
  }
  func reset() {
    cancelReview()
    generation = UUID()
    readStamp = UUID()
    client = nil
    selector = nil
    title = ""
    description = nil
    translations = nil
    fields = []
    values = [:]
    result = nil
    receiptNeedsRefresh = false
    isPresented = false
    loading = false
    preparing = false
    executing = false
    uncertain = false
    stale = true
    error = nil
    completed = nil
  }
  func close() { if !pending { reset() } }
  func invalidate() {
    epoch += 1
    stale = true
    cancelReview()
  }
  func open(client: RuntimeAPIClient, integration: String, project: String?, selector: IntegrationFormSelector) async {
    guard !pending else { return }
    reset()
    self.client = client
    self.integration = integration
    self.project = project
    self.selector = selector
    isPresented = true
    await reload()
  }
  func reload() async {
    guard let client, let selector, !busy, !uncertain, isPresented else { return }
    cancelReview()
    let token = generation
    let revision = epoch
    let stamp = UUID()
    readStamp = stamp
    loading = true
    defer { if token == generation && readStamp == stamp { loading = false } }
    do {
      let catalog = try await client.nativeIntegrations()
      guard token == generation, revision == epoch, !Task.isCancelled else { return }
      guard let contribution = catalog.integrations.first(where: { $0.id == integration }),
        let view = contribution.views.first(where: { $0.id == selector.viewId }),
        let block = view.blocks.first(where: { $0.id == selector.blockId }),
        let action = contribution.actions.first(where: { $0.id == block.actionId })
      else { throw RuntimeAPIError.invalidResponse }
      if let resource = selector.resource {
        guard block.type == "resource-browser", action.operation == "resources.read", action.effect == "remote-read",
          action.effectiveConfirmation == "never"
        else { throw RuntimeAPIError.invalidResponse }
        let response = try await client.integrationPresentation(
          integration: integration, action: action.id, project: project,
          input: resource.input.merging(["locale": .string(L10n.text.chinese ? "zh-CN" : "en")]) { _, next in next },
          reviewedAction: ["operation": "resources.read", "effect": "remote-read"])
        guard token == generation, revision == epoch, !Task.isCancelled else { return }
        guard let form = response.resources?.forms?.first(where: { $0.id == resource.formId }),
          contribution.actions.contains(where: { $0.operation == "resources.\(form.effect)" })
        else { throw RuntimeAPIError.invalidResponse }
        fields = form.fields ?? []
        title = form.title
        description = form.description
        translations = nil
      } else {
        guard block.type == "action-form" else { throw RuntimeAPIError.invalidResponse }
        fields = block.fields ?? []
        translations = contribution.translations
        title = text(block.title ?? action.title)
        description = block.description.map(text)
      }
      guard
        fields.allSatisfy({ ["text", "textarea", "number", "string-list", "select", "checkbox"].contains($0.type) }),
        Set(fields.map(\.id)).count == fields.count
      else { throw RuntimeAPIError.invalidResponse }
      values = values.filter { key, _ in fields.contains { $0.id == key } }
      error = nil
      stale = false
      result = nil
      receiptNeedsRefresh = false
    } catch {
      if token == generation, revision == epoch {
        stale = true
        self.error = L10n.text.copy(
          "无法读取当前表单，请重新加载或打开完整工作台。", "Could not read the current form. Reload or open the full workbench.")
      }
    }
  }
  func prepare() async {
    guard canPrepare, let client, let selector else { return }
    let token = generation
    let revision = epoch
    let selectedIntegration = integration
    let selectedProject = project
    preparing = true
    error = nil
    defer { if token == generation { preparing = false } }
    do {
      let prepared = try await client.prepareIntegrationForm(
        integration: selectedIntegration, project: selectedProject, selector: selector,
        values: Dictionary(uniqueKeysWithValues: fields.map { ($0.id, value($0)) }),
        locale: L10n.text.chinese ? "zh-CN" : "en")
      guard token == generation, revision == epoch, !Task.isCancelled else {
        try? await client.discardIntegrationForm(
          integration: selectedIntegration, project: selectedProject, plan: prepared.planId)
        return
      }
      guard prepared.project?.id == selectedProject else {
        try? await client.discardIntegrationForm(
          integration: selectedIntegration, project: selectedProject, plan: prepared.planId)
        throw RuntimeAPIError.invalidResponse
      }
      plan = prepared
      preparing = false
      if !prepared.requiresConfirmation { await execute(prepared, confirmed: false) }
    } catch {
      if token == generation, revision == epoch { self.error = error.localizedDescription }
    }
  }
  func cancelReview() {
    if let plan, let client {
      let selectedIntegration = integration
      let selectedProject = project
      Task {
        try? await client.discardIntegrationForm(
          integration: selectedIntegration, project: selectedProject, plan: plan.planId)
      }
    }
    plan = nil
  }
  func execute(_ prepared: IntegrationFormPlan, confirmed: Bool = true) async {
    guard let client, plan?.planId == prepared.planId, !executing, !stale, !uncertain else { return }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard
      let expiry = formatter.date(from: prepared.expiresAt) ?? ISO8601DateFormatter().date(from: prepared.expiresAt),
      expiry > Date()
    else {
      cancelReview()
      stale = true
      error = L10n.text.copy("审阅已过期，请重新读取表单。", "This review expired. Reload the form.")
      return
    }
    let token = generation
    plan = nil
    let revision = epoch
    executing = true
    error = nil
    defer { if token == generation { executing = false } }
    do {
      let response = try await client.executeIntegrationForm(
        integration: integration, project: project, plan: prepared.planId, confirmed: confirmed)
      guard token == generation else { return }
      guard revision == epoch else {
        receiptNeedsRefresh = true
        stale = true
        return
      }
      result = response
      stale = true
      completed?(response)
    } catch {
      if token == generation {
        uncertain = ["local-write", "remote-write"].contains(prepared.effect)
        stale = true
        self.error = L10n.text.copy(
          "操作未返回可确认的结果。请在来源核对；不会自动重试。",
          "The operation did not return a confirmed result. Check the source; it will not retry automatically.")
      }
    }
  }
  func acknowledgeUncertain() {
    guard uncertain, !executing else { return }
    uncertain = false
    stale = true
    values = [:]
  }
}

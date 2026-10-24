import AppKit
import CraftHubMacCore
import Foundation
import Observation

/// Ephemeral connection forms. Providers own credentials and authorization; this model never persists secrets.
@MainActor @Observable final class IntegrationConnectionModel {
  typealias Connection = IntegrationPresentation.Connection
  struct Review: Identifiable {
    let id = UUID()
    let title: String
    let description: String?
    let submitLabel: String
    let fields: [(label: String, value: String)]
    fileprivate let input: [String: IntegrationValue]
    fileprivate let revision: String
    fileprivate let generation: UUID
  }
  struct Authorization {
    let url: URL
    let code: String?
    let deadline: Date
    let startedConnected: Bool
    var observedPending = false
  }
  private(set) var isPresented = false
  private(set) var title = ""
  private(set) var project: String?
  private(set) var snapshot: Connection?
  private(set) var stale = true
  private(set) var busy = false
  private(set) var loading = false
  private(set) var uncertain = false
  private(set) var review: Review?
  private(set) var error: String?
  private(set) var notice: String?
  private(set) var authorization: Authorization?
  private(set) var watching = false
  private(set) var values: [String: [String: String]] = [:]
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var integration = ""
  @ObservationIgnored private var readAction = ""
  @ObservationIgnored private var updateAction = ""
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var epoch = 0
  @ObservationIgnored private var readStamp = UUID()
  @ObservationIgnored private var pollingStopped = false
  @ObservationIgnored private var metadataStale = false
  @ObservationIgnored private var observer: Task<Void, Never>?
  @ObservationIgnored private var translations: [String: [String: String]]?
  @ObservationIgnored private let now: () -> Date
  @ObservationIgnored private let openExternal: (URL) -> Bool
  @ObservationIgnored private let automaticallyPoll: Bool
  var pending: Bool { busy || uncertain }
  init(
    automaticallyPoll: Bool = true, now: @escaping () -> Date = Date.init,
    openExternal: @escaping (URL) -> Bool = { NSWorkspace.shared.open($0) }
  ) {
    self.automaticallyPoll = automaticallyPoll
    self.now = now
    self.openExternal = openExternal
  }
  func text(_ value: String) -> String { translations?[L10n.text.chinese ? "zh-CN" : "en"]?[value] ?? value }
  func reset() {
    generation = UUID()
    readStamp = UUID()
    pollingStopped = false
    observer?.cancel()
    observer = nil
    watching = false
    authorization = nil
    review = nil
    values = [:]
    snapshot = nil
    client = nil
    busy = false
    loading = false
    uncertain = false
    stale = true
    isPresented = false
    error = nil
    notice = nil
  }
  func open(
    client: RuntimeAPIClient, entry: IntegrationWorkbenchModel.Entry, block: NativeIntegrationCatalog.Block,
    project: String?
  ) async {
    guard !pending, let read = entry.action(block), read.operation == "connection.status",
      read.effectiveConfirmation == "never", read.effect == "remote-read",
      let update = entry.contribution.actions.first(where: {
        $0.operation == "connection.update" && $0.effect == "local-write"
      })
    else { return }
    reset()
    self.client = client
    integration = entry.contribution.id
    readAction = read.id
    updateAction = update.id
    translations = entry.contribution.translations
    title = entry.text(entry.view.title)
    self.project = project
    metadataStale = false
    isPresented = true
    await load()
  }
  func close() { if !pending { reset() } }
  func invalidate(hard: Bool) {
    epoch += 1
    stale = true
    review = nil
    clearPasswords()
    if hard {
      metadataStale = true
      stopWatching()
      authorization = nil
    }
  }
  func value(_ form: Connection.Form, _ field: Connection.Form.Field) -> String {
    values[form.id]?[field.id] ?? (field.type == "password" ? "" : field.value ?? "")
  }
  func edit(_ form: Connection.Form, _ field: Connection.Form.Field, _ value: String) {
    guard !busy, review == nil else { return }
    values[form.id, default: [:]][field.id] = value
  }
  private func clearPasswords() {
    for form in snapshot?.forms ?? [] {
      for field in form.fields where field.type == "password" { values[form.id]?[field.id] = nil }
    }
  }
  func canSubmit(_ form: Connection.Form) -> Bool {
    !busy && !loading && !stale && !uncertain && !metadataStale && review == nil
      && snapshot?.reviewRevision != nil && snapshot?.forms?.filter { $0.id == form.id }.count == 1
      && Set(form.fields.map(\.id)).count == form.fields.count
      && form.fields.allSatisfy {
        ["text", "password"].contains($0.type)
          && !["method", "locale", "__proto__", "prototype", "constructor"].contains($0.id)
          && ($0.required != true || !value(form, $0).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
  }
  func prepare(_ form: Connection.Form) {
    guard canSubmit(form), let revision = snapshot?.reviewRevision else { return }
    var input = Dictionary(uniqueKeysWithValues: form.fields.map { ($0.id, IntegrationValue.string(value(form, $0))) })
    input["method"] = .string(form.id)
    input["locale"] = .string(L10n.text.chinese ? "zh-CN" : "en")
    review = Review(
      title: text(form.title), description: form.description.map(text), submitLabel: text(form.submitLabel),
      fields: form.fields.map {
        (
          text($0.label),
          $0.type == "password"
            ? (value(form, $0).isEmpty
              ? L10n.text.copy("未填写", "Not provided") : L10n.text.copy("已填写（隐藏）", "Provided (hidden)"))
            : value(form, $0)
        )
      },
      input: input, revision: revision, generation: generation)
    error = nil
  }
  func cancelReview() {
    review = nil
    clearPasswords()
  }
  /// Explicit acknowledgement after the user checks the provider; it never replays the unknown operation.
  func acknowledgeUncertain() {
    guard uncertain, !busy else { return }
    uncertain = false
    stale = true
    review = nil
    values = [:]
    notice = L10n.text.copy(
      "已结束本次操作。再次提交前必须重新读取连接状态。", "This operation is closed. Reload connection status before another submission.")
  }
  func load() async {
    guard let client, isPresented, !loading, !busy else { return }
    let token = generation
    let revision = epoch
    let stamp = UUID()
    readStamp = stamp
    loading = true
    defer { if token == generation && stamp == readStamp { loading = false } }
    do {
      if metadataStale {
        let catalog = try await client.nativeIntegrations()
        guard token == generation, revision == epoch else { return }
        guard let contribution = catalog.integrations.first(where: { $0.id == integration }),
          let read = contribution.actions.first(where: {
            $0.operation == "connection.status" && $0.effect == "remote-read" && $0.effectiveConfirmation == "never"
          }),
          let update = contribution.actions.first(where: {
            $0.operation == "connection.update" && $0.effect == "local-write"
          })
        else { throw RuntimeAPIError.invalidResponse }
        readAction = read.id
        updateAction = update.id
        translations = contribution.translations
        metadataStale = false
      }
      let result = try await client.integrationPresentation(
        integration: integration, action: readAction, project: project,
        input: ["locale": .string(L10n.text.chinese ? "zh-CN" : "en")],
        reviewedAction: ["operation": "connection.status", "effect": "remote-read"])
      guard token == generation, revision == epoch, !Task.isCancelled else { return }
      guard !metadataStale, result.kind == "connection", let status = result.connection, status.reviewRevision != nil
      else {
        throw RuntimeAPIError.invalidResponse
      }
      accept(status, fromRead: true)
      uncertain = false
      stale = false
      error = nil
    } catch {
      if token == generation, revision == epoch {
        stale = true
        self.error = L10n.text.copy("无法读取连接状态，请重新检查。", "Could not read connection status. Check again.")
      }
    }
  }
  func confirm(_ pending: Review) async {
    guard let client, review?.id == pending.id, pending.generation == generation, !busy, !stale, !metadataStale,
      snapshot?.reviewRevision == pending.revision
    else { return }
    let token = generation
    epoch += 1
    readStamp = UUID()
    let revision = epoch
    review = nil
    clearPasswords()
    stopWatching()
    pollingStopped = false
    authorization = nil
    busy = true
    loading = false
    stale = true
    error = nil
    notice = nil
    do {
      let result = try await client.integrationPresentation(
        integration: integration, action: updateAction, project: project,
        input: pending.input, confirmed: true,
        reviewedAction: ["operation": "connection.update", "effect": "local-write"],
        reviewedConnection: pending.revision)
      guard token == generation else { return }
      guard !metadataStale, result.kind == "connection", let status = result.connection, status.reviewRevision != nil
      else {
        throw RuntimeAPIError.invalidResponse
      }
      accept(status, fromRead: false)
      stale = revision != epoch
      values = [:]
      notice = L10n.text.copy(
        "连接操作已返回，请核对当前账号和权限。", "Connection response received. Review the current account and permissions.")
      if !metadataStale, let authorization, !openExternal(authorization.url) {
        notice = L10n.text.copy("请点击授权链接继续。", "Open the authorization link to continue.")
      }
    } catch {
      if token == generation {
        uncertain = true
        // Credential-bearing provider errors may echo input; never put them in UI, logs or persisted state.
        self.error = L10n.text.copy(
          "操作结果尚未确认。请重新读取连接状态并核对；不会自动重试。",
          "The outcome is uncertain. Reload and review connection status; this action will not retry automatically.")
      }
    }
    guard token == generation else { return }
    busy = false
    if stale && !uncertain { await load() }
  }
  private func accept(_ status: Connection, fromRead: Bool) {
    if snapshot?.reviewRevision != status.reviewRevision {
      review = nil
      values = [:]
    }
    let previousConnected = snapshot?.connected ?? false
    snapshot = status
    if let device = status.deviceAuthorization, let url = DesktopBridge.externalURL(device.verificationUrl),
      let expiry = Self.date(device.expiresAt), expiry > now()
    {
      let previous = authorization?.code == device.userCode ? authorization : nil
      authorization = Authorization(
        url: url, code: device.userCode,
        deadline: min(expiry, previous?.deadline ?? now().addingTimeInterval(900)),
        startedConnected: previous?.startedConnected ?? previousConnected,
        observedPending: fromRead || previous?.observedPending == true)
      startWatching()
    } else if let value = status.authorizationUrl, let url = DesktopBridge.externalURL(value) {
      if authorization?.url != url {
        authorization = Authorization(
          url: url, code: nil, deadline: now().addingTimeInterval(600), startedConnected: previousConnected)
      }
      startWatching()
    } else if let active = authorization,
      status.capabilities?.create == true || (status.connected && (!active.startedConnected || active.observedPending))
    {
      stopWatching()
      authorization = nil
    }
  }
  private static func date(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
  }
  func startWatching(userInitiated: Bool = false) {
    if userInitiated { pollingStopped = false }
    guard authorization != nil, !metadataStale, !pollingStopped else { return }
    watching = true
    guard automaticallyPoll, observer == nil else { return }
    observer = Task { [weak self] in
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(2)) } catch { return }
        guard let self else { return }
        await self.poll()
      }
    }
  }
  func stopWatching(userInitiated: Bool = false) {
    if userInitiated { pollingStopped = true }
    observer?.cancel()
    observer = nil
    watching = false
  }
  func poll() async {
    guard watching, let active = authorization, !busy else { return }
    guard now() < active.deadline else {
      stopWatching()
      authorization = nil
      notice = L10n.text.copy(
        "本次授权等待已到期。请重新读取状态后继续。", "Authorization waiting expired. Reload status before continuing.")
      stale = true
      return
    }
    await load()
  }
}

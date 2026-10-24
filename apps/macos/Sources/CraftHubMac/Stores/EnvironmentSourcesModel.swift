import CraftHubMacCore
import Foundation
import Observation

/// Connection jobs are runtime-owned. No credentials are retained in this observable or persisted state.
@MainActor @Observable final class EnvironmentSourcesModel {
  var provider = ""
  var kind = "private"
  var repository = ""
  private(set) var snapshot: EnvironmentSourcesSnapshot?
  private(set) var busy = false
  private(set) var loading = false
  private(set) var uncertain = false
  private(set) var error: String?
  @ObservationIgnored var connected: (() -> Void)?
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private var observer: Task<Void, Never>?
  @ObservationIgnored private var notified = Set<String>()
  init(client: RuntimeAPIClient) { self.client = client }
  var active: EnvironmentSourcesSnapshot.Connection? {
    snapshot?.connections.first { $0.providerId == provider }
  }
  var pending: Bool { snapshot?.connections.contains(where: \.active) == true }
  var canConnect: Bool {
    client != nil && !busy && !loading && !uncertain && active?.active != true
      && snapshot?.providers.contains(where: { $0.id == provider && $0.kinds.contains(kind) }) == true
      && !repository.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }
  func disconnect() {
    stopObserving()
    generation = UUID()
    client = nil
    snapshot = nil
    busy = false
    loading = false
  }
  func load() async {
    guard let client, !loading, !busy else { return }
    let session = generation
    let epoch = revision
    loading = true
    defer { if session == generation { loading = false } }
    do {
      let result = try await client.environmentSources()
      guard session == generation, epoch == revision, !Task.isCancelled else { return }
      accept(result)
      uncertain = false
      error = nil
    } catch {
      if session == generation, epoch == revision {
        uncertain = true
        self.error = L10n.text.copy("无法读取连接状态，请重新检查。", "Could not read connection status. Check again.")
      }
    }
  }
  func connect() async {
    guard canConnect else { return }
    let target = repository.trimmingCharacters(in: .whitespacesAndNewlines)
    let selected = provider
    let type = kind
    await operate { try await $0.connectEnvironmentSource(provider: selected, kind: type, repository: target) }
  }
  func authenticate(_ job: EnvironmentSourcesSnapshot.Connection, username: String, token: String) async {
    guard !uncertain, active?.id == job.id, active?.repository == job.repository,
      active?.state == "authentication-required", !username.isEmpty, !token.isEmpty
    else { return }
    await operate { try await $0.authenticateEnvironmentSource(id: job.id, username: username, token: token) }
  }
  func cancel(_ job: EnvironmentSourcesSnapshot.Connection) async {
    guard !uncertain, active?.id == job.id, active?.active == true, active?.phase != "binding" else { return }
    await operate { try await $0.cancelEnvironmentSource(id: job.id) }
  }
  private func operate(_ action: (RuntimeAPIClient) async throws -> EnvironmentSourcesSnapshot) async {
    guard let client, !busy else { return }
    let session = generation
    revision += 1
    busy = true
    error = nil
    defer { if session == generation { busy = false } }
    do {
      let result = try await action(client)
      guard session == generation else { return }
      accept(result)
      uncertain = false
    } catch {
      if session == generation {
        // Never surface transport/provider text in a credential-bearing operation.
        uncertain = true
        self.error = L10n.text.copy(
          "操作结果尚未确认。请重新读取连接状态后继续。", "The result is unconfirmed. Reload connection status before continuing.")
      }
    }
  }
  private func accept(_ value: EnvironmentSourcesSnapshot) {
    snapshot = value
    if !value.providers.contains(where: { $0.id == provider }), let first = value.providers.first {
      provider = first.id
      kind = first.kinds.contains("private") ? "private" : (first.kinds.first ?? "public")
    }
    for job in value.connections where job.state == "connected" && notified.insert(job.id).inserted { connected?() }
  }
  func startObserving() {
    guard client != nil, observer == nil else { return }
    observer = Task { [weak self] in
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(1)) } catch { return }
        guard let self else { return }
        if self.pending || self.uncertain { await self.load() }
      }
    }
  }
  func stopObserving() {
    observer?.cancel()
    observer = nil
  }
}

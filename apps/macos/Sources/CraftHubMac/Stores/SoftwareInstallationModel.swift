import CraftHubMacCore
import Foundation
import Observation

/// Review and observe provider-owned installations. Session replacement invalidates every outstanding approval.
@MainActor @Observable final class SoftwareInstallationModel {
  private var client: RuntimeAPIClient?
  private var sources: [SoftwareSnapshot.Source] = []
  private(set) var plan: SoftwareInstallationPlan?
  private(set) var runs: [SoftwareInstallationRun] = []
  private(set) var planning = false
  private(set) var installing = false
  private(set) var loadingRuns = false
  private(set) var cancelling = Set<String>()
  private(set) var uncertain: SoftwareInstallationPlan?
  private(set) var error: String?
  private(set) var historyErrors: [String: String] = [:]
  var selected = Set<String>()
  var showsPlan = false
  @ObservationIgnored var detectionChanged: (() async -> Void)?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var previewGeneration = UUID()
  @ObservationIgnored private var mutationRevision = 0
  @ObservationIgnored private var mutations: [String: Int] = [:]
  @ObservationIgnored private var uncertainRevision = 0
  @ObservationIgnored private var polling: Task<Void, Never>?
  @ObservationIgnored private var visible = false

  init(client: RuntimeAPIClient) { self.client = client }
  func disconnect() {
    generation = UUID()
    previewGeneration = UUID()
    stopObserving()
    client = nil
    plan = nil
    uncertain = nil
    showsPlan = false
    planning = false
    installing = false
    loadingRuns = false
    cancelling.removeAll()
    sources = []
  }
  func updateSources(_ sources: [SoftwareSnapshot.Source]) { self.sources = sources }
  func supports(_ source: String, _ operation: String) -> Bool {
    sources.first { $0.id == source }?.supports(operation) == true
  }
  func sourceBusy(_ source: String) -> Bool { runs.contains { $0.sourceId == source && $0.active } }
  var canReadHistory: Bool { sources.contains { $0.supports("runs") } }
  func selectionKey(source: String, item: String) -> String { "\(source.count):\(source)\(item)" }
  func selectedIDs(_ source: SoftwareSnapshot.Source) -> [String] {
    source.items.filter { source.canInstall($0) && selected.contains(selectionKey(source: source.id, item: $0.id)) }
      .map(\.id)
  }
  var canConfirm: Bool {
    guard let plan else { return false }
    return !installing && uncertain == nil && !sourceBusy(plan.sourceId) && supports(plan.sourceId, "install")
      && plan.prerequisites.isEmpty && plan.items.contains { $0.action == "install" }
  }
  func dismissPlan() {
    guard !installing else { return }
    previewGeneration = UUID()
    plan = nil
    showsPlan = false
  }
  func preview(source: String, ids: [String]) async {
    guard let client, !planning, !installing, !sourceBusy(source), supports(source, "preview"),
      supports(source, "install"), !ids.isEmpty, ids.count <= 50
    else { return }
    let attempt = generation
    planning = true
    defer { if attempt == generation { planning = false } }
    if uncertain != nil {
      await loadRuns()
      guard attempt == generation, uncertain == nil, !sourceBusy(source) else { return }
    }
    previewGeneration = UUID()
    let preview = previewGeneration
    plan = nil
    error = nil
    do {
      let result = try await client.softwarePlan(source: source, software: ids)
      guard attempt == generation, preview == previewGeneration else { return }
      plan = result
      showsPlan = true
    } catch { if attempt == generation, preview == previewGeneration { self.error = error.localizedDescription } }
  }
  func confirm() async {
    guard let client, let plan, canConfirm else { return }
    let attempt = generation
    installing = true
    error = nil
    defer { if attempt == generation { installing = false } }
    do {
      let run = try await client.installSoftware(source: plan.sourceId, plan: plan.id)
      guard attempt == generation else { return }
      upsert(run)
      for item in plan.items { selected.remove(selectionKey(source: plan.sourceId, item: item.softwareId)) }
      self.plan = nil
      showsPlan = false
      if !run.active { await detectionChanged?() }
    } catch {
      guard attempt == generation else { return }
      uncertain = plan
      mutationRevision += 1
      uncertainRevision = mutationRevision
      self.error = L10n.text.copy(
        "未能确认安装状态。请先刷新安装记录，再决定是否重试。",
        "The installation state is uncertain. Refresh installation history before retrying.")
    }
  }
  private func upsert(_ run: SoftwareInstallationRun) {
    mutationRevision += 1
    mutations[run.key] = mutationRevision
    runs.removeAll { $0.key == run.key }
    runs.append(run)
    runs.sort { $0.createdAt > $1.createdAt }
  }
  func loadRuns() async {
    guard let client, !loadingRuns else { return }
    let ids = sources.filter { $0.supports("runs") }.map(\.id)
    guard !ids.isEmpty else { return }
    let attempt = generation
    let revision = mutationRevision
    loadingRuns = true
    defer { if attempt == generation { loadingRuns = false } }
    var changed = false
    for source in ids {
      do {
        let result = try await client.softwareRuns(source: source)
        guard attempt == generation, !Task.isCancelled else { return }
        let protected = runs.filter { $0.sourceId == source && (mutations[$0.key] ?? 0) > revision }
        let next = result.filter { item in !protected.contains { $0.key == item.key } }
        changed =
          changed
          || next.contains { item in
            !item.active && runs.contains { $0.key == item.key && $0.active }
          }
        runs.removeAll { $0.sourceId == source }
        runs += next + protected
        runs.sort { $0.createdAt > $1.createdAt }
        mutations = mutations.filter { key, _ in runs.contains { $0.key == key } }
        historyErrors[source] = nil
        if let uncertain, uncertain.sourceId == source, revision >= uncertainRevision {
          let found = result.contains { $0.planId == uncertain.id }
          self.uncertain = nil
          plan = nil
          showsPlan = false
          error =
            found
            ? nil
            : L10n.text.copy(
              "未找到这次安装记录。请重新审阅计划后重试。", "No record of this installation was found. Review a fresh plan to retry.")
        }
      } catch { if attempt == generation { historyErrors[source] = error.localizedDescription } }
    }
    if changed { await detectionChanged?() }
  }
  func cancel(_ run: SoftwareInstallationRun) async {
    guard let client, run.active, run.state != "cancelling", supports(run.sourceId, "cancel"),
      !cancelling.contains(run.key)
    else { return }
    let attempt = generation
    cancelling.insert(run.key)
    error = nil
    defer { if attempt == generation { cancelling.remove(run.key) } }
    do {
      let result = try await client.cancelSoftware(source: run.sourceId, run: run.id)
      guard attempt == generation else { return }
      upsert(result)
      if !result.active { await detectionChanged?() }
    } catch {
      if attempt == generation {
        self.error = L10n.text.copy(
          "未能确认停止状态，安装可能仍在进行。请刷新安装记录。",
          "Stopping was not confirmed. Installation may still be running; refresh its history.")
      }
    }
  }
  func startObserving() {
    guard !visible, client != nil else { return }
    visible = true
    polling = Task { [weak self] in
      while !Task.isCancelled {
        do { try await Task.sleep(for: .milliseconds(1500)) } catch { return }
        guard let self, self.visible else { return }
        if self.uncertain != nil || self.runs.contains(where: \.active) { await self.loadRuns() }
      }
    }
  }
  func stopObserving() {
    visible = false
    polling?.cancel()
    polling = nil
  }
}

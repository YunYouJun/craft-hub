import CraftHubMacCore
import Foundation
import Observation

/// Native editing and fresh observations; the runtime owns profile validation, portable references and persistence.
@MainActor @Observable final class EnvironmentProfileModel {
  var name = ""
  var selectedSoftware = Set<String>()
  var selectedConfigurations = Set<String>()
  var search = ""
  var imported = ""
  private(set) var snapshot: EnvironmentProfileSnapshot?
  private(set) var inventory: EnvironmentProfileInventory?
  private(set) var review: EnvironmentProfileReview?
  private(set) var setup: EnvironmentSetupSnapshot?
  private(set) var draftRevision: String?
  private(set) var busy = false
  private(set) var uncertain = false
  private(set) var stale = true
  private(set) var error: String?
  var fileError: String?
  private(set) var notice: String?
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var revision = 0
  init(client: RuntimeAPIClient) { self.client = client }

  var allSoftware: [EnvironmentProfile.Software] {
    let available = inventory?.software.map(\.reference) ?? []
    let ids = Set(available.map(\.id))
    return available + (snapshot?.profile?.software.filter { !ids.contains($0.id) } ?? [])
  }
  var allConfigurations: [EnvironmentProfile.Configuration] {
    let available = inventory?.configurations.map(\.reference) ?? []
    let ids = Set(available.map(\.id))
    return available + (snapshot?.profile?.configurations.filter { !ids.contains($0.id) } ?? [])
  }
  var canSave: Bool {
    client != nil && !busy && !uncertain && !stale && draftRevision != nil && draftRevision == snapshot?.revision
      && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && (!selectedSoftware.isEmpty || !selectedConfigurations.isEmpty)
  }
  func invalidate() {
    revision += 1
    stale = true
    review = nil
    setup = nil
  }
  func disconnect() {
    generation = UUID()
    client = nil
    busy = false
    invalidate()
    imported = ""
  }
  /// Explicit reset discards local choices. Ordinary refresh retains them and never silently rebases a conflict.
  func useSavedChoices() {
    guard !busy, let snapshot else { return }
    name = snapshot.profile?.name ?? L10n.text.copy("我的开发环境", "My development environment")
    selectedSoftware = Set(snapshot.profile?.software.map(\.id) ?? [])
    selectedConfigurations = Set(snapshot.profile?.configurations.map(\.id) ?? [])
    draftRevision = snapshot.revision
  }
  func acceptCurrentRevision() {
    guard !busy, !stale, !uncertain else { return }
    draftRevision = snapshot?.revision
  }
  func load(force: Bool = false) async {
    guard let client, !busy, force || stale || snapshot == nil || uncertain else { return }
    let session = generation
    busy = true
    review = nil
    setup = nil
    stale = true
    defer { if session == generation { busy = false } }
    repeat {
      let epoch = revision
      do {
        let saved = try await client.environmentProfile()
        let available = try await client.environmentProfileInventory()
        guard session == generation, !Task.isCancelled else { return }
        if epoch != revision { continue }
        snapshot = saved
        inventory = available
        stale = false
        uncertain = false
        error = nil
        if draftRevision == nil {
          name = saved.profile?.name ?? L10n.text.copy("我的开发环境", "My development environment")
          selectedSoftware = Set(saved.profile?.software.map(\.id) ?? [])
          selectedConfigurations = Set(saved.profile?.configurations.map(\.id) ?? [])
          draftRevision = saved.revision
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
  func save() async {
    guard canSave, let expected = draftRevision else { return }
    let software = allSoftware.filter { selectedSoftware.contains($0.id) }
    let configurations = allConfigurations.filter { selectedConfigurations.contains($0.id) }
    guard software.count == selectedSoftware.count, configurations.count == selectedConfigurations.count else {
      error = L10n.text.copy("部分选择已不可用，请重新读取并核对选择。", "Some selections are unavailable. Reload and review them.")
      return
    }
    let title = name
    await mutate {
      try await $0.saveEnvironmentProfile(
        revision: expected, name: title, software: software, configurations: configurations)
    }
  }
  /// A revision is captured when the user opens the import confirmation, not after an intervening refresh.
  func importProfile(json: String, revision expected: String) async -> Bool {
    guard !uncertain, !stale, expected == snapshot?.revision else { return false }
    return await mutate { try await $0.importEnvironmentProfile(Data(json.utf8), revision: expected) }
  }
  @discardableResult private func mutate(_ action: (RuntimeAPIClient) async throws -> EnvironmentProfileSnapshot) async
    -> Bool
  {
    guard let client, !busy else { return false }
    let session = generation
    busy = true
    error = nil
    notice = nil
    invalidate()
    let epoch = revision
    defer { if session == generation { busy = false } }
    do {
      let saved = try await action(client)
      guard session == generation else { return false }
      snapshot = saved
      draftRevision = saved.revision
      name = saved.profile?.name ?? ""
      selectedSoftware = Set(saved.profile?.software.map(\.id) ?? [])
      selectedConfigurations = Set(saved.profile?.configurations.map(\.id) ?? [])
      stale = epoch != revision
      uncertain = false
      imported = ""
      notice = L10n.text.copy("方案已保存。现在可以检查这台 Mac。", "Profile saved. You can now check this Mac.")
      return true
    } catch {
      if session == generation {
        uncertain = true
        self.error = error.localizedDescription
      }
    }
    return false
  }
  func check() async {
    guard let client, !busy, !uncertain, !stale else { return }
    let session = generation
    let epoch = revision
    busy = true
    review = nil
    setup = nil
    error = nil
    defer { if session == generation { busy = false } }
    do {
      let result = try await client.reviewEnvironmentProfile()
      let prerequisites = try await client.environmentSetup()
      guard session == generation, epoch == revision, !Task.isCancelled else { return }
      // Two independent reads cannot jointly establish readiness if the profile changed between them.
      guard result.snapshot.revision == prerequisites.profileRevision else {
        throw RuntimeAPIError.rejected(409, "The environment profile changed during the check. Reload and check again.")
      }
      snapshot = result.snapshot
      review = result
      setup = prerequisites
    } catch {
      if session == generation, epoch == revision { self.error = error.localizedDescription }
    }
  }
}

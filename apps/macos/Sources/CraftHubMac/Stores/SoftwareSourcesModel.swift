import CraftHubMacCore
import Foundation
import Observation

/// Preview tokens and revision checks remain owned by the runtime. Native drafts contain only user-selected locations.
@MainActor @Observable final class SoftwareSourcesModel {
  var draft = SoftwareSourceInput() { didSet { if draft != oldValue { cancelPreview() } } }
  var editing = false
  private(set) var snapshot: SoftwareSourcesSnapshot?
  private(set) var preview: SoftwareSourcePreview?
  private(set) var busy = false
  private(set) var loading = false
  private(set) var error: String?
  @ObservationIgnored var changed: (() async -> Void)?
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var previewGeneration = UUID()
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private var loadedRevision = -1
  init(client: RuntimeAPIClient) { self.client = client }
  func disconnect() {
    generation = UUID()
    cancelPreview()
    client = nil
    editing = false
    busy = false
    loading = false
  }
  func invalidate() { revision += 1 }
  func load(force: Bool = false) async {
    if force { invalidate() }
    guard let client, !loading, loadedRevision != revision else { return }
    let attempt = generation
    loading = true
    defer { if attempt == generation { loading = false } }
    repeat {
      let version = revision
      do {
        let result = try await client.softwareSources()
        guard attempt == generation, !Task.isCancelled else { return }
        if version != revision { continue }
        snapshot = result
        loadedRevision = version
        error = nil
      } catch {
        if version != revision { continue }
        if attempt == generation { self.error = error.localizedDescription }
        return
      }
    } while loadedRevision != revision
  }
  func edit(_ source: SoftwareRepositorySource? = nil) {
    guard !busy else { return }
    cancelPreview()
    draft =
      source.map {
        .init(
          id: $0.id, repository: $0.repository,
          localPath: snapshot?.localAvailable == true ? $0.localPath : nil,
          branch: $0.branch, catalogPath: $0.catalogPath, mode: $0.mode)
      } ?? .init()
    error = nil
    editing = true
  }
  func cancelPreview() {
    previewGeneration = UUID()
    preview = nil
  }
  func dismiss() {
    editing = false
    cancelPreview()
  }
  func inspect() async {
    guard let client, !busy else { return }
    cancelPreview()
    let attempt = generation
    let request = previewGeneration
    busy = true
    error = nil
    defer { if attempt == generation { busy = false } }
    do {
      let result = try await client.previewSoftwareSource(draft)
      guard attempt == generation, request == previewGeneration else { return }
      preview = result
    } catch { if attempt == generation, request == previewGeneration { self.error = error.localizedDescription } }
  }
  func apply() async {
    guard let preview else { return }
    let request = previewGeneration
    let applied = await mutate { try await $0.applySoftwareSource(preview.previewId) }
    if applied, request == previewGeneration { dismiss() }
  }
  func refresh(_ source: SoftwareRepositorySource) async {
    await mutate { try await $0.refreshSoftwareSource(source.id) }
  }
  func remove(_ source: SoftwareRepositorySource, revision: String) async {
    await mutate { try await $0.removeSoftwareSource(source.id, revision: revision) }
  }
  func configure(_ source: String, revision: String, policy: SoftwareRefreshPolicy) async -> Bool {
    await mutate { try await $0.configureSoftwareSource(source, revision: revision, policy: policy) }
  }
  @discardableResult private func mutate(_ action: (RuntimeAPIClient) async throws -> SoftwareSourcesSnapshot) async
    -> Bool
  {
    guard let client, !busy else { return false }
    let attempt = generation
    busy = true
    error = nil
    defer { if attempt == generation { busy = false } }
    do {
      let result = try await action(client)
      guard attempt == generation else { return false }
      // A read issued before this mutation cannot later replace the acknowledged source revision.
      invalidate()
      snapshot = result
      loadedRevision = revision
      await changed?()
      return attempt == generation
    } catch { if attempt == generation { self.error = error.localizedDescription } }
    return false
  }
}

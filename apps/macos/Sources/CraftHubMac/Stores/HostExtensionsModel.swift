import CraftHubMacCore
import Foundation
import Observation

/// Host registrations remain separate from declarative plugins; only explicit review can install executable code.
@MainActor @Observable final class HostExtensionsModel {
  private(set) var snapshot: NativeHostExtensions?
  private(set) var loading = false
  private(set) var busy = false
  private(set) var error: String?
  private(set) var review: NativeExtensionReview?
  private(set) var reviewError: String?
  private(set) var reviewConsumed = false
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var readGeneration = UUID()
  @ObservationIgnored private var reviewGeneration = UUID()
  var canConfirm: Bool { review != nil && !reviewConsumed && !busy }

  func connect(_ client: RuntimeAPIClient?) {
    cancelReview()
    generation = UUID()
    readGeneration = UUID()
    self.client = client
    snapshot = nil
    error = nil
    loading = false
    busy = false
  }
  func load() async {
    guard let client, !busy else { return }
    let attempt = generation
    let request = UUID()
    readGeneration = request
    loading = true
    defer { if attempt == generation && request == readGeneration { loading = false } }
    do {
      let result = try await client.hostExtensions()
      guard attempt == generation, request == readGeneration else { return }
      snapshot = result
      error = nil
    } catch { if attempt == generation && request == readGeneration { self.error = error.localizedDescription } }
  }
  func setBundled(_ host: NativeHostExtensions.Bundled) async {
    await mutate { try await $0.setBundledExtension(host.id, enabled: host.enabled != true) }
  }
  func setExternal(_ host: NativeHostExtensions.External) async {
    await mutate { try await $0.setExternalExtension(host, enabled: !host.enabled) }
  }
  func remove(_ host: NativeHostExtensions.External) async {
    await mutate { try await $0.removeHostExtension(host) }
  }
  private func mutate(_ operation: (RuntimeAPIClient) async throws -> NativeHostExtensions) async {
    guard let client, !busy else { return }
    let attempt = generation
    readGeneration = UUID()
    loading = false
    busy = true
    error = nil
    defer { if attempt == generation { busy = false } }
    do {
      let result = try await operation(client)
      guard attempt == generation else { return }
      snapshot = result
    } catch { if attempt == generation { self.error = error.localizedDescription } }
  }
  func cancelReview() {
    reviewGeneration = UUID()
    if let client, let review { Task { try? await client.cancelHostExtensionReview(review.id) } }
    review = nil
    reviewError = nil
    reviewConsumed = false
  }
  func preview(_ path: String, keepingReview: Bool = false) async {
    guard let client, !busy else { return }
    let previous = review
    cancelReview()
    if keepingReview {
      review = previous
      reviewConsumed = true
    }
    let attempt = generation
    let request = reviewGeneration
    busy = true
    error = nil
    defer { if attempt == generation { busy = false } }
    do {
      let result = try await client.previewHostExtension(path)
      guard attempt == generation, request == reviewGeneration else {
        try? await client.cancelHostExtensionReview(result.id)
        return
      }
      review = result
      reviewConsumed = false
    } catch {
      if attempt == generation && request == reviewGeneration {
        if keepingReview { reviewError = error.localizedDescription } else { self.error = error.localizedDescription }
      }
    }
  }
  func confirm() async {
    guard let client, let review, canConfirm else { return }
    let attempt = generation
    let request = reviewGeneration
    readGeneration = UUID()
    loading = false
    busy = true
    reviewError = nil
    reviewConsumed = true
    defer { if attempt == generation { busy = false } }
    do {
      let result = try await client.installHostExtension(review)
      guard attempt == generation, request == reviewGeneration else { return }
      snapshot = result
      self.review = nil
      error = nil
    } catch { if attempt == generation && request == reviewGeneration { reviewError = error.localizedDescription } }
  }
}

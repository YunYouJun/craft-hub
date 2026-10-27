import AppKit
import CraftHubMacCore
import Foundation

/// Coalesces package artwork within a runtime session; remote images reuse the shared HTTPS artwork cache.
@MainActor final class PluginIconCache {
  static let shared = PluginIconCache()
  private struct Key: Hashable {
    let client: ObjectIdentifier
    let reference: PluginIconReference
    let revision: Int
  }
  private final class Entry {
    weak var client: RuntimeAPIClient?
    let image: NSImage
    let fetchedAt: Date
    init(client: RuntimeAPIClient, image: NSImage, fetchedAt: Date) {
      self.client = client
      self.image = image
      self.fetchedAt = fetchedAt
    }
  }
  private final class Failure {
    weak var client: RuntimeAPIClient?
    let retryAt: Date
    init(client: RuntimeAPIClient, retryAt: Date) {
      self.client = client
      self.retryAt = retryAt
    }
  }
  private let remote: SoftwareIconCache
  private let now: () -> Date
  private var images: [Key: Entry] = [:]
  private var pending: [Key: Task<NSImage?, Never>] = [:]
  private var retryAfter: [Key: Failure] = [:]

  init(remote: SoftwareIconCache? = nil, now: @escaping () -> Date = Date.init) {
    self.remote = remote ?? .shared
    self.now = now
  }

  func image(for artwork: PluginArtwork, client: RuntimeAPIClient? = nil, revision: Int = 0) async -> NSImage? {
    switch artwork.source {
    case .inline(let value): return InlineIconArtwork.image(value)
    case .remote(let url): return await remote.image(for: url)
    case .package(let reference):
      guard let client else { return nil }
      return await packageImage(reference, client: client, revision: revision)
    case nil: return nil
    }
  }

  private func packageImage(_ reference: PluginIconReference, client: RuntimeAPIClient, revision: Int) async -> NSImage?
  {
    let key = Key(client: ObjectIdentifier(client), reference: reference, revision: revision)
    let cached = images[key].flatMap { $0.client === client ? $0 : nil }
    let lifetime: TimeInterval = reference.sourceID == "local" ? 0 : 60 * 60
    if let cached, (0..<lifetime).contains(now().timeIntervalSince(cached.fetchedAt)) { return cached.image }
    if let task = pending[key] { return await task.value }
    if let retry = retryAfter[key], retry.client === client, retry.retryAt > now() { return cached?.image }
    let task = Task<NSImage?, Never> {
      guard let data = try? await client.pluginIcon(reference), let image = NSImage(data: data), image.isValid else {
        return nil
      }
      return image
    }
    pending[key] = task
    let image = await task.value
    pending[key] = nil
    if let image {
      images = images.filter { $0.value.client != nil }
      if images.count >= 256 { images.removeAll() }
      images[key] = Entry(client: client, image: image, fetchedAt: now())
      retryAfter[key] = nil
      return image
    }
    retryAfter = retryAfter.filter { $0.value.client != nil && $0.value.retryAt > now() }
    if retryAfter.count >= 256 { retryAfter.removeAll() }
    retryAfter[key] = Failure(client: client, retryAt: now().addingTimeInterval(60))
    return cached?.image
  }
}

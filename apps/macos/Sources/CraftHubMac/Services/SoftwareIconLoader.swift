import AppKit
import CraftHubMacCore
import Observation

/// View-local selection atop the shared artwork cache; stale loads never replace a newer selection.
@MainActor @Observable final class SoftwareIconLoader {
  struct Loaded {
    let image: NSImage
    let source: SoftwareArtwork.Source
  }
  private(set) var loaded: Loaded?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private let cache: SoftwareIconCache

  init(cache: SoftwareIconCache) {
    self.cache = cache
  }

  convenience init() {
    self.init(cache: .shared)
  }

  convenience init(transport: @escaping SoftwareIconCache.Transport) {
    self.init(cache: SoftwareIconCache(transport: transport))
  }

  func load(_ artwork: SoftwareArtwork) async {
    let requestID = UUID()
    generation = requestID
    loaded = nil
    for source in artwork.sources {
      guard !Task.isCancelled, generation == requestID else { return }
      let image = await cache.image(for: source.url)
      guard !Task.isCancelled, generation == requestID else { return }
      if let image {
        loaded = Loaded(image: image, source: source)
        return
      }
    }
  }
}

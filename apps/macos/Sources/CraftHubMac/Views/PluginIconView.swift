import AppKit
import CraftHubMacCore
import SwiftUI

/// A provider-neutral icon for plugins and their contribution sources; missing or invalid artwork keeps a stable fallback.
struct PluginIconView: View {
  private struct Request: Hashable {
    let artwork: PluginArtwork
    let client: ObjectIdentifier?
    let revision: Int
  }
  private struct Loaded {
    let request: Request
    let image: NSImage
  }
  let artwork: PluginArtwork
  let client: RuntimeAPIClient?
  let revision: Int
  let fallbackSymbol: String
  let size: CGFloat
  @State private var loaded: Loaded?
  private var request: Request {
    Request(artwork: artwork, client: client.map(ObjectIdentifier.init), revision: revision)
  }

  init(
    artwork: PluginArtwork, client: RuntimeAPIClient? = nil, revision: Int = 0,
    fallbackSymbol: String = "puzzlepiece.extension", size: CGFloat = 32
  ) {
    self.artwork = artwork
    self.client = client
    self.revision = revision
    self.fallbackSymbol = fallbackSymbol
    self.size = size
  }

  init(icon: String?, fallbackSymbol: String = "puzzlepiece.extension", size: CGFloat = 32) {
    self.init(artwork: PluginArtwork(icon: icon), fallbackSymbol: fallbackSymbol, size: size)
  }

  var body: some View {
    ZStack {
      if let loaded, loaded.request == request {
        Image(nsImage: loaded.image).renderingMode(.original).resizable().scaledToFit()
      } else {
        Image(systemName: fallbackSymbol).font(.system(size: size * 0.7)).foregroundStyle(.secondary)
      }
    }.frame(width: size, height: size).accessibilityHidden(true)
      .task(id: request) {
        let requested = request
        let image = await PluginIconCache.shared.image(for: artwork, client: client, revision: revision)
        guard !Task.isCancelled, requested == request else { return }
        loaded = image.map { Loaded(request: requested, image: $0) }
      }
  }
}

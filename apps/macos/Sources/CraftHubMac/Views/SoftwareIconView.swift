import AppKit
import CraftHubMacCore
import Observation
import SwiftUI

/// Shared by catalog rows and favorites. A useful monogram remains visible while artwork loads or is unavailable.
struct SoftwareIconView: View {
  let title: String
  let artwork: SoftwareArtwork
  @State private var loader = SoftwareIconLoader()
  private let size: CGFloat = 40

  private var monogram: String {
    let words = title.split(whereSeparator: { $0.isWhitespace })
    return (words.count > 1 ? words.prefix(2).map { String($0.prefix(1)) }.joined() : String(title.prefix(2)))
      .uppercased()
  }
  private var tint: Color {
    let colors: [Color] = [.blue, .indigo, .purple, .teal, .orange, .pink]
    let index = title.utf8.reduce(0) { ($0 * 31 + Int($1)) % colors.count }
    return colors[index]
  }

  var body: some View {
    ZStack {
      if let loaded = loader.loaded, artwork.sources.contains(loaded.source) {
        Image(nsImage: loaded.image).resizable().scaledToFit()
          .frame(width: size * 0.85, height: size * 0.85)
          .clipShape(RoundedRectangle(cornerRadius: loaded.source.rounded ? size * 0.19 : 0))
          .scaleEffect(loaded.source.scale)
      } else {
        RoundedRectangle(cornerRadius: 10).fill(tint.gradient)
        Text(monogram.isEmpty ? "?" : monogram)
          .font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(.white)
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
    .task(id: artwork) { await loader.load(artwork) }
  }
}

/// Uses a separate unauthenticated session; runtime bearer tokens and browser cookies never accompany artwork requests.
@MainActor @Observable final class SoftwareIconLoader {
  struct Loaded {
    let image: NSImage
    let source: SoftwareArtwork.Source
  }
  private(set) var loaded: Loaded?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private let transport: (URLRequest) async throws -> (Data, URLResponse)
  private static let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.urlCredentialStorage = nil
    configuration.urlCache = URLCache(memoryCapacity: 16 * 1024 * 1024, diskCapacity: 0)
    configuration.timeoutIntervalForRequest = 8
    configuration.timeoutIntervalForResource = 12
    return URLSession(configuration: configuration)
  }()

  init(transport: @escaping (URLRequest) async throws -> (Data, URLResponse) = { try await session.data(for: $0) }) {
    self.transport = transport
  }

  func load(_ artwork: SoftwareArtwork) async {
    let requestID = UUID()
    generation = requestID
    loaded = nil
    for source in artwork.sources {
      guard !Task.isCancelled, generation == requestID else { return }
      do {
        var request = URLRequest(url: source.url)
        request.httpShouldHandleCookies = false
        let (data, response) = try await transport(request)
        guard !Task.isCancelled, generation == requestID else { return }
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode),
          data.count <= 8 * 1024 * 1024, let image = NSImage(data: data), image.isValid
        else { continue }
        loaded = Loaded(image: image, source: source)
        return
      } catch {
        // Missing, unsupported or unreachable artwork simply advances to the next source.
      }
    }
  }
}

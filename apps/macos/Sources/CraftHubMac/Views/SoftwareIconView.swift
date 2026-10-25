import AppKit
import CraftHubMacCore
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

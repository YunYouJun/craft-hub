import CraftHubMacCore
import SwiftUI

/// Website artwork keeps its original colors; declarations remain a fallback when artwork is unavailable.
struct NavigationIconView: View {
  let icon: String?
  var website: String = ""
  var size: CGFloat = 36
  @State private var loader = SoftwareIconLoader()
  private var artwork: SoftwareArtwork { SoftwareArtwork(website: website, iconURL: icon) }
  private var emoji: String? {
    guard let icon, icon.hasPrefix("emoji:") else { return nil }
    let value = String(icon.dropFirst(6))
    return value.isEmpty ? nil : value
  }
  private var symbol: String {
    let symbols = [
      "workspace": "square.grid.2x2", "folder": "folder", "hub": "point.3.connected.trianglepath.dotted",
      "briefcase": "briefcase", "code": "chevron.left.forwardslash.chevron.right", "docs": "doc.text",
      "design": "paintbrush", "database": "externaldrive", "package": "shippingbox", "rocket": "paperplane",
      "team": "person.2", "experiment": "flask", "security": "lock.shield", "cloud": "cloud",
      "mobile": "iphone", "web": "globe", "terminal": "terminal", "skill": "sparkles",
      "settings": "gearshape", "calendar": "calendar", "chart": "chart.bar", "list": "list.bullet",
      "codex": "sparkles", "play": "play", "gitRepository": "point.3.connected.trianglepath.dotted",
    ]
    guard let icon, icon.hasPrefix("builtin:") else { return "globe" }
    return symbols[String(icon.dropFirst(8))] ?? "globe"
  }
  var body: some View {
    ZStack {
      if let loaded = loader.loaded, artwork.sources.contains(loaded.source) {
        Image(nsImage: loaded.image).renderingMode(.original).resizable().scaledToFit().padding(3)
          .background(.white, in: RoundedRectangle(cornerRadius: size * 0.22))
      } else {
        RoundedRectangle(cornerRadius: size * 0.22).fill(.quaternary)
        if let emoji {
          Text(emoji).font(.system(size: size * 0.52)).lineLimit(1)
        } else {
          Image(systemName: symbol).font(.system(size: size * 0.52)).foregroundStyle(.secondary)
        }
      }
    }.frame(width: size, height: size).accessibilityHidden(true)
      .task(id: artwork) { await loader.load(artwork) }
  }
}

import CraftHubMacCore
import SwiftUI

/// Website artwork keeps its original colors; declarations remain a fallback when artwork is unavailable.
struct NavigationIconView: View {
  let icon: String?
  var website: String = ""
  var size: CGFloat = 36
  var framed = true
  @State private var loader = SoftwareIconLoader()
  @State private var embeddedImage: NSImage?
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
      if let embeddedImage {
        Image(nsImage: embeddedImage).renderingMode(.original).resizable().scaledToFit()
      } else if let loaded = loader.loaded, artwork.sources.contains(loaded.source) {
        Image(nsImage: loaded.image).renderingMode(.original).resizable().scaledToFit().padding(framed ? 3 : 0)
          .background(framed ? .white : .clear, in: RoundedRectangle(cornerRadius: size * 0.22))
      } else {
        if framed { RoundedRectangle(cornerRadius: size * 0.22).fill(.quaternary) }
        if let emoji {
          Text(emoji).font(.system(size: size * 0.52)).lineLimit(1)
        } else {
          Image(systemName: symbol).font(.system(size: size * (framed ? 0.52 : 0.85))).foregroundStyle(.secondary)
        }
      }
    }.frame(width: size, height: size).accessibilityHidden(true)
      .task(id: artwork) { await loader.load(artwork) }
      .task(id: icon) { embeddedImage = InlineIconArtwork.image(icon) }
  }
}

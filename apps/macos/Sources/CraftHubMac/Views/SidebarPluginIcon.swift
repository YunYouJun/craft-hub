import AppKit
import CraftHubMacCore
import SwiftUI

/// Sidebar artwork keeps the package image and follows the current navigation selection.
struct SidebarPluginIcon: View {
  let icon: String?
  let selected: Bool
  @State private var images: SidebarIconArtwork?
  @State private var loadedIcon: String?

  var body: some View {
    Group {
      if let images, loadedIcon == icon {
        Image(nsImage: selected ? images.original : images.grayscale)
          .renderingMode(.original).resizable().scaledToFit()
      } else {
        Image(systemName: "rectangle.3.group").font(.system(size: 13)).foregroundStyle(.secondary)
      }
    }.frame(width: 18, height: 18).accessibilityHidden(true)
      .task(id: icon) {
        let requested = icon
        let image = await PluginIconCache.shared.image(for: PluginArtwork(icon: requested))
        guard !Task.isCancelled else { return }
        images = image.flatMap(SidebarIconArtwork.init)
        loadedIcon = requested
      }
  }
}

/// Keep grayscale on the sidebar presentation; the cached package artwork remains in its original colors.
struct SidebarIconArtwork {
  let original: NSImage
  let grayscale: NSImage

  init?(_ image: NSImage) {
    guard let source = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
      let context = CGContext(
        data: nil, width: source.width, height: source.height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    context.draw(source, in: CGRect(x: 0, y: 0, width: source.width, height: source.height))
    guard let gray = context.makeImage() else { return nil }
    original = image
    grayscale = NSImage(cgImage: gray, size: image.size)
  }
}

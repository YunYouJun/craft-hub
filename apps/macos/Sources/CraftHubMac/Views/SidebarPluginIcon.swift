import AppKit
import CraftHubMacCore
import SwiftUI

/// Sidebar template artwork and fallback symbols inherit the system's foreground and selection appearance.
struct SidebarPluginIcon: View {
  let icon: String?
  @State private var image: NSImage?
  @State private var loadedIcon: String?

  var body: some View {
    Group {
      if let image, loadedIcon == icon {
        Image(nsImage: image)
          .renderingMode(.template).resizable().scaledToFit()
      } else {
        Image(systemName: "rectangle.3.group")
      }
    }.frame(width: 18, height: 18).accessibilityHidden(true)
      .task(id: icon) {
        let requested = icon
        let image = await PluginIconCache.shared.image(for: PluginArtwork(icon: requested))
        guard !Task.isCancelled else { return }
        self.image = image
        loadedIcon = requested
      }
  }
}

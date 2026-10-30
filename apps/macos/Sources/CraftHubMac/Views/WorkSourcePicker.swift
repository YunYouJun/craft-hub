import AppKit
import CraftHubMacCore
import SwiftUI

/// Source artwork is shared by the segmented picker and its compact menu presentation.
struct WorkSourcePicker: View {
  let sources: [TodayFocusSnapshot.Source]
  @Binding var selection: String
  let segmented: Bool?
  @State private var images: [String: NSImage] = [:]
  private static let fallbackImage = sizedImage(NSImage(systemSymbolName: "checklist", accessibilityDescription: nil))
  private var title: String { L10n.text.copy("工作来源", "Work Source") }

  init(sources: [TodayFocusSnapshot.Source], selection: Binding<String>, segmented: Bool? = nil) {
    self.sources = sources
    _selection = selection
    self.segmented = segmented
  }

  var body: some View {
    WorkSourceControl(
      items: sources.map { .init(key: $0.key, title: $0.title, count: $0.count, image: image($0)) },
      selection: $selection, title: title, segmented: segmented
    ).task(id: sources.map(\.icon)) {
      for icon in Set(sources.compactMap(\.icon)) {
        let loaded = await PluginIconCache.shared.image(for: PluginArtwork(icon: icon))
        guard !Task.isCancelled else { return }
        images[icon] = Self.sizedImage(loaded)
      }
    }
  }

  private func image(_ source: TodayFocusSnapshot.Source) -> NSImage? {
    source.icon.flatMap { images[$0] } ?? Self.fallbackImage
  }

  private static func sizedImage(_ original: NSImage?) -> NSImage? {
    let image = original?.copy() as? NSImage
    image?.size = NSSize(width: 16, height: 16)
    return image
  }
}

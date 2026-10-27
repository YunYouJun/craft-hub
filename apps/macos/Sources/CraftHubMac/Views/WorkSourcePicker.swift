import AppKit
import CraftHubMacCore
import SwiftUI

/// Source artwork is shared by the segmented picker and its compact menu presentation.
struct WorkSourcePicker: View {
  let sources: [TodayFocusSnapshot.Source]
  @Binding var selection: String
  let segmented: Bool
  @State private var images: [String: NSImage] = [:]
  private var title: String { L10n.text.copy("工作来源", "Work Source") }

  var body: some View {
    Group {
      if segmented {
        SourceSegments(
          sources: sources, images: sources.map(image), selection: $selection, title: title
        ).fixedSize(horizontal: true, vertical: false)
      } else {
        Picker(title, selection: $selection) {
          ForEach(sources) { source in
            Label {
              Text("\(source.title) (\(source.count))")
            } icon: {
              if let image = image(source) { Image(nsImage: image) }
            }.tag(source.key)
          }
        }.labelsHidden().pickerStyle(.menu)
      }
    }.task(id: sources.map(\.icon)) {
      for icon in Set(sources.compactMap(\.icon)) {
        let loaded = await PluginIconCache.shared.image(for: PluginArtwork(icon: icon))
        guard !Task.isCancelled else { return }
        images[icon] = loaded
      }
    }
  }

  private func image(_ source: TodayFocusSnapshot.Source) -> NSImage? {
    let original =
      source.icon.flatMap { images[$0] } ?? NSImage(systemSymbolName: "checklist", accessibilityDescription: nil)
    let image = original?.copy() as? NSImage
    image?.size = NSSize(width: 16, height: 16)
    return image
  }
}

/// SwiftUI's segmented Picker extracts only text from Label, so set both native segment properties explicitly.
private struct SourceSegments: NSViewRepresentable {
  let sources: [TodayFocusSnapshot.Source]
  let images: [NSImage?]
  @Binding var selection: String
  let title: String

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeNSView(context: Context) -> NSSegmentedControl {
    let control = NSSegmentedControl()
    control.trackingMode = .selectOne
    control.target = context.coordinator
    control.action = #selector(Coordinator.selectSource(_:))
    return control
  }

  func updateNSView(_ control: NSSegmentedControl, context: Context) {
    context.coordinator.picker = self
    control.segmentCount = sources.count
    control.setAccessibilityLabel(title)
    for (index, source) in sources.enumerated() {
      control.setLabel("\(source.title) (\(source.count))", forSegment: index)
      control.setImage(images[index], forSegment: index)
      control.setImageScaling(.scaleProportionallyDown, forSegment: index)
    }
    control.selectedSegment = sources.firstIndex { $0.key == selection } ?? -1
    control.invalidateIntrinsicContentSize()
  }

  func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSSegmentedControl, context: Context) -> CGSize? {
    nsView.intrinsicContentSize
  }

  @MainActor final class Coordinator: NSObject {
    var picker: SourceSegments
    init(_ picker: SourceSegments) { self.picker = picker }

    @objc func selectSource(_ sender: NSSegmentedControl) {
      guard picker.sources.indices.contains(sender.selectedSegment) else { return }
      picker.selection = picker.sources[sender.selectedSegment].key
    }
  }
}

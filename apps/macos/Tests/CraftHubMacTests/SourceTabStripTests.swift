import AppKit
import QuartzCore
import Testing

@testable import CraftHubMac

@Suite(.serialized) @MainActor struct SourceTabStripTests {
  private let items = [
    WorkSourceControl.Item(key: "first", title: "First Source", count: 320, image: nil),
    WorkSourceControl.Item(key: "second", title: "Second Source", count: 26, image: nil),
    WorkSourceControl.Item(key: "third", title: "Empty Source", count: 0, image: nil),
  ]

  @Test func sourceStripUsesTheSystemSegmentedControlAndNativeSelectionActions() throws {
    let nativeView: NSView = SourceTabStripView()
    let view = try #require(nativeView as? NSSegmentedControl)
    let sourceView = try #require(view as? SourceTabStripView)
    sourceView.update(items: items, selection: "first", title: "Work Source")
    let systemControl = NSSegmentedControl()
    #expect(view.cell.map { type(of: $0) } == systemControl.cell.map { type(of: $0) })
    #expect(view.segmentStyle == .automatic)
    #expect(view.trackingMode == .selectOne)
    #expect(view.segmentCount == 3)
    #expect(view.subviews.compactMap { $0 as? NSButton }.isEmpty)
    var selected: [String] = []
    sourceView.onSelection = { selected.append($0) }
    sourceView.activateSegment(at: 2)
    #expect(sourceView.selectedKey == "third")
    #expect(view.selectedSegment == 2)
    #expect(selected == ["third"])
    sourceView.activateSegment(at: -1)
    view.setEnabled(false, forSegment: 1)
    sourceView.activateSegment(at: 1)
    #expect(selected == ["third"])
    sourceView.isEnabled = false
    sourceView.activateSegment(at: 0)
    #expect(selected == ["third"])
  }

  @Test func nativeSegmentContentsAndBadgesFitInBothAppearances() async throws {
    let image = try #require(NSImage(systemSymbolName: "checkmark.square.fill", accessibilityDescription: nil))
    image.size = NSSize(width: 16, height: 16)
    let selector = WorkSourceControlView()
    let view = selector.strip
    selector.update(
      items: [
        .init(key: "first", title: "Personal Tasks", count: 320, image: image),
        .init(key: "second", title: "较长的工作来源名称", count: 26, image: image),
        .init(key: "third", title: "Empty Source", count: 0, image: image),
      ], selection: "first", title: "Work Source", segmented: true)
    selector.setFrameSize(view.intrinsicContentSize)
    let container = NSView(
      frame: NSRect(x: 0, y: 0, width: selector.frame.width + 24, height: selector.frame.height + 24))
    container.wantsLayer = true
    let window = NSWindow(contentRect: container.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.contentView = container
    container.addSubview(selector)
    selector.setFrameOrigin(NSPoint(x: 12, y: 12))
    defer {
      window.close()
      window.contentView = nil
    }
    for appearance in [NSAppearance.Name.aqua, .darkAqua] {
      window.appearance = NSAppearance(named: appearance)
      container.appearance = NSAppearance(named: appearance)
      container.effectiveAppearance.performAsCurrentDrawingAppearance {
        container.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
      }
      container.layoutSubtreeIfNeeded()
      CATransaction.flush()
      try await Task.sleep(for: .milliseconds(40))
      let bitmap = try #require(container.bitmapImageRepForCachingDisplay(in: container.bounds))
      container.cacheDisplay(in: container.bounds, to: bitmap)
      let badges = selector.subviews.compactMap { $0 as? NSImageView }.filter {
        $0.identifier?.rawValue.hasPrefix("source-count-") == true
      }
      #expect(badges.count == view.segmentCount)
      let segments = try #require(view.cell?.accessibilityChildren() as? [NSAccessibilityProtocol])
      for (index, item) in view.items.enumerated() {
        let badge = try #require(badges.first { $0.identifier?.rawValue == "source-count-" + item.key })
        let segmentFrame = view.convert(window.convertFromScreen(segments[index].accessibilityFrame()), from: nil)
        let badgeFrame = view.convert(badge.frame, from: selector)
        #expect(view.bounds.contains(badgeFrame))
        #expect(abs(badgeFrame.midY - view.bounds.midY) < 0.25)
        #expect(segmentFrame.contains(badgeFrame))
        #expect(badge.hitTest(NSPoint(x: badge.bounds.midX, y: badge.bounds.midY)) == nil)
        #expect(badge.isAccessibilityElement() == false)
        #expect(badge.image?.isValid == true)
      }
      if let directory = ProcessInfo.processInfo.environment["CRAFT_HUB_SOURCE_PICKER_RENDER_DIR"] {
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        try png.write(
          to: URL(fileURLWithPath: directory).appendingPathComponent("native-segments-\(appearance.rawValue).png"))
      }
    }
  }

  @Test func countGrowthAndSourceReorderingKeepTheSelectedIdentity() throws {
    let view = SourceTabStripView()
    view.update(items: items, selection: "third", title: "Work Source")
    let oldWidth = view.intrinsicContentSize.width
    let changed = [
      WorkSourceControl.Item(key: "first", title: items[0].title, count: 123456, image: nil), items[1], items[2],
    ]
    view.update(items: changed, selection: "third", title: "Work Source")
    #expect(view.intrinsicContentSize.width > oldWidth)
    #expect(view.selectedSegment == 2)
    view.update(items: Array(changed.reversed()), selection: "third", title: "Work Source")
    #expect(view.selectedSegment == 0)
    #expect(view.selectedKey == "third")
    #expect(view.items.map(\.count) == [0, 26, 123456])
    view.update(items: [], selection: "third", title: "Work Source")
    #expect(view.segmentCount == 0)
    #expect(view.selectedKey.isEmpty)
  }

  @Test func nativeAccessibilityElementsRetainLabelsCountsAndSelection() throws {
    let view = SourceTabStripView()
    view.update(items: items, selection: "first", title: "Work Source")
    view.setFrameSize(view.intrinsicContentSize)
    let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.contentView = view
    defer {
      window.close()
      window.contentView = nil
    }
    let nativeGroups = try #require(view.accessibilityChildren() as? [NSCell])
    #expect(nativeGroups.count == 1)
    #expect(nativeGroups.first === view.cell)
    let children = try #require(view.cell?.accessibilityChildren() as? [NSAccessibilityProtocol])
    #expect(children.count == items.count)
    #expect(
      children.map { $0.accessibilityLabel() } == ["First Source", "Second Source", "Empty Source"])
    #expect(
      children.map { $0.accessibilityHelp() } == ["First Source (320)", "Second Source (26)", "Empty Source (0)"])
    var selected = ""
    view.onSelection = { selected = $0 }
    #expect(children.map { ($0.accessibilityValue() as? NSNumber)?.boolValue } == [true, false, false])
    view.activateSegment(at: 1)
    #expect(view.selectedSegment == 1)
    #expect(view.selectedKey == "second")
    #expect(selected == "second")
    #expect(children.map { ($0.accessibilityValue() as? NSNumber)?.boolValue } == [false, true, false])
  }

  @Test func badgeShapesKeepSingleAndDoubleDigitsCircular() {
    #expect(SourceCountBadge.size(count: 0) == NSSize(width: 17, height: 17))
    #expect(SourceCountBadge.size(count: 26) == NSSize(width: 17, height: 17))
    #expect(SourceCountBadge.size(count: 320).width > 17)
  }
}

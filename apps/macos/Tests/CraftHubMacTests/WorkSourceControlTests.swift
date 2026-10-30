import AppKit
import Testing

@testable import CraftHubMac

@Suite(.serialized) @MainActor struct WorkSourceControlTests {
  private func items() throws -> [WorkSourceControl.Item] {
    let first = try #require(NSImage(systemSymbolName: "checklist", accessibilityDescription: nil))
    let second = try #require(NSImage(systemSymbolName: "folder", accessibilityDescription: nil))
    first.size = NSSize(width: 16, height: 16)
    second.size = NSSize(width: 16, height: 16)
    return [
      .init(key: "first", title: "First Source", count: 320, image: first),
      .init(key: "second", title: "Second Source", count: 26, image: second),
      .init(key: "third", title: "Empty Source", count: 0, image: nil),
      .init(key: "fourth", title: "Quick Notes", count: 4, image: nil),
    ]
  }

  private func withControl(_ body: (WorkSourceControlView, NSWindow, [WorkSourceControl.Item]) throws -> Void) throws {
    let items = try items()
    let view = WorkSourceControlView()
    view.update(items: items, selection: "first", title: "Work Source", segmented: nil)
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: view.intrinsicContentSize.width + 20, height: 36),
      styleMask: [.borderless], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.contentView = view
    defer {
      window.close()
      window.contentView = nil
    }
    view.layoutSubtreeIfNeeded()
    try body(view, window, items)
  }

  private func resize(_ window: NSWindow, view: WorkSourceControlView, width: CGFloat) {
    window.setContentSize(NSSize(width: width, height: 36))
    view.needsLayout = true
    view.layoutSubtreeIfNeeded()
  }

  @Test func nativePopupActionsSurviveNarrowAndWideWindowResizing() throws {
    try withControl { view, window, _ in
      #expect(view.popup == nil)
      #expect(!view.showsPopup)
      #expect(!view.strip.isHidden)
      #expect(view.accessibilityRole() == .group)
      #expect((view.accessibilityChildren()?.first as? NSAccessibilityProtocol)?.accessibilityRole() == .radioGroup)
      let fittingWidth = view.strip.intrinsicContentSize.width
      resize(window, view: view, width: fittingWidth / 2)
      let popup = try #require(view.popup)
      #expect(view.showsPopup)
      #expect(view.strip.isHidden)
      #expect(!popup.isHidden)
      #expect((view.accessibilityChildren()?.first as? NSAccessibilityProtocol)?.accessibilityRole() == .popUpButton)
      #expect(view.bounds.contains(popup.frame))
      #expect(popup.titleOfSelectedItem == "First Source (320)")
      var selected: [String] = []
      view.onSelection = { selected.append($0) }
      popup.selectItem(at: 1)
      #expect(popup.sendAction(popup.action, to: popup.target))
      #expect(selected == ["second"])
      #expect(view.strip.selectedKey == "second")
      resize(window, view: view, width: fittingWidth + 20)
      #expect(!view.showsPopup)
      #expect(!view.strip.isHidden)
      #expect(popup.isHidden)
      #expect(view.strip.selectedKey == "second")
      #expect(view.popup === popup)
      view.strip.activateSegment(at: 3)
      #expect(selected == ["second", "fourth"])
      resize(window, view: view, width: fittingWidth / 2)
      #expect(popup.titleOfSelectedItem == "Quick Notes (4)")
      #expect(popup.toolTip == "Quick Notes (4)")
    }
  }

  @Test func metadataChangesRetainSelectedIdentityAndUpdatePopupArtworkAndCounts() throws {
    try withControl { view, window, items in
      let oldWidth = view.strip.intrinsicContentSize.width
      resize(window, view: view, width: oldWidth / 2)
      let popup = try #require(view.popup)
      #expect(
        popup.itemArray.map(\.title) == [
          "First Source (320)", "Second Source (26)", "Empty Source (0)", "Quick Notes (4)",
        ])
      #expect(popup.itemArray[0].image === items[0].image)
      #expect(popup.itemArray[1].image === items[1].image)
      #expect(popup.itemArray[0].image?.tiffRepresentation != popup.itemArray[1].image?.tiffRepresentation)
      view.update(items: items, selection: "second", title: "Work Source", segmented: nil)
      let changed = [
        items[2],
        WorkSourceControl.Item(key: "first", title: items[0].title, count: 123456, image: items[1].image),
        items[1], items[3],
      ]
      view.update(items: changed, selection: "second", title: "Updated Work Source", segmented: nil)
      view.layoutSubtreeIfNeeded()
      #expect(view.popup === popup)
      #expect(view.strip.intrinsicContentSize.width > oldWidth)
      #expect(view.strip.selectedKey == "second")
      #expect(view.strip.selectedSegment == 2)
      #expect(popup.indexOfSelectedItem == 2)
      #expect(popup.titleOfSelectedItem == "Second Source (26)")
      #expect(popup.itemArray[1].title == "First Source (123456)")
      #expect(popup.itemArray[1].image === items[1].image)
      #expect(popup.accessibilityLabel() == "Updated Work Source")
      resize(window, view: view, width: view.strip.intrinsicContentSize.width + 20)
      #expect(!view.showsPopup)
      #expect(view.strip.selectedKey == "second")
    }
  }

  @Test func unusedMenuIsLazyAndSelectionChangesDoNotRebuildItsNativeItems() throws {
    let items = try items()
    let view = WorkSourceControlView()
    view.update(items: items, selection: "first", title: "Work Source", segmented: nil)
    let ideal = view.strip.intrinsicContentSize
    #expect(view.fittingSize(availableWidth: nil).width == ideal.width)
    #expect(view.fittingSize(availableWidth: .infinity).width == ideal.width)
    #expect(view.fittingSize(availableWidth: ideal.width + 20).width == ideal.width)
    #expect(view.fittingSize(availableWidth: 0).width == 0)
    #expect(view.popup == nil)
    let compact = view.fittingSize(availableWidth: ideal.width / 2)
    let popup = try #require(view.popup)
    #expect(compact.width <= ideal.width / 2)
    #expect(popup.isHidden)
    let nativeItems = popup.itemArray
    var callbacks = 0
    view.onSelection = { _ in callbacks += 1 }
    for selection in ["second", "third", "first", "fourth"] {
      view.update(items: items, selection: selection, title: "Work Source", segmented: nil)
      #expect(view.strip.selectedKey == selection)
      #expect(popup.selectedItem?.representedObject as? String == selection)
      #expect(zip(nativeItems, popup.itemArray).allSatisfy { $0 === $1 })
    }
    #expect(callbacks == 0)
  }

  @Test func equalSourceTitlesAndCountsKeepDistinctMenuIdentities() throws {
    let view = WorkSourceControlView()
    view.update(
      items: [
        .init(key: "first-account", title: "Project Tasks", count: 0, image: nil),
        .init(key: "second-account", title: "Project Tasks", count: 0, image: nil),
      ], selection: "first-account", title: "Work Source", segmented: false)
    let popup = try #require(view.popup)
    #expect(popup.numberOfItems == 2)
    #expect(popup.itemArray.map(\.title) == ["Project Tasks (0)", "Project Tasks (0)"])
    var selected = ""
    view.onSelection = { selected = $0 }
    popup.selectItem(at: 1)
    #expect(popup.sendAction(popup.action, to: popup.target))
    #expect(selected == "second-account")
    #expect(view.strip.selectedKey == "second-account")
  }
}

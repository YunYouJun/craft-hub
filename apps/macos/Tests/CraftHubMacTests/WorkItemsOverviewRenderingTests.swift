import AppKit
import CraftHubMacCore
import Foundation
import SwiftUI
import Testing

@testable import CraftHubMac

private func overviewSnapshot() throws -> TodayFocusSnapshot {
  let svg = Data(
    #"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>"#
      .utf8)
  let sources: [[String: Any]] = [
    [
      "key": "first", "title": "First Source", "count": 320,
      "icon": "data:image/svg+xml;base64," + svg.base64EncodedString(),
    ],
    ["key": "second", "title": "Second Source", "count": 26],
    ["key": "third", "title": "Third Source", "count": 0],
    ["key": "fourth", "title": "Fourth Source", "count": 4],
  ].map {
    $0.merging(["path": "/integrations/fixture/items", "state": "loaded", "complete": true, "cached": false]) { a, _ in
      a
    }
  }
  return try JSONDecoder().decode(
    TodayFocusSnapshot.self,
    from: JSONSerialization.data(withJSONObject: [
      "version": 1, "checkedAt": "2026-10-27T00:00:00Z", "sourceCount": sources.count,
      "total": 350, "sources": sources, "items": [], "candidates": [],
    ]))
}

@MainActor private func overviewControls<T: NSView>(_ type: T.Type, in view: NSView) -> [T] {
  (view as? T).map { [$0] } ?? view.subviews.flatMap { overviewControls(type, in: $0) }
}

@MainActor @Test func overviewSourceSegmentsShowArtworkAndFallbackAlongsideCounts() async throws {
  let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 1100, height: 500), styleMask: [.titled, .closable], backing: .buffered,
    defer: false)
  window.isReleasedWhenClosed = false
  defer {
    window.close()
    window.contentView = nil
  }
  let hosting = NSHostingView(
    rootView: WorkItemsOverviewView(
      snapshot: try overviewSnapshot(), loading: false, navigate: { _ in }, refresh: {}, showWorkbench: {},
      workItemActions: WorkItemQuickActionsModel()))
  window.contentView = hosting
  hosting.layoutSubtreeIfNeeded()
  try await Task.sleep(for: .milliseconds(100))
  hosting.layoutSubtreeIfNeeded()
  let control = try #require(overviewControls(NSSegmentedControl.self, in: hosting).first)
  #expect(control.segmentCount == 4)
  #expect(control.label(forSegment: 0) == "First Source (320)")
  #expect(control.label(forSegment: 1) == "Second Source (26)")
  #expect(control.image(forSegment: 0)?.isValid == true)
  #expect(control.image(forSegment: 1)?.isValid == true)
  #expect(control.image(forSegment: 0)?.tiffRepresentation != control.image(forSegment: 1)?.tiffRepresentation)
  control.selectedSegment = 1
  #expect(control.sendAction(control.action, to: control.target))
  try await Task.sleep(for: .milliseconds(50))
  window.setContentSize(NSSize(width: 400, height: 500))
  hosting.layoutSubtreeIfNeeded()
  try await Task.sleep(for: .milliseconds(100))
  hosting.layoutSubtreeIfNeeded()
  let menu = try #require(overviewControls(NSPopUpButton.self, in: hosting).first)
  #expect(menu.titleOfSelectedItem == "Second Source (26)")
  let firstItem = try #require(menu.itemArray.first { $0.title == "First Source (320)" })
  let secondItem = try #require(menu.itemArray.first { $0.title == "Second Source (26)" })
  #expect(firstItem.image?.isValid == true)
  #expect(secondItem.image?.isValid == true)
  #expect(firstItem.image?.tiffRepresentation != secondItem.image?.tiffRepresentation)
}

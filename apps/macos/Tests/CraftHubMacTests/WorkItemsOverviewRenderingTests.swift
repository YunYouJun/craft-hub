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
  let control = try #require(overviewControls(SourceTabStripView.self, in: hosting).first)
  #expect(control.items.count == 4)
  #expect(control.items[0].title == "First Source")
  #expect(control.items[0].count == 320)
  #expect(control.items[1].title == "Second Source")
  #expect(control.items[1].count == 26)
  #expect(control.items[0].image?.isValid == true)
  #expect(control.items[1].image?.isValid == true)
  #expect(control.items[0].image?.tiffRepresentation != control.items[1].image?.tiffRepresentation)
  control.activateSegment(at: 1)
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

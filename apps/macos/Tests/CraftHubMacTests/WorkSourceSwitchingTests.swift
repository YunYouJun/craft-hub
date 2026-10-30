import AppKit
import CraftHubMacCore
import Foundation
import Observation
import SwiftUI
import Testing

@testable import CraftHubMac

private func switchingSnapshot(
  firstAccount: String = "fixture-account", includesFirst: Bool = true, collectionCount: Int = 1,
  disconnectedSecond: Bool = false
) throws
  -> TodayFocusSnapshot
{
  let sources: [[String: Any]] = zip(["first", "second", "third", "fourth"], [320, 26, 0, 4]).compactMap { key, count in
    guard includesFirst || key != "first" else { return nil }
    let items: [[String: Any]] = (0..<count).map { index in
      [
        "key": "\(key)-\(index)", "title": "\(key) task \(index)",
        "collectionKey": "\(key)-list-\(index % collectionCount)", "categories": [],
      ]
    }
    var source: [String: Any] = [
      "key": key, "title": "\(key.capitalized) Source", "count": count,
      "path": "/integrations/fixture/\(key)", "state": "loaded", "complete": true, "cached": false,
      "browser": [
        "accountKey": key == "first" ? firstAccount : "fixture-account", "projectMode": false,
        "collections": (0..<collectionCount).map {
          ["key": "\(key)-list-\($0)", "title": "\(key.capitalized) List \($0)"]
        },
        "items": items,
      ],
    ]
    if disconnectedSecond && key == "second" {
      source["state"] = "disconnected"
      source["count"] = 0
      source.removeValue(forKey: "browser")
    }
    return source
  }
  return try JSONDecoder().decode(
    TodayFocusSnapshot.self,
    from: JSONSerialization.data(withJSONObject: [
      "version": 1, "checkedAt": "2026-10-28T00:00:00Z", "sourceCount": sources.count,
      "total": includesFirst ? 350 : 30, "sources": sources, "items": [], "candidates": [],
    ]))
}

@MainActor @Observable private final class SourceSwitchingFixture {
  var snapshot: TodayFocusSnapshot
  let actions = WorkItemQuickActionsModel()

  init() throws { snapshot = try switchingSnapshot() }
}

@MainActor private struct SourceSwitchingHost: View {
  let fixture: SourceSwitchingFixture

  var body: some View {
    WorkItemsOverviewView(
      snapshot: fixture.snapshot, loading: false, navigate: { _ in }, refresh: {}, showWorkbench: {},
      workItemActions: fixture.actions)
  }
}

@MainActor private func switchingControls<T: NSView>(_ type: T.Type, in view: NSView) -> [T] {
  guard !view.isHidden else { return [] }
  return (view as? T).map { [$0] } ?? view.subviews.flatMap { switchingControls(type, in: $0) }
}

@MainActor private func switchingSearch(in view: NSView) throws -> NSTextField {
  try #require(
    switchingControls(NSTextField.self, in: view).first {
      $0.placeholderString == "Search Lists and Tasks" || $0.placeholderString == "搜索列表和待办"
    })
}

@MainActor private func settleSwitchingLayout(_ hosting: NSView) async throws {
  try await Task.sleep(for: .milliseconds(30))
  hosting.layoutSubtreeIfNeeded()
}

@MainActor private func withSwitchingOverview(
  _ body: (SourceSwitchingFixture, NSHostingView<SourceSwitchingHost>) async throws -> Void
) async throws {
  let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 1100, height: 650), styleMask: [.titled, .closable], backing: .buffered,
    defer: false)
  window.isReleasedWhenClosed = false
  defer {
    window.close()
    window.contentView = nil
  }
  let fixture = try SourceSwitchingFixture()
  let hosting = NSHostingView(rootView: SourceSwitchingHost(fixture: fixture))
  window.contentView = hosting
  hosting.layoutSubtreeIfNeeded()
  try await settleSwitchingLayout(hosting)
  try await body(fixture, hosting)
}

@MainActor private func setSwitchingQuery(_ query: String, in hosting: NSView) async throws {
  let field = try switchingSearch(in: hosting)
  field.stringValue = query
  field.delegate?.controlTextDidChange?(
    Notification(name: NSControl.textDidChangeNotification, object: field))
  try await settleSwitchingLayout(hosting)
  #expect(try switchingSearch(in: hosting).stringValue == query)
}

@MainActor private func selectSwitchingSource(_ index: Int, in hosting: NSView) async throws -> Double {
  let control = try #require(switchingControls(SourceTabStripView.self, in: hosting).first)
  let started = ProcessInfo.processInfo.systemUptime
  control.activateSegment(at: index)
  hosting.layoutSubtreeIfNeeded()
  let milliseconds = (ProcessInfo.processInfo.systemUptime - started) * 1000
  try await settleSwitchingLayout(hosting)
  #expect(
    try #require(switchingControls(SourceTabStripView.self, in: hosting).first).selectedKey == control.items[index].key)
  return milliseconds
}

@Suite(.serialized) @MainActor struct WorkSourceSwitchingTests {
  @Test func overviewSourceSwitchingThroughAnUnconnectedSourcePreservesTheOtherSourcesSearch() async throws {
    try await withSwitchingOverview { fixture, hosting in
      fixture.snapshot = try switchingSnapshot(disconnectedSecond: true)
      try await settleSwitchingLayout(hosting)
      try await setSwitchingQuery("first task 17", in: hosting)
      let container = try #require(switchingControls(WorkSourceBrowserContainer.self, in: hosting).first)
      let firstHost = try #require(container.activeHostingView)
      _ = try await selectSwitchingSource(1, in: hosting)
      #expect(switchingControls(WorkSourceBrowserContainer.self, in: hosting).count == 1)
      #expect(
        switchingControls(NSTextField.self, in: hosting).allSatisfy {
          !["Search Lists and Tasks", "搜索列表和待办"].contains($0.placeholderString ?? "")
        })
      #expect(container.activeHostingView == nil)
      _ = try await selectSwitchingSource(0, in: hosting)
      #expect(try switchingSearch(in: hosting).stringValue == "first task 17")
      #expect(switchingControls(WorkSourceBrowserContainer.self, in: hosting).first === container)
      #expect(container.activeHostingView === firstHost)
    }
  }

  @Test func overviewSourceSwitchingPreservesEachSourcesSearchAndNativeTables() async throws {
    try await withSwitchingOverview { _, hosting in
      let firstTableViews = switchingControls(NSTableView.self, in: hosting)
      #expect(firstTableViews.count == 2)
      try await setSwitchingQuery("first task 17", in: hosting)

      var layoutMilliseconds: [Double] = []
      var queries = [0: "first task 17"]
      var retainedTables = [0: firstTableViews]
      for index in [1, 2, 3, 0, 1, 2, 3, 0] {
        layoutMilliseconds.append(try await selectSwitchingSource(index, in: hosting))
        let currentQuery = try switchingSearch(in: hosting).stringValue
        #expect(currentQuery == (queries[index] ?? ""))
        if queries[index] == nil {
          let query = index == 2 ? "empty source filter" : "\(index == 1 ? "second" : "fourth") task 1"
          try await setSwitchingQuery(query, in: hosting)
          queries[index] = query
        }
        let current = switchingControls(NSTableView.self, in: hosting)
        if let original = retainedTables[index] {
          #expect(Set(current.map(ObjectIdentifier.init)) == Set(original.map(ObjectIdentifier.init)))
        } else {
          retainedTables[index] = current
        }
      }
      // These samples cover action dispatch and immediate layout, not display refresh or screen frame latency.
      print(
        "Source switch action/immediate-layout ms: \(layoutMilliseconds); retained table views: \(firstTableViews.count)"
      )
      let returningQuery = try switchingSearch(in: hosting).stringValue
      #expect(returningQuery == "first task 17")
    }
  }

  @Test func overviewSourceSwitchingAccountClearsThePreviousAccountsSearch() async throws {
    try await withSwitchingOverview { fixture, hosting in
      try await setSwitchingQuery("first task 17", in: hosting)
      fixture.snapshot = try switchingSnapshot(firstAccount: "different-fixture-account")
      try await settleSwitchingLayout(hosting)
      #expect(try switchingSearch(in: hosting).stringValue.isEmpty)
      try await setSwitchingQuery("new account filter", in: hosting)
      fixture.snapshot = try switchingSnapshot()
      try await settleSwitchingLayout(hosting)
      #expect(try switchingSearch(in: hosting).stringValue.isEmpty)
    }
  }

  @Test func overviewSourceSwitchingRemovedSourcesDoNotRecoverStaleSearch() async throws {
    try await withSwitchingOverview { fixture, hosting in
      try await setSwitchingQuery("first task 17", in: hosting)
      fixture.snapshot = try switchingSnapshot(includesFirst: false)
      try await settleSwitchingLayout(hosting)
      #expect(try #require(switchingControls(SourceTabStripView.self, in: hosting).first).items.count == 3)
      #expect(try switchingSearch(in: hosting).stringValue.isEmpty)
      fixture.snapshot = try switchingSnapshot()
      try await settleSwitchingLayout(hosting)
      #expect(try #require(switchingControls(SourceTabStripView.self, in: hosting).first).items.count == 4)
      #expect(try switchingSearch(in: hosting).stringValue.isEmpty)
    }
  }

  @Test func overviewSourceSwitchingNativeCollectionSelectionPersistsAndFiltersRows() async throws {
    try await withSwitchingOverview { fixture, hosting in
      fixture.snapshot = try switchingSnapshot(collectionCount: 3)
      try await settleSwitchingLayout(hosting)
      let tables = switchingControls(NSTableView.self, in: hosting).sorted { $0.frame.width < $1.frame.width }
      #expect(tables.count == 2)
      let sidebar = try #require(tables.first)
      let results = try #require(tables.last)
      let allRow = sidebar.selectedRow
      let initialResultRows = results.numberOfRows
      #expect(allRow >= 0)
      let collectionRow = allRow + 2
      #expect(collectionRow < sidebar.numberOfRows)
      sidebar.selectRowIndexes(IndexSet(integer: collectionRow), byExtendingSelection: false)
      sidebar.delegate?.tableViewSelectionDidChange?(
        Notification(name: NSTableView.selectionDidChangeNotification, object: sidebar))
      let immediateSelectedRow = sidebar.selectedRow
      try await settleSwitchingLayout(hosting)
      let browser = try #require(fixture.snapshot.sources.first?.browser)
      let expectedCollectionItems = browser.items.filter { $0.collectionKey == "first-list-1" }.count
      print(
        "Native collection selection: all row \(allRow), requested \(collectionRow), immediate \(immediateSelectedRow), "
          + "settled \(sidebar.selectedRow); result rows \(initialResultRows) -> \(results.numberOfRows), "
          + "expected \(expectedCollectionItems + 1)")
      #expect(sidebar.selectedRow == collectionRow)
      #expect(results.numberOfRows == expectedCollectionItems + 1)
      for index in [1, 2, 0] {
        _ = try await selectSwitchingSource(index, in: hosting)
        let activeSidebar = try #require(
          switchingControls(NSTableView.self, in: hosting).min { $0.frame.width < $1.frame.width })
        #expect(activeSidebar.selectedRow == (index == 0 ? collectionRow : allRow))
        if index == 0 { #expect(activeSidebar === sidebar) }
      }
      #expect(results.numberOfRows == expectedCollectionItems + 1)
    }
  }
}

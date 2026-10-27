import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private func browserFixture() throws -> TodayWorkBrowser {
  let collections = (1...4).map { ["key": "list-\($0)", "title": $0 == 1 ? "Design" : "List \($0)"] }
  let items = (1...4).flatMap { list in
    (1...4).map { index in
      [
        "key": "\(list)-\(index)", "title": "Task \(index)", "collectionKey": "list-\(list)",
        "categories": index == 1 ? ["important"] : [],
      ] as [String: Any]
    }
  }
  return try JSONDecoder().decode(
    TodayWorkBrowser.self,
    from: JSONSerialization.data(withJSONObject: ["projectMode": false, "collections": collections, "items": items]))
}

@MainActor @Test func nativeTaskOverviewSamplesGroupsButExplicitFiltersShowEveryMatch() throws {
  let browser = try browserFixture()
  var selection = WorkItemsBrowserSelection()
  #expect(selection.visibleGroups(browser).count == 3)
  #expect(selection.visibleGroups(browser).allSatisfy { $0.items.count == 2 })
  selection.collection = "list-1"
  #expect(selection.visibleGroups(browser).first?.items.count == 4)
  selection.collection = nil
  selection.query = "Design"
  #expect(selection.matchingItems(browser).count == 4)
  #expect(selection.visibleGroups(browser).first?.items.count == 4)
  selection.query = ""
  selection.category = "important"
  #expect(selection.visibleGroups(browser).count == 4)
  #expect(selection.visibleGroups(browser).allSatisfy { $0.items.count == 1 })
  selection.category = "all"
  selection.expanded = true
  #expect(selection.visibleGroups(browser).flatMap(\.items).count == 16)
  selection.groupByList = false
  #expect(selection.visibleGroups(browser).count == 1)
  #expect(selection.visibleGroups(browser).first?.items.count == 16)
}

@MainActor @Test func nativeTaskBrowserKeepsUnlistedTasksVisibleAndAcceptsOldSnapshots() throws {
  let browser = try JSONDecoder().decode(
    TodayWorkBrowser.self,
    from: Data(
      #"{"projectMode":false,"collections":[],"items":[{"key":"one","title":"Unlisted","categories":[]}]}"#.utf8))
  #expect(WorkItemsBrowserSelection().groups(browser).first?.items.first?.title == "Unlisted")
  let snapshot = try JSONDecoder().decode(
    TodayFocusSnapshot.self,
    from: Data(
      #"{"version":1,"checkedAt":"2026-10-26T00:00:00Z","sourceCount":1,"total":0,"sources":[{"key":"source","title":"Tasks","path":"/tasks","state":"loaded","complete":true,"cached":false,"count":0}],"items":[],"candidates":[]}"#
        .utf8))
  #expect(snapshot.sources.first?.browser == nil)
}

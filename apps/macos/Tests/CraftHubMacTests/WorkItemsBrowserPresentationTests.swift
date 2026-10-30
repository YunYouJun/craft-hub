import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private func presentationBrowser() throws -> TodayWorkBrowser {
  try JSONDecoder().decode(
    TodayWorkBrowser.self,
    from: Data(
      #"""
      {"projectMode":false,"collections":[
        {"key":"design","title":"Design"},{"key":"build","title":"Build"},{"key":"empty","title":"Empty"}],
      "items":[
        {"key":"one","title":"Review task","collectionKey":"design","categories":["important","important"]},
        {"key":"two","title":"Review build","collectionKey":"build","categories":["planned"]},
        {"key":"three","title":"Other task","collectionKey":"build","categories":[]},
        {"key":"four","title":"Unlisted review","categories":["important"]}]}
      """#.utf8))
}

@MainActor @Test func browserPresentationKeepsSidebarAndCategoryCountsIndependentOfCollectionSelection() throws {
  let browser = try presentationBrowser()
  var selection = WorkItemsBrowserSelection()
  selection.query = "review"
  selection.collection = "design"
  let presentation = selection.presentation(browser)
  #expect(presentation.matching.map(\.key) == ["one", "two", "four"])
  #expect(presentation.groups.flatMap(\.items).map(\.key) == ["one"])
  #expect(presentation.collectionCounts == ["design": 1, "build": 1])
  #expect(presentation.categoryCounts == ["all": 4, "important": 2, "planned": 1])
  #expect(presentation.lists.map(\.key) == ["design", "build"])
  #expect(presentation.total == 1 && presentation.shown == 1)
}

@MainActor @Test func browserPresentationPreservesSelectedEmptyListsAndUnlistedTasks() throws {
  let browser = try presentationBrowser()
  var selection = WorkItemsBrowserSelection()
  selection.showEmptyLists = false
  let presentation = selection.presentation(browser)
  #expect(presentation.lists.map(\.key) == ["design", "build"])
  #expect(presentation.groups.map(\.id) == ["design", "build", "other"])
  #expect(presentation.visibleGroups.flatMap(\.items).map(\.key) == ["one", "two", "three", "four"])
  #expect(presentation.total == 4 && presentation.shown == 4)
  selection.collection = "empty"
  let empty = selection.presentation(browser)
  #expect(empty.lists.map(\.key) == ["design", "build", "empty"])
  #expect(empty.groups.isEmpty && empty.total == 0 && empty.shown == 0)
  selection.collection = nil
  selection.groupByList = false
  let flat = selection.presentation(browser)
  #expect(flat.groups.map(\.id) == ["flat"])
  #expect(flat.visibleGroups.flatMap(\.items).map(\.key) == ["one", "two", "three", "four"])
}

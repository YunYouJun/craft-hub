import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private func descriptionPage(_ descriptions: [(String, String?)], user: String = "first") throws
  -> IntegrationPresentation.Page
{
  let items: [[String: Any]] = descriptions.map { key, description in
    var item: [String: Any] = ["id": key, "key": key, "title": key, "active": true, "personal": true]
    if let description { item["description"] = description }
    return item
  }
  return try JSONDecoder().decode(
    IntegrationPresentation.Page.self,
    from: JSONSerialization.data(withJSONObject: ["items": items, "currentUser": ["id": user]]))
}

@MainActor @Test func integrationDescriptionPreviewsAreBoundedWithoutTruncatingSearchOrDetails() throws {
  var converted: [String] = []
  let state = IntegrationBlockState(renderDescription: {
    converted.append($0)
    return WorkItemText.plainDescription($0)
  })
  let source = "<p>" + String(repeating: "Long description ", count: 5000) + "</p>search-only-tail"
  state.page = try descriptionPage([("long", source)])
  let item = try #require(state.page?.items.first)
  let preview = try #require(state.descriptionPreview(for: item))
  #expect(preview.count == 512 && preview.hasSuffix("…"))
  #expect(converted.count == 1 && converted[0].count == 32_768)
  #expect(item.description == source)
  state.query = "search-only-tail"
  #expect(state.visibleItems.map(\.key) == ["long"])
  #expect(state.descriptionPreview(for: item) == preview)
  #expect(converted.count == 1)
}

@MainActor @Test func integrationDescriptionPreviewsFollowReplacementsPaginationAndClearedPages() throws {
  var conversions = 0
  let state = IntegrationBlockState(renderDescription: {
    conversions += 1
    return WorkItemText.plainDescription($0)
  })
  state.page = try descriptionPage([("one", "<p>First</p>")])
  let oldItem = try #require(state.page?.items.first)
  #expect(state.descriptionPreview(for: oldItem) == "First")
  state.page = try descriptionPage([("one", "<p>First</p>"), ("two", "<p>Second</p>")])
  #expect(conversions == 2)
  state.page = try descriptionPage([("one", "<p>Changed</p>"), ("two", "<p>Second</p>")])
  #expect(conversions == 3)
  #expect(state.descriptionPreview(for: oldItem) == nil)
  let updatedItem = try #require(state.page?.items.first)
  #expect(state.descriptionPreview(for: updatedItem) == "Changed")
  state.page = try descriptionPage([("one", nil)])
  #expect(state.descriptionPreview(for: updatedItem) == nil)
  state.page = nil
  #expect(state.descriptionPreview(for: oldItem) == nil)
  state.page = try descriptionPage([("one", "<p>First</p>")])
  #expect(conversions == 4)
  #expect(state.descriptionPreview(for: try #require(state.page?.items.first)) == "First")
  state.page = try descriptionPage([("one", "<p>First</p>")], user: "second")
  #expect(conversions == 5)
  state.page?.items[0] = updatedItem
  #expect(conversions == 6)
  #expect(state.descriptionPreview(for: updatedItem) == "Changed")
}

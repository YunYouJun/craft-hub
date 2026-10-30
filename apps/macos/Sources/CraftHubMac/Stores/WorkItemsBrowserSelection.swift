import CraftHubMacCore
import Foundation

/// Window-local presentation state; filtering never reads another page or invokes a provider action.
@MainActor struct WorkItemsBrowserSelection {
  var query = ""
  var category = "all"
  var collection: String?
  var expanded = false
  var allLists = false
  var groupByList = true
  var compact = false
  var showEmptyLists = true
  var collapsed = Set<String>()

  struct Group: Identifiable {
    let id: String
    let title: String
    let items: [TodayWorkBrowser.Item]
  }

  /// One render's derived rows and counts, shared by the sidebar, results and footer.
  struct Presentation {
    let matching: [TodayWorkBrowser.Item]
    let groups: [Group]
    let visibleGroups: [Group]
    let lists: [TodayWorkBrowser.Collection]
    let collectionCounts: [String: Int]
    let categoryCounts: [String: Int]
    let total: Int
    let shown: Int
  }

  func presentation(_ browser: TodayWorkBrowser) -> Presentation {
    let matching = matchingItems(browser)
    let groups = groups(browser, matching: matching)
    let visible = visibleGroups(groups)
    let collectionCounts = matching.reduce(into: [String: Int]()) { counts, item in
      if let key = item.collectionKey { counts[key, default: 0] += 1 }
    }
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let lists = browser.collections.filter {
      (showEmptyLists || collectionCounts[$0.key] != nil || collection == $0.key)
        && (query.isEmpty || $0.title.localizedStandardContains(query) || collectionCounts[$0.key] != nil)
    }
    var categoryCounts = ["all": browser.items.count]
    for item in browser.items {
      for category in Set(item.categories) where category != "all" {
        categoryCounts[category, default: 0] += 1
      }
    }
    return Presentation(
      matching: matching, groups: groups, visibleGroups: visible, lists: lists,
      collectionCounts: collectionCounts, categoryCounts: categoryCounts,
      total: groups.reduce(0) { $0 + $1.items.count }, shown: visible.reduce(0) { $0 + $1.items.count })
  }

  var narrowed: Bool {
    !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || category != "all" || collection != nil
  }
  func matchingItems(_ browser: TodayWorkBrowser) -> [TodayWorkBrowser.Item] {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    let titles = Dictionary(browser.collections.map { ($0.key, $0.title) }, uniquingKeysWith: { first, _ in first })
    return browser.items.filter { item in
      (category == "all" || item.categories.contains(category))
        && (query.isEmpty
          || [item.title, item.status ?? "", item.type ?? "", titles[item.collectionKey ?? ""] ?? ""]
            .contains { $0.localizedStandardContains(query) })
    }
  }
  @MainActor func groups(_ browser: TodayWorkBrowser) -> [Group] {
    groups(browser, matching: matchingItems(browser))
  }
  private func groups(_ browser: TodayWorkBrowser, matching: [TodayWorkBrowser.Item]) -> [Group] {
    let items = matching.filter { collection == nil || $0.collectionKey == collection }
    guard groupByList else { return [Group(id: "flat", title: "", items: items)] }
    let grouped = Dictionary(grouping: items, by: { $0.collectionKey ?? "" })
    let known = Set(browser.collections.map(\.key))
    let others = items.filter { !known.contains($0.collectionKey ?? "") }
    return browser.collections.compactMap { list in
      grouped[list.key].map { Group(id: list.key, title: list.title, items: $0) }
    } + (others.isEmpty ? [] : [Group(id: "other", title: L10n.text.copy("其他事项", "Other Items"), items: others)])
  }
  @MainActor func visibleGroups(_ browser: TodayWorkBrowser) -> [Group] {
    visibleGroups(groups(browser))
  }
  private func visibleGroups(_ groups: [Group]) -> [Group] {
    guard !expanded && !narrowed else { return groups }
    return groups.prefix(3).map {
      Group(id: $0.id, title: $0.title, items: Array($0.items.prefix(groupByList ? 2 : 6)))
    }
  }
  mutating func resetPreview() {
    expanded = false
    collapsed = []
  }
}

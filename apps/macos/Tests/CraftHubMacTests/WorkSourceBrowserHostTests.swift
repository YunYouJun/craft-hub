import AppKit
import CraftHubMacCore
import Foundation
import QuartzCore
import Testing

@testable import CraftHubMac

private func cachedBrowser(_ identity: WorkSourceBrowserIdentity, titles: [String] = ["Alpha task", "Beta task"])
  throws -> TodayWorkBrowser
{
  try JSONDecoder().decode(
    TodayWorkBrowser.self,
    from: JSONSerialization.data(withJSONObject: [
      "accountKey": identity.account ?? "", "projectMode": false,
      "collections": [["key": "inbox", "title": "Inbox"]],
      "items": titles.enumerated().map { index, title in
        ["key": "\(identity.source)-\(index)", "title": title, "collectionKey": "inbox", "categories": []]
          as [String: Any]
      },
    ]))
}

@MainActor private func cachedControls<T: NSView>(_ type: T.Type, in view: NSView) -> [T] {
  guard !view.isHidden else { return [] }
  return (view as? T).map { [$0] } ?? view.subviews.flatMap { cachedControls(type, in: $0) }
}

@MainActor private func cachedSearch(_ container: WorkSourceBrowserContainer) throws -> NSTextField {
  let host = try #require(container.activeHostingView)
  return try #require(
    cachedControls(NSTextField.self, in: host).first {
      $0.placeholderString == "Search Lists and Tasks" || $0.placeholderString == "搜索列表和待办"
    })
}

@MainActor private func cachedResults(_ container: WorkSourceBrowserContainer) throws -> NSTableView {
  let host = try #require(container.activeHostingView)
  return try #require(cachedControls(NSTableView.self, in: host).max { $0.frame.width < $1.frame.width })
}

@MainActor private func settleCachedPage(_ container: WorkSourceBrowserContainer) async throws {
  container.layoutSubtreeIfNeeded()
  try await Task.sleep(for: .milliseconds(30))
  container.layoutSubtreeIfNeeded()
}

@MainActor private func updateCachedPage(
  _ identity: WorkSourceBrowserIdentity, in container: WorkSourceBrowserContainer,
  valid: Set<WorkSourceBrowserIdentity>, actions: WorkItemQuickActionsModel,
  titles: [String] = ["Alpha task", "Beta task"], revision: String = "same-snapshot", capacity: Int = 2,
  reduceMotion: Bool = false
) throws {
  container.update(
    identity: identity, validIdentities: valid, revision: revision,
    browser: try cachedBrowser(identity, titles: titles),
    sourceIcon: nil, workItemActions: actions, openSource: {}, capacity: capacity, reduceMotion: reduceMotion)
}

@MainActor private func showCachedPage(
  _ identity: WorkSourceBrowserIdentity, in container: WorkSourceBrowserContainer,
  valid: Set<WorkSourceBrowserIdentity>, actions: WorkItemQuickActionsModel,
  titles: [String] = ["Alpha task", "Beta task"], revision: String = "same-snapshot", capacity: Int = 2
) async throws {
  try updateCachedPage(
    identity, in: container, valid: valid, actions: actions, titles: titles, revision: revision, capacity: capacity)
  try await settleCachedPage(container)
}

@MainActor private func setCachedQuery(_ query: String, in container: WorkSourceBrowserContainer) async throws {
  let field = try cachedSearch(container)
  field.stringValue = query
  field.delegate?.controlTextDidChange?(
    Notification(name: NSControl.textDidChangeNotification, object: field))
  try await settleCachedPage(container)
  #expect(try cachedSearch(container).stringValue == query)
}

@MainActor private func withBrowserCache(
  _ body: (WorkSourceBrowserContainer, WorkItemQuickActionsModel) async throws -> Void
) async throws {
  let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 1100, height: 650), styleMask: [.titled, .closable], backing: .buffered,
    defer: false)
  window.isReleasedWhenClosed = false
  let container = WorkSourceBrowserContainer(frame: NSRect(x: 0, y: 0, width: 1100, height: 650))
  window.contentView = container
  defer {
    container.removeAllPages()
    window.contentView = nil
    window.close()
  }
  try await body(container, WorkItemQuickActionsModel())
}

@Suite(.serialized) @MainActor struct WorkSourceBrowserHostTests {
  private let first = WorkSourceBrowserIdentity(source: "first", account: "account-one")
  private let second = WorkSourceBrowserIdentity(source: "second", account: "account-one")
  private let third = WorkSourceBrowserIdentity(source: "third", account: "account-one")

  @Test func browserPagesFadeOnlyWhenSwitchingSources() async throws {
    try await withBrowserCache { container, actions in
      let valid: Set = [first, second]
      try await showCachedPage(first, in: container, valid: valid, actions: actions)
      let firstHost = try #require(container.activeHostingView)
      #expect(firstHost.layer?.animation(forKey: "source-switch-fade") == nil)

      try updateCachedPage(second, in: container, valid: valid, actions: actions)
      let secondHost = try #require(container.activeHostingView)
      let layer = try #require(secondHost.layer)
      let fade = try #require(layer.animation(forKey: "source-switch-fade") as? CABasicAnimation)
      #expect(fade.keyPath == "opacity")
      #expect((fade.fromValue as? NSNumber)?.doubleValue == 0)
      #expect((fade.toValue as? NSNumber)?.doubleValue == 1)
      #expect(fade.duration == 0.16)
      #expect(layer.opacity == 1)
      #expect(firstHost.isHidden && !secondHost.isHidden)

      // A completed fade must not start again when the selected source refreshes.
      layer.removeAnimation(forKey: "source-switch-fade")
      try updateCachedPage(
        second, in: container, valid: valid, actions: actions, titles: ["Refreshed task"], revision: "updated-snapshot")
      #expect(container.activeHostingView === secondHost)
      #expect(layer.animation(forKey: "source-switch-fade") == nil)
      #expect(layer.opacity == 1)
    }
  }

  @Test func rapidSourceSwitchingCancelsHiddenPageFadesAndPreservesSearch() async throws {
    try await withBrowserCache { container, actions in
      let valid: Set = [first, second]
      try await showCachedPage(first, in: container, valid: valid, actions: actions)
      try await setCachedQuery("Alpha", in: container)
      let firstHost = try #require(container.activeHostingView)
      let firstTable = try cachedResults(container)

      try updateCachedPage(second, in: container, valid: valid, actions: actions)
      let secondHost = try #require(container.activeHostingView)
      #expect(secondHost.layer?.animation(forKey: "source-switch-fade") != nil)
      try updateCachedPage(first, in: container, valid: valid, actions: actions)
      #expect(container.activeHostingView === firstHost)
      #expect(secondHost.isHidden)
      #expect(secondHost.layer?.animation(forKey: "source-switch-fade") == nil)
      #expect(secondHost.layer?.opacity == 1)
      #expect(firstHost.layer?.animation(forKey: "source-switch-fade") != nil)

      try updateCachedPage(second, in: container, valid: valid, actions: actions)
      #expect(container.activeHostingView === secondHost)
      #expect(firstHost.isHidden)
      #expect(firstHost.layer?.animation(forKey: "source-switch-fade") == nil)
      #expect(firstHost.layer?.opacity == 1)
      try updateCachedPage(first, in: container, valid: valid, actions: actions)
      try await settleCachedPage(container)
      #expect(container.activeHostingView === firstHost)
      #expect(try cachedSearch(container).stringValue == "Alpha")
      #expect(try cachedResults(container) === firstTable)
      #expect(container.cachedIdentities == valid)
    }
  }

  @Test func reduceMotionSkipsSourceFadesAndCancelsAnActiveFade() async throws {
    try await withBrowserCache { container, actions in
      let valid: Set = [first, second]
      try await showCachedPage(first, in: container, valid: valid, actions: actions)
      try updateCachedPage(second, in: container, valid: valid, actions: actions, reduceMotion: true)
      let secondHost = try #require(container.activeHostingView)
      #expect(secondHost.layer?.animation(forKey: "source-switch-fade") == nil)
      #expect(secondHost.layer?.opacity == 1)

      try updateCachedPage(first, in: container, valid: valid, actions: actions)
      let firstHost = try #require(container.activeHostingView)
      #expect(firstHost.layer?.animation(forKey: "source-switch-fade") != nil)
      try updateCachedPage(first, in: container, valid: valid, actions: actions, reduceMotion: true)
      #expect(container.activeHostingView === firstHost)
      #expect(firstHost.layer?.animation(forKey: "source-switch-fade") == nil)
      #expect(firstHost.layer?.opacity == 1)
    }
  }

  @Test func disconnectingAndRemovingPagesCancelTheirFades() async throws {
    try await withBrowserCache { container, actions in
      let valid: Set = [first, second]
      try await showCachedPage(first, in: container, valid: valid, actions: actions)
      try updateCachedPage(second, in: container, valid: valid, actions: actions)
      let secondHost = try #require(container.activeHostingView)
      #expect(secondHost.layer?.animation(forKey: "source-switch-fade") != nil)
      container.update(
        identity: nil, validIdentities: valid, revision: "disconnected", browser: nil,
        sourceIcon: nil, workItemActions: actions, openSource: {}, capacity: 2)
      #expect(container.activeHostingView == nil)
      #expect(secondHost.isHidden)
      #expect(secondHost.layer?.animation(forKey: "source-switch-fade") == nil)
      #expect(secondHost.layer?.opacity == 1)

      try updateCachedPage(first, in: container, valid: valid, actions: actions)
      try updateCachedPage(second, in: container, valid: valid, actions: actions)
      #expect(container.activeHostingView === secondHost)
      #expect(secondHost.layer?.animation(forKey: "source-switch-fade") != nil)
      container.removeAllPages()
      #expect(secondHost.superview == nil)
      #expect(secondHost.layer?.animation(forKey: "source-switch-fade") == nil)
      #expect(secondHost.layer?.opacity == 1)
      #expect(container.activeHostingView == nil && container.subviews.isEmpty)
    }
  }

  @Test func browserCacheEvictsTheLeastRecentlyUsedHostAndRestoresItsSearch() async throws {
    try await withBrowserCache { container, actions in
      let valid: Set = [first, second, third]
      try await showCachedPage(first, in: container, valid: valid, actions: actions)
      try await setCachedQuery("Alpha", in: container)
      try await showCachedPage(second, in: container, valid: valid, actions: actions)
      let secondHost = try #require(container.activeHostingView)
      try await showCachedPage(first, in: container, valid: valid, actions: actions)
      try await showCachedPage(third, in: container, valid: valid, actions: actions)
      #expect(container.cachedIdentities == [first, third])
      #expect(secondHost.superview == nil)
      #expect(container.stateIdentities == valid)

      try await showCachedPage(second, in: container, valid: valid, actions: actions)
      #expect(container.cachedIdentities == [second, third])
      #expect(try cachedSearch(container).stringValue.isEmpty)
      try await showCachedPage(first, in: container, valid: valid, actions: actions)
      #expect(container.cachedIdentities == [first, second])
      #expect(try cachedSearch(container).stringValue == "Alpha")
      #expect(try cachedResults(container).numberOfRows == 2)
    }
  }

  @Test func browserCachePrunesSelectionsForChangedAccountsAndRemovedSources() async throws {
    try await withBrowserCache { container, actions in
      let changedAccount = WorkSourceBrowserIdentity(source: first.source, account: "account-two")
      try await showCachedPage(first, in: container, valid: [first], actions: actions)
      try await setCachedQuery("Alpha", in: container)
      try await showCachedPage(changedAccount, in: container, valid: [changedAccount], actions: actions)
      #expect(container.cachedIdentities == [changedAccount])
      #expect(container.stateIdentities == [changedAccount])
      #expect(try cachedSearch(container).stringValue.isEmpty)
      try await showCachedPage(first, in: container, valid: [first, second], actions: actions)
      #expect(try cachedSearch(container).stringValue.isEmpty)
      try await setCachedQuery("Beta", in: container)
      try await showCachedPage(second, in: container, valid: [second], actions: actions)
      #expect(container.cachedIdentities == [second])
      #expect(container.stateIdentities == [second])
      try await showCachedPage(first, in: container, valid: [first, second], actions: actions)
      #expect(try cachedSearch(container).stringValue.isEmpty)
    }
  }

  @Test func browserCacheOnlyResizesTheVisiblePageAndReusesItsStoredHost() async throws {
    try await withBrowserCache { container, actions in
      let valid: Set = [first, second]
      try await showCachedPage(first, in: container, valid: valid, actions: actions)
      let firstHost = try #require(container.activeHostingView)
      let firstFrame = firstHost.frame
      try await showCachedPage(second, in: container, valid: valid, actions: actions)
      let secondHost = try #require(container.activeHostingView)
      #expect(firstHost.isHidden)
      #expect(!secondHost.isHidden)
      let window = try #require(container.window)
      window.setContentSize(NSSize(width: 900, height: 500))
      container.needsLayout = true
      try await settleCachedPage(container)
      #expect(container.bounds.size == NSSize(width: 900, height: 500))
      #expect(firstHost.frame == firstFrame)
      #expect(secondHost.frame == container.bounds)
      try await showCachedPage(first, in: container, valid: valid, actions: actions)
      #expect(container.activeHostingView === firstHost)
      #expect(firstHost.frame == container.bounds)
      #expect(!firstHost.isHidden && secondHost.isHidden)
    }
  }

  @Test func browserCacheUpdatesChangedContentEvenWhenTheRevisionIsUnchanged() async throws {
    try await withBrowserCache { container, actions in
      try await showCachedPage(
        first, in: container, valid: [first], actions: actions, titles: ["match old", "other"])
      try await setCachedQuery("match", in: container)
      let host = try #require(container.activeHostingView)
      #expect(try cachedResults(container).numberOfRows == 2)
      try await showCachedPage(
        first, in: container, valid: [first], actions: actions,
        titles: ["match new one", "match new two", "match new three", "other"])
      #expect(container.activeHostingView === host)
      #expect(try cachedSearch(container).stringValue == "match")
      #expect(try cachedResults(container).numberOfRows == 4)
    }
  }

  @Test func browserCacheRemovalDropsAllHostsAndSelectionState() async throws {
    try await withBrowserCache { container, actions in
      try await showCachedPage(first, in: container, valid: [first, second], actions: actions)
      weak var firstHost = container.activeHostingView
      try await showCachedPage(second, in: container, valid: [first, second], actions: actions)
      weak var secondHost = container.activeHostingView
      container.removeAllPages()
      #expect(container.subviews.isEmpty)
      #expect(container.cachedIdentities.isEmpty && container.stateIdentities.isEmpty)
      #expect(container.selectedIdentity == nil && container.activeHostingView == nil)
      for _ in 0..<50 {
        if firstHost == nil && secondHost == nil { break }
        try await Task.sleep(for: .milliseconds(5))
      }
      #expect(firstHost == nil && secondHost == nil)
    }
  }
}

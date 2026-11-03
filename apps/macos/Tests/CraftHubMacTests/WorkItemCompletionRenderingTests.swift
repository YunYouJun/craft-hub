import AppKit
import CraftHubMacCore
import Foundation
import SwiftUI
import Testing

@testable import CraftHubMac

@Suite(.serialized) @MainActor struct WorkItemCompletionRenderingTests {
  @Test func todoRowsFitWideAndNarrowLayoutsAndShowUndoOnlyAfterCompletion() async throws {
    let fixture = CompletionFixture()
    let actions = try completionModel(fixture)
    let target = try completionTarget()
    let row = try JSONDecoder().decode(
      TodayWorkBrowser.Item.self,
      from: JSONSerialization.data(withJSONObject: [
        "key": "task", "title": "Review release and verify the native workbench", "categories": ["important"],
        "due": "Today", "url": "https://to-do.office.com/tasks/", "status": "In progress",
        "actionTarget": [
          "integrationId": "todos", "accountKey": target.accountKey!, "connectionCacheKey": "session",
          "item": completionEntity(),
        ],
      ]))
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 900, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.appearance = NSAppearance(named: .aqua)
    defer {
      window.close()
      window.contentView = nil
    }
    for width in [900.0, 360.0] {
      var rowSize = CGSize.zero
      var bannerHeight: CGFloat = -1
      window.setContentSize(NSSize(width: width, height: 200))
      let hosting = NSHostingView(
        rootView: VStack(spacing: 8) {
          WorkItemRowView(
            item: row, compact: false, narrow: width < 560, openSource: {}, sourceIcon: nil, workItemActions: actions
          )
          .onGeometryChange(for: CGSize.self) {
            $0.size
          } action: {
            rowSize = $0
          }
          WorkItemCompletionBanner(model: actions.completion)
            .onGeometryChange(for: CGFloat.self) {
              $0.size.height
            } action: {
              bannerHeight = $0
            }
          Spacer()
        }.padding(16).background(Color(nsColor: .windowBackgroundColor)))
      window.contentView = hosting
      func render(_ state: String) async throws {
        hosting.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(100))
        hosting.layoutSubtreeIfNeeded()
        if let directory = ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_WORK_ITEMS_SCREENSHOTS"] {
          let bitmap = try #require(hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds))
          hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
          let data = try #require(bitmap.representation(using: .png, properties: [:]))
          try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
          try data.write(
            to: URL(fileURLWithPath: directory).appendingPathComponent("todo-row-\(Int(width))-\(state).png"))
        }
      }
      try await render("ready")
      #expect(rowSize.width > 0 && rowSize.width <= width - 32 && rowSize.height < 130)
      #expect(bannerHeight == 0)
      await actions.completion.complete(target)
      try await render("completed")
      #expect(bannerHeight > 0 && bannerHeight < 100 && actions.target == nil)
      await actions.completion.undo()
      try await render("undone")
      #expect(bannerHeight == 0 && actions.target == nil)
    }
  }
}

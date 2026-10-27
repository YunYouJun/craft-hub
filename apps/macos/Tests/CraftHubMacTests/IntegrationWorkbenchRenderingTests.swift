import AppKit
import CraftHubMacCore
import Foundation
import SwiftUI
import Testing

@testable import CraftHubMac

private actor WorkbenchRenderingFixture {
  func response(_ request: URLRequest) throws -> (Data, URLResponse) {
    let payload: [String: Any]
    switch request.url!.lastPathComponent {
    case "integrations":
      payload = [
        "integrations": [
          [
            "id": "scroll-fixture",
            "actions": [
              [
                "id": "connection", "title": "Connection", "operation": "connection.status", "effect": "remote-read",
                "effectiveConfirmation": "never",
              ],
              [
                "id": "items", "title": "Items", "operation": "work-items.list", "effect": "remote-read",
                "effectiveConfirmation": "never",
              ],
            ],
            "views": [
              [
                "id": "items", "title": "Scroll Fixture", "scope": "global",
                "blocks": [
                  ["id": "connection", "type": "connection-status", "actionId": "connection"],
                  [
                    "id": "items", "type": "entity-list", "actionId": "items", "statusFilter": "active",
                    "assigneeFilter": "current-user",
                  ],
                ],
              ]
            ],
          ]
        ],
        "diagnostics": [],
      ]
    case "connection":
      payload = [
        "version": 1, "kind": "connection",
        "connection": [
          "connected": true, "accountLabel": "Fixture Account", "session": ["cacheKey": "fixture-account"],
        ],
      ]
    default:
      let items: [[String: Any]] = (0..<80).map { index in
        [
          "id": "item-\(index)", "key": "item-\(index)",
          "title": "Item \(index): a title that can wrap in narrow windows",
          "active": true, "personal": true, "status": "active", "statusLabel": "In Progress",
          "statusCategory": "active",
          "description": "<p>Item \(index)</p>"
            + String(
              repeating: "<p>A long description with details and context.</p>", count: index.isMultiple(of: 7) ? 80 : 3),
        ]
      }
      payload = [
        "version": 1, "kind": "entities",
        "page": ["items": items, "currentUser": ["id": "fixture-account"], "coverage": "complete"],
      ]
    }
    return (
      try JSONSerialization.data(withJSONObject: payload),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
}

@MainActor private func descendantScrollViews(_ view: NSView) -> [NSScrollView] {
  (view as? NSScrollView).map { [$0] } ?? view.subviews.flatMap(descendantScrollViews)
}

/// Smoke coverage for the real native view graph; the scroll-wheel hang also needs packaged App acceptance.
/// A main-thread layout loop cannot observe an async timeout; run this filtered test with an outer process deadline.
@MainActor @Test func workbenchRowsRemainResponsiveAcrossRepeatedScrollingAndFiltering() async throws {
  let fixture = WorkbenchRenderingFixture()
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  let client = RuntimeAPIClient(connection: connection, transport: { try await fixture.response($0) })
  let model = IntegrationWorkbenchModel()
  model.connect(client)
  defer { model.connect(nil) }
  await model.loadCatalog()
  await model.select("scroll-fixture/items")
  let block = try #require(model.entry?.view.blocks.first { $0.id == "items" })
  let state = model.state(block)
  #expect(state.visibleItems.count == 80)
  let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 1100, height: 720), styleMask: [.titled, .closable], backing: .buffered,
    defer: false)
  window.isReleasedWhenClosed = false
  defer {
    window.close()
    window.contentView = nil
  }
  let hosting = NSHostingView(
    rootView: IntegrationWorkbenchView(
      model: model, projects: [], findRequest: 0, openWeb: { _ in }, openConfiguration: { _ in },
      workItemActions: WorkItemQuickActionsModel()))
  window.contentView = hosting
  hosting.layoutSubtreeIfNeeded()
  try await Task.sleep(for: .milliseconds(50))
  let scroll = try #require(
    descendantScrollViews(hosting).max {
      ($0.documentView?.bounds.height ?? 0) < ($1.documentView?.bounds.height ?? 0)
    })
  #expect((scroll.documentView?.bounds.height ?? 0) > scroll.contentView.bounds.height)
  let started = ContinuousClock.now
  for cycle in 0..<4 {
    for position in [1.0, 0.5, 0.0] {
      let height = max(0, (scroll.documentView?.bounds.height ?? 0) - scroll.contentView.bounds.height)
      scroll.contentView.scroll(to: NSPoint(x: 0, y: height * position))
      scroll.reflectScrolledClipView(scroll.contentView)
      hosting.layoutSubtreeIfNeeded()
      try await Task.sleep(for: .milliseconds(25))
    }
    state.query = cycle.isMultiple(of: 2) ? "Item 7:" : ""
    hosting.layoutSubtreeIfNeeded()
    try await Task.sleep(for: .milliseconds(25))
    #expect(state.visibleItems.count == (state.query.isEmpty ? 80 : 1))
  }
  state.query = ""
  hosting.layoutSubtreeIfNeeded()
  try await Task.sleep(for: .milliseconds(25))
  #expect(started.duration(to: .now) < .seconds(5))
  #expect(state.visibleItems.count == 80)
}

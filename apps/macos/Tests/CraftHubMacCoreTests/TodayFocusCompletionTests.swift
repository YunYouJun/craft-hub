import Foundation
import Testing

@testable import CraftHubMacCore

private func completionSnapshot() throws -> TodayFocusSnapshot {
  func target(_ account: String, _ id: String) -> [String: Any] {
    [
      "integrationId": "todos", "accountKey": account, "connectionCacheKey": account,
      "item": [
        "key": id, "id": id, "title": id, "active": true, "personal": true, "status": "inProgress",
        "statusCategory": "active", "statusUpdateAvailable": true,
        "sourceRef": [
          "providerId": "tasks", "instanceId": "todos", "accountId": account, "containerId": "inbox", "kind": "task",
          "itemId": id,
        ],
      ],
    ]
  }
  let sources: [[String: Any]] = ["owner", "other"].map { account in
    [
      "key": account, "title": account, "path": "/integrations/todos/tasks", "state": "loaded", "complete": true,
      "cached": false, "count": 3,
      "browser": [
        "accountKey": account, "projectMode": false, "collections": [["key": "inbox", "title": "Tasks"]],
        "items": ["first", "task", "last"].map { id in
          [
            "key": id, "title": id, "collectionKey": "inbox", "categories": ["important"],
            "actionTarget": target(account, id),
          ] as [String: Any]
        },
      ],
    ]
  }
  let items: [[String: Any]] = ["first", "task", "last"].map { id in
    [
      "key": id, "title": id, "sourceTitle": "Tasks", "sourceKey": "owner", "path": "/integrations/todos/tasks",
      "reasons": ["Important"], "actionTarget": target("owner", id),
    ]
  }
  return try JSONDecoder().decode(
    TodayFocusSnapshot.self,
    from: JSONSerialization.data(withJSONObject: [
      "version": 1, "checkedAt": "2026-11-03T00:00:00Z", "sourceCount": 2, "total": 6, "sources": sources,
      "items": items,
      "candidates": items.map {
        ["key": $0["key"]!, "title": $0["title"]!, "source": "Tasks", "reasons": ["Important"]]
      },
    ]))
}

@Test func completionReceiptsUpdateOnlyTheExactAccountAndUndoRestoresCountsAndRowPosition() throws {
  let original = try completionSnapshot()
  let target = try #require(original.sources[0].browser?.items[1].actionTarget)
  let receipt = IntegrationPresentation.Entity(
    key: "receipt", id: "task", title: "task", active: false, personal: true,
    status: "completed", statusCategory: "done", sourceRef: target.item.sourceRef)
  let completed = original.applyingCompletion(to: target, receipt: receipt)
  #expect(completed.total == 5 && completed.sources.map(\.count) == [2, 3])
  #expect(completed.sources[0].browser?.items.map(\.key) == ["first", "last"])
  #expect(completed.sources[1].browser == original.sources[1].browser)
  #expect(completed.items.map(\.key) == ["first", "last"] && completed.candidates.map(\.key) == ["first", "last"])
  // This also represents a new server snapshot that no longer contains the completed row.
  let restored = completed.applyingCompletion(to: target, receipt: target.item, restoringFrom: original)
  #expect(restored.total == 6 && restored.sources.map(\.count) == [3, 3])
  #expect(restored.sources[0].browser?.items.map(\.key) == ["first", "task", "last"])
  #expect(restored.sources[1].browser == original.sources[1].browser)
  #expect(
    restored.items.map(\.key) == ["first", "task", "last"]
      && restored.candidates.map(\.key) == ["first", "task", "last"])
  #expect(restored.sources[0].browser?.items[1].actionTarget?.item.status == "inProgress")
  let repeated = restored.applyingCompletion(to: target, receipt: target.item, restoringFrom: original)
  #expect(repeated.total == 6 && repeated.sources[0].browser?.items.count == 3)
}

@Test func completionRestorationCannotInsertOldAccountRowsIntoAnotherAccount() throws {
  let original = try completionSnapshot()
  let target = try #require(original.sources[0].browser?.items[1].actionTarget)
  let otherAccount = TodayFocusSnapshot(
    version: original.version, checkedAt: original.checkedAt, sourceCount: 1, total: 3,
    sources: [original.sources[1]], items: [], candidates: [])
  let restored = otherAccount.applyingCompletion(to: target, receipt: target.item, restoringFrom: original)
  #expect(restored.total == 3 && restored.sources[0].browser == original.sources[1].browser)
  #expect(restored.items.isEmpty && restored.candidates.isEmpty)
}

import Foundation
import Testing
@testable import CraftHubMacCore

@Test func draftAndRetryIdentitySurviveReopeningWithoutCredentials() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = CaptureDraftStore(url: directory.appendingPathComponent("native/draft.json"))
  var draft = CaptureDocument()
  draft.text = "明天提交设计稿"
  draft.draft.title = "手动核对后的标题"
  draft.draft.notes = "Keep reviewed notes"
  let payload = ["title": draft.draft.title, "accountId": "a", "listId": "tasks"]
  let first = try draft.prepareAttempt(payload: payload, important: true)
  try store.save(draft)
  var restored = try store.load()
  #expect(restored == draft)
  #expect(try restored.prepareAttempt(payload: payload, important: true) == first)
  #expect(try restored.prepareAttempt(payload: payload.merging(["accountId": "b"]) { _, new in new }, important: true) != first)
  let permissions = try FileManager.default.attributesOfItem(atPath: store.url.path)[.posixPermissions] as? Int
  #expect(permissions == 0o600)
}

@Test func impossibleDatesDoNotSilentlyBecomeADifferentReminder() throws {
  #expect(throws: (any Error).self) { try CaptureDates.instant("2026-02-30T15:00") }
  #expect(throws: (any Error).self) { try CaptureDates.instant("2026-10-22T25:00") }
  #expect(throws: (any Error).self) { try CaptureDates.instant("2026-10-22") }
  #expect(try CaptureDates.instant("2026-10-22T15:00").hasSuffix(".000Z"))
}

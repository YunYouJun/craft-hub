import AppKit
import SwiftUI
import CraftHubMacCore
import Foundation
import Testing
@testable import CraftHubMac

@MainActor @Test func paletteFiltersAndWrapsWithoutRequiringARuntime() {
  let model = CommandPaletteModel()
  let all = model.results
  #expect(!all.isEmpty)
  model.move(-1)
  #expect(model.selected?.id == all.last?.id)
  model.move(1)
  #expect(model.selected?.id == all.first?.id)
  model.query = "> " + Destination.environment.title
  #expect(model.results.map(\.id) == ["page:environment"])
  model.category = .commands
  #expect(model.results.isEmpty)
  model.category = .all
  model.query = "missing-project:build"
  #expect(model.results.isEmpty)
}

@MainActor @Test func nativeCommandsNeverSwitchToTheEmbeddedWebPalette() {
  let model = WorkbenchModel()
  var panels: [String] = []
  model.presentPanel = { name, _ in panels.append(name) }
  model.selection = .environment
  model.run("palette")
  model.run("capture")
  #expect(panels == ["palette", "capture"])
  #expect(model.presentsNativeContent)
}

@MainActor @Test func offlineCaptureRetainsReviewedDraftAcrossStoreRecreation() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = CaptureDraftStore(url: directory.appendingPathComponent("draft.json"))
  let model = QuickCaptureModel(store: store)
  model.document.text = "明天提交设计稿"
  model.editedText()
  model.editedDraft()
  model.document.draft.title = "手工确认的标题"
  model.document.draft.notes = "重新打开后保留"
  model.closed()
  model.connect(nil)
  let restored = QuickCaptureModel(store: store)
  #expect(restored.document.draft.title == "手工确认的标题")
  #expect(restored.document.draft.notes == "重新打开后保留")
  #expect(!restored.canSave)
}

@MainActor @Test func captureRetriesTheDurableIDAfterAnUnconfirmedRemoteSave() async throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = CaptureDraftStore(url: directory.appendingPathComponent("draft.json"))
  let secret = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(handshake: JSONSerialization.data(withJSONObject: [
    "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)", "nativeApiToken": secret,
  ]))
  var requests: [String] = []
  var saves: [String] = []
  let client = RuntimeAPIClient(connection: connection) { request in
    requests.append(request.url!.path)
    var body = "{}"
    switch request.url!.lastPathComponent {
    case "connection": body = #"{"connected":true,"accountLabel":"test-account","capabilities":{"create":true}}"#
    case "tasks": body = #"{"collections":[{"id":"tasks","title":"Tasks"}]}"#
    case "work-assistant": body = #"{"available":false}"#
    case "create":
      let envelope = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
      #expect(envelope["confirmed"] as? Bool == true)
      let input = envelope["input"] as! [String: Any]
      saves.append(input["requestId"] as! String)
      #expect(input["accountId"] as? String == "test-account")
      // The request ID already exists on disk before the HTTP request leaves the app.
      #expect(try store.load().requestID == saves.last)
      if saves.count == 1 { throw URLError(.timedOut) }
      body = #"{"id":"one","title":"Native acceptance"}"#
    default: Issue.record("Unexpected endpoint: \(request.url!.path)")
    }
    return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
  let first = QuickCaptureModel(store: store)
  first.connect(client)
  await first.load()
  first.document.text = "Native acceptance"
  first.document.draft.title = "Native acceptance"
  #expect(first.canSave)
  await first.save()
  #expect(first.document.text == "Native acceptance")
  #expect(first.error != nil)
  let reopened = QuickCaptureModel(store: store)
  reopened.connect(client)
  await reopened.load()
  await reopened.save()
  #expect(saves.count == 2 && saves[0] == saves[1])
  #expect(reopened.document.text.isEmpty)
  #expect(reopened.document.receipt?.contains("Native acceptance") == true)
  #expect(try store.load().requestID == nil)
  #expect(!requests.contains { $0.contains("trust") || $0.contains("runs") })
}

@MainActor @Test func unreadableDraftIsNeverOverwrittenByOpeningThePanel() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  let store = CaptureDraftStore(url: directory.appendingPathComponent("draft.json"))
  let damaged = Data("{unfinished".utf8)
  try damaged.write(to: store.url)
  let model = QuickCaptureModel(store: store)
  model.document.text = "New text"
  model.editedText()
  #expect(model.recoveryRequired)
  #expect(!model.canSave)
  #expect(try Data(contentsOf: store.url) == damaged)
  model.recoverDraft()
  #expect(!model.recoveryRequired)
  #expect(try store.load().text == "New text")
  let backup = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first { $0.lastPathComponent.contains("recovery-") }
  #expect(try Data(contentsOf: #require(backup)) == damaged)
}

@MainActor @Test func paletteKeyboardDefersToChineseCompositionBeforeOpeningACommand() {
  var submitted = 0
  var movement = 0
  let view = PaletteSearchField(text: .constant("搜索"), placeholder: "", focus: UUID(), move: { movement += $0 }, submit: { submitted += 1 }, dismiss: {})
  let coordinator = view.makeCoordinator()
  let field = NSTextField()
  let editor = NSTextView()
  editor.setMarkedText("sou", selectedRange: NSRange(location: 3, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
  #expect(!coordinator.control(field, textView: editor, doCommandBy: NSSelectorFromString("insertNewline:")))
  #expect(!coordinator.control(field, textView: editor, doCommandBy: NSSelectorFromString("moveDown:")))
  #expect(submitted == 0 && movement == 0)
  editor.unmarkText()
  #expect(coordinator.control(field, textView: editor, doCommandBy: NSSelectorFromString("moveDown:")))
  #expect(coordinator.control(field, textView: editor, doCommandBy: NSSelectorFromString("insertNewline:")))
  #expect(submitted == 1 && movement == 1)
}

@MainActor @Test func committingUnchangedInputDoesNotEraseReviewedCaptureFields() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let model = QuickCaptureModel(store: CaptureDraftStore(url: directory.appendingPathComponent("draft.json")))
  model.updateText("明天下午三点提交设计稿 !重要")
  model.document.draft.title = "已核对的设计稿"
  model.document.draft.notes = "手工备注"
  model.document.draft.dueLocal = "2026-10-23T15:00"
  model.document.draft.important = true
  model.document.draft.remind = true
  let reviewed = model.document
  model.updateText(model.document.text)
  #expect(model.document == reviewed)
}

import Foundation
import Testing

@testable import CraftHubMac

@MainActor @Test func textExportKeepsUnicodeContentAndAllowsOnlyABasenameWithoutChoosingAPath() throws {
  let value = try #require(DesktopBridge.textExport(["filename": "Notes.md", "content": "Hello\n世界"]))
  #expect(value.filename == "Notes.md" && String(decoding: value.data, as: UTF8.self) == "Hello\n世界")
  for name in ["", ".", "..", "../secret", "/tmp/file", "folder\\file", "file:name", "line\nname"] {
    #expect(DesktopBridge.textExport(["filename": name, "content": "text"]) == nil)
  }
  #expect(DesktopBridge.textExport(["filename": "notes.txt", "content": "text", "path": "/tmp/hidden"]) == nil)
  #expect(
    DesktopBridge.textExport(["filename": "notes.txt", "content": String(repeating: "x", count: 8 * 1024 * 1024 + 1)])
      == nil)
}

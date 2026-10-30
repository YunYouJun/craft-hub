import AppKit
import Foundation
import SwiftTerm
import Testing

@testable import CraftHubMac

@MainActor private final class TerminalFixture {
  let session = NativeTerminalSession()
  var view: RuntimeTerminalView { session.view }
  var coordinator: NativeTerminalCoordinator { session.coordinator }
  private var previousOutput = ""
  private var previousRun: String?
  var sent: [Data] = []
  var sizes: [(Int, Int)] = []
  var links: [URL] = []
  init() {
    coordinator.openLink = { [weak self] in self?.links.append($0) }
  }
  func update(_ output: String = "", run: String = "first", running: Bool = true, live: Bool = true) {
    let chunk =
      previousRun == run && live && output.hasPrefix(previousOutput)
      ? String(output.dropFirst(previousOutput.count)) : nil
    session.update(
      runID: run, output: output, appendedOutput: chunk, running: running, liveOutput: live,
      sendInput: { [weak self] in self?.sent.append($0) }, resize: { [weak self] in self?.sizes.append(($0, $1)) })
    previousRun = run
    previousOutput = output
  }

  var text: String {
    let terminal = view.getTerminal()
    return (0..<terminal.rows).compactMap { row in
      terminal.getLine(row: row)?.translateToString(
        trimRight: true, skipNullCellsFollowingWide: true, characterProvider: { terminal.getCharacter(for: $0) })
    }.joined(separator: "\n")
  }
  var input: String { String(decoding: sent.reduce(into: Data(), { $0.append($1) }), as: UTF8.self) }
}

@MainActor private func preservingTerminalClipboard(_ operation: (NSPasteboard) -> Void) {
  let board = NSPasteboard.general
  let original = (board.pasteboardItems ?? []).map { item in
    let copy = NSPasteboardItem()
    for type in item.types { if let data = item.data(forType: type) { copy.setData(data, forType: type) } }
    return copy
  }
  defer {
    board.clearContents()
    if !original.isEmpty { board.writeObjects(original) }
  }
  operation(board)
}

@Suite(.serialized) @MainActor struct NativeTerminalViewTests {
  @Test func swiftTermReusesItsNativeViewAndResetsChangedRunsOrReplacedOutput() {
    let fixture = TerminalFixture()
    let identity = ObjectIdentifier(fixture.view)
    fixture.update("old\rnew\u{1B}[K")
    #expect(fixture.text.hasPrefix("new"))
    fixture.update("old\rnew\u{1B}[K\r\n\u{1B}[1;31mred")
    #expect(fixture.text.contains("red") && !fixture.text.contains("\u{1B}"))
    let cell = fixture.view.getTerminal().getCharData(col: 0, row: 1)
    #expect(cell?.attribute.fg == .ansi256(code: 1))
    #expect(cell?.attribute.style.contains(.bold) == true)
    fixture.update("replacement", live: false)
    #expect(fixture.text.hasPrefix("replacement") && !fixture.text.contains("red"))
    fixture.update("second run", run: "second")
    #expect(fixture.text.hasPrefix("second run") && !fixture.text.contains("replacement"))
    #expect(ObjectIdentifier(fixture.view) == identity)
    #expect(fixture.view.getTerminal().options.scrollback == 2000)
  }

  @Test func swiftTermRendersWideAndCombiningCharactersAndAlternateScreenControlSequences() {
    let fixture = TerminalFixture()
    fixture.update("你a\u{301}好")
    let terminal = fixture.view.getTerminal()
    #expect(terminal.getCharacter(col: 0, row: 0) == "你")
    #expect(terminal.getCharData(col: 0, row: 0)?.width == 2)
    #expect(terminal.getCharacter(col: 2, row: 0) == "a\u{301}")
    #expect(terminal.getCharacter(col: 3, row: 0) == "好")
    fixture.update("你a\u{301}好\u{1B}[?1049h\u{1B}[Hother\u{1B}[2;2HX\u{1B}[1;1H\u{1B}[K")
    #expect(!fixture.text.contains("other"))
    #expect(fixture.text.contains("X"))
    fixture.update("你a\u{301}好\u{1B}[?1049h\u{1B}[Hother\u{1B}[2;2HX\u{1B}[1;1H\u{1B}[K\u{1B}[?1049l")
    #expect(fixture.text.hasPrefix("你a\u{301}好"))
    #expect(!fixture.text.contains("other"))
  }

  @Test func swiftTermIMEKeepsProvisionalSpellingLocalAndSendsTheFinalCommitOnce() {
    let fixture = TerminalFixture()
    fixture.update("prompt> ")
    let range = NSRange(location: NSNotFound, length: 0)
    fixture.view.setMarkedText("zhong", selectedRange: .init(location: 5, length: 0), replacementRange: range)
    #expect(fixture.view.hasMarkedText())
    #expect(fixture.sent.isEmpty)
    fixture.view.insertText("中", replacementRange: range)
    #expect(!fixture.view.hasMarkedText())
    #expect(fixture.sent == [Data("中".utf8)])
    #expect(fixture.text.hasPrefix("prompt> "))
  }

  @Test func swiftTermSendsKeyboardAndRawMouseBytesWithoutUTF8Replacement() throws {
    let fixture = TerminalFixture()
    fixture.update()
    fixture.view.doCommand(by: #selector(NSResponder.insertNewline(_:)))
    fixture.view.doCommand(by: #selector(NSResponder.deleteBackward(_:)))
    fixture.view.doCommand(by: #selector(NSResponder.moveUp(_:)))
    #expect(fixture.input == "\r\u{7F}\u{1B}[A")
    let control = try #require(
      NSEvent.keyEvent(
        with: .keyDown, location: .zero, modifierFlags: [.control], timestamp: 0, windowNumber: 0, context: nil,
        characters: "\u{3}", charactersIgnoringModifiers: "c", isARepeat: false, keyCode: 8))
    fixture.view.keyDown(with: control)
    #expect(fixture.sent.last == Data([3]))
    let legacyMouse: [UInt8] = [0x1b, 0x5b, 0x4d, 0x20, 0xff, 0x80]
    fixture.coordinator.send(source: fixture.view, data: legacyMouse[...])
    #expect(fixture.sent.last == Data(legacyMouse))
    #expect(fixture.view.allowMouseReporting)
  }

  @Test func swiftTermCopiesSelectedPlainTextAndUsesBracketedPasteOnlyForUserPaste() {
    let fixture = TerminalFixture()
    fixture.update("\u{1B}[31m选择中文\u{1B}[0m\u{1B}[?2004h")
    preservingTerminalClipboard { board in
      fixture.view.selection.selectAll()
      fixture.view.copy(NSNull())
      #expect(board.string(forType: .string)?.contains("选择中文") == true)
      #expect(board.string(forType: .string)?.contains("\u{1B}") == false)
      board.clearContents()
      board.setString("paste 中文", forType: .string)
      fixture.view.paste(NSNull())
      #expect(fixture.input == "\u{1B}[200~paste 中文\u{1B}[201~")
    }
  }

  @Test func completedTerminalBlocksInputAndProtocolResponsesWhileKeepingSelectionAndCopy() {
    let fixture = TerminalFixture()
    fixture.update("finished", running: false)
    fixture.view.insertText("ignored", replacementRange: .init(location: NSNotFound, length: 0))
    fixture.view.setMarkedText(
      "ignored", selectedRange: .init(location: 0, length: 0), replacementRange: .init(location: NSNotFound, length: 0))
    fixture.view.doCommand(by: #selector(NSResponder.insertNewline(_:)))
    fixture.view.feed(text: "\u{1B}[6n\u{1B}[c\u{1B}[18t")
    fixture.coordinator.send(source: fixture.view, data: [0xff][...])
    #expect(fixture.sent.isEmpty)
    #expect(!fixture.view.hasMarkedText() && !fixture.view.allowMouseReporting)
    preservingTerminalClipboard { board in
      fixture.view.selection.selectAll()
      fixture.view.copy(NSNull())
      #expect(board.string(forType: .string)?.contains("finished") == true)
      fixture.view.paste(NSNull())
      #expect(fixture.sent.isEmpty)
    }
  }

  @Test func swiftTermRepliesOnlyToNewLiveQueriesAndReportsGeometryWithoutStartingAnotherPTY() async {
    let fixture = TerminalFixture()
    fixture.update()
    fixture.update("\u{1B}[6n")
    #expect(fixture.input.hasPrefix("\u{1B}[") && fixture.input.hasSuffix("R"))
    fixture.sent = []
    fixture.update("snapshot\u{1B}[6n", live: false)
    #expect(fixture.sent.isEmpty)
    fixture.update("snapshot\u{1B}[6n\u{1B}[6n")
    #expect(fixture.input.hasPrefix("\u{1B}["))
    #expect(fixture.input.hasSuffix("R"))
    fixture.view.resize(cols: 96, rows: 28)
    await Task.yield()
    #expect(fixture.sizes.contains { $0.0 == 96 && $0.1 == 28 })
    #expect(type(of: fixture.view) == RuntimeTerminalView.self)
  }

  @Test func retainedSwiftTermSessionAnswersCoalescedStartupAndHiddenQueriesOnceAcrossViewRecreation() {
    let session = NativeTerminalSession()
    var sent: [Data] = []
    let initial = "prompt\u{1B}[6n"
    session.update(
      runID: "coalesced", output: initial, running: true, liveOutput: true,
      sendInput: { sent.append($0) }, resize: { _, _ in })
    #expect(sent.count == 1)
    let identity = ObjectIdentifier(session.view)
    // No SwiftUI makeNSView is required for the app-owned stream to service a terminal query.
    let returned = NativeTerminalView(session: session)
    #expect(returned.session === session && ObjectIdentifier(returned.session.view) == identity)
    #expect(sent.count == 1)
    session.update(
      runID: "coalesced", output: initial + "\u{1B}[6n", appendedOutput: "\u{1B}[6n", running: true, liveOutput: true,
      sendInput: { sent.append($0) }, resize: { _, _ in })
    #expect(sent.count == 2 && ObjectIdentifier(session.view) == identity)
    session.suspendInput()
    session.view.feed(text: "\u{1B}[6n")
    #expect(sent.count == 2)
    session.update(
      runID: "history", output: initial, running: true, liveOutput: false,
      sendInput: { sent.append($0) }, resize: { _, _ in })
    #expect(sent.count == 2)
  }

  @Test func modelManagedTerminalConsumesRawChunksAcrossSnapshotRolloverAndIgnoresStaleSwiftUISnapshots() {
    let session = NativeTerminalSession()
    var sent: [Data] = []
    var snapshot = "\u{1B}[31mstart\r\n"
    session.update(
      runID: "rolling", output: snapshot, running: true, liveOutput: true,
      sendInput: { sent.append($0) }, resize: { _, _ in })
    for chunk in ["second\r\n", "third\r\n", "\u{1B}[6n"] {
      snapshot = String((snapshot + chunk).suffix(6))
      session.update(
        runID: "rolling", output: snapshot, appendedOutput: chunk, running: true, liveOutput: true,
        sendInput: { sent.append($0) }, resize: { _, _ in })
    }
    let terminal = session.view.getTerminal()
    #expect(terminal.getLine(row: 0)?.translateToString(trimRight: true) == "start")
    #expect(terminal.getLine(row: 1)?.translateToString(trimRight: true) == "second")
    #expect(terminal.getLine(row: 2)?.translateToString(trimRight: true) == "third")
    #expect(terminal.getCharData(col: 0, row: 2)?.attribute.fg == .ansi256(code: 1))
    #expect(sent.count == 1)
    // A recreated presentation only attaches the existing session; it carries no output or callback snapshot.
    let presentation = NativeTerminalView(session: session)
    #expect(presentation.session.view === session.view)
    session.view.feed(text: "\u{1B}[6n")
    #expect(sent.count == 2)
    #expect(terminal.getLine(row: 0)?.translateToString(trimRight: true) == "start")
    // Completion carries the bounded record too. It gates input without replacing the already rendered live screen.
    session.update(
      runID: "rolling", output: snapshot, running: false, liveOutput: true,
      sendInput: { sent.append($0) }, resize: { _, _ in })
    #expect(terminal.getLine(row: 0)?.translateToString(trimRight: true) == "start")
    session.view.feed(text: "\u{1B}[6n")
    #expect(sent.count == 2)
  }

  @Test func terminalOutputCannotReadOrWriteClipboardChangeWindowOrOpenLinks() {
    let fixture = TerminalFixture()
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 640, height: 300), styleMask: [.borderless], backing: .buffered,
      defer: false)
    window.isReleasedWhenClosed = false
    window.contentView = fixture.view
    window.title = "Runtime Fixture"
    defer {
      window.close()
      window.contentView = nil
    }
    let frame = fixture.view.frame
    let windowFrame = window.frame
    preservingTerminalClipboard { board in
      board.clearContents()
      board.setString("unchanged fixture", forType: .string)
      fixture.update(
        "\u{1B}]52;c;\(Data("replacement".utf8).base64EncodedString())\u{7}\u{1B}]52;c;?\u{7}\u{1B}]2;untrusted title\u{7}\u{1B}]7;file:///tmp\u{7}\u{1B}]777;notify;title;body\u{7}\u{1B}[8;50;100t\u{1B}]8;;https://example.com\u{7}link\u{1B}]8;;\u{7}"
      )
      #expect(board.string(forType: .string) == "unchanged fixture")
      #expect(fixture.view.frame == frame)
      #expect(window.frame == windowFrame && window.title == "Runtime Fixture")
      #expect(fixture.links.isEmpty && fixture.sent.isEmpty)
      #expect(fixture.coordinator.clipboardRead(source: fixture.view) == nil)
      fixture.coordinator.clipboardCopy(source: fixture.view, content: Data("blocked".utf8))
      #expect(board.string(forType: .string) == "unchanged fixture")
      // Test live parser delivery too, rather than relying only on the snapshot-replay response suppression.
      fixture.view.feed(text: "\u{1B}]52;c;YmFk\u{7}\u{1B}]52;c;?\u{7}\u{1B}]2;still blocked\u{7}\u{1B}[3;10;10t")
      #expect(board.string(forType: .string) == "unchanged fixture")
      #expect(window.frame == windowFrame && window.title == "Runtime Fixture")
      #expect(fixture.sent.isEmpty && fixture.links.isEmpty)
    }
  }

  @Test func terminalLinksRequireAnActualCommandActivationAndCredentialFreeHTTPS() {
    let fixture = TerminalFixture()
    fixture.update()
    fixture.coordinator.requestOpenLink(source: fixture.view, link: "https://example.com", params: [:])
    fixture.view.withUserLinkActivation(modifiers: []) {
      fixture.coordinator.requestOpenLink(source: fixture.view, link: "https://example.com", params: [:])
    }
    #expect(fixture.links.isEmpty)
    fixture.view.withUserLinkActivation(modifiers: [.command]) {
      for link in [
        "file:///tmp", "http://example.com", "javascript:alert(1)", "https://user:password@example.com",
        "https://example.com\n/path",
      ] {
        fixture.coordinator.requestOpenLink(source: fixture.view, link: link, params: [:])
      }
      fixture.coordinator.requestOpenLink(source: fixture.view, link: "https://example.com/document", params: [:])
    }
    #expect(fixture.links.map(\.absoluteString) == ["https://example.com/document"])
    #expect(!fixture.view.isUserActivatingLink)
  }

  @Test func pausingTerminalInputPreservesTheProcessRequestedCursorVisibilityOnResume() {
    for hidden in [false, true] {
      let fixture = TerminalFixture()
      let output = "prompt" + (hidden ? "\u{1B}[?25l" : "")
      fixture.update(output)
      fixture.update(output, running: false)
      fixture.coordinator.suspendInput()
      fixture.update(output)
      fixture.view.feed(text: "\u{1B}[?25$p")
      #expect(fixture.input == "\u{1B}[?25;\(hidden ? 2 : 1)$y")
    }
  }

  @Test func retiredTerminalSessionImmediatelyRevokesCallbacksAndExplicitDiscardClearsItsOutput() async {
    var sent: [Data] = []
    var retired: NativeTerminalCoordinator?
    var view: RuntimeTerminalView?
    do {
      let session = NativeTerminalSession()
      session.update(
        runID: "retired", output: "profile output", running: true, liveOutput: true,
        sendInput: { sent.append($0) }, resize: { _, _ in })
      session.discard()
      #expect(session.view.getTerminal().getCharacter(col: 0, row: 0) != "p")
      session.update(
        runID: "new-profile", output: "new", running: true, liveOutput: true,
        sendInput: { sent.append($0) }, resize: { _, _ in })
      retired = session.coordinator
      view = session.view
    }
    if let retired, let view { retired.send(source: view, data: [0x1b, 0x5b, 0x41][...]) }
    #expect(sent.isEmpty)
    await Task.yield()
    #expect(view?.getTerminal().getCharacter(col: 0, row: 0) != "n")
  }

  @Test func apcPolicyPreservesOrdinaryUnicodeAndSplitCSIAndOSCBytesExactly() {
    var policy = TerminalAPCFilter()
    let chunks = [
      "中文 🐟 👩‍💻 a\u{301}", "\u{1b}", "[31mred\u{1b}", "]8;;https://example.com\u{7}link",
      "\u{1b}", "]8;;\u{7}\u{1b}", "[0m\r\n",
    ]
    let result = chunks.map { policy.consume($0) }.joined()
    #expect(Data(result.utf8) == Data(chunks.joined().utf8))
  }

  @Test func apcPolicyDropsSevenAndEightBitAPCWithSplitTerminatorsWithoutRetainingPayload() {
    for introducer in ["\u{1b}_", "\u{9f}"] {
      var policy = TerminalAPCFilter()
      var result = policy.consume("before" + introducer)
      #expect(policy.consume(String(repeating: "payload中文🐟", count: 4096)).isEmpty)
      #expect(policy.consume("\u{1b}").isEmpty)
      result += policy.consume("\\after")
      #expect(result == "before\u{18}after")
      result += policy.consume(introducer + "Gignored\u{9c}end")
      #expect(result.hasSuffix("\u{18}end"))
    }
  }

  @Test func kittyAPCFileTransportCannotUnlinkLocalFixturesThroughInitialLiveOrHistoryOutput() throws {
    let manager = FileManager.default
    let directory = manager.temporaryDirectory.appendingPathComponent("craft-terminal-policy-\(UUID().uuidString)")
    try manager.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? manager.removeItem(at: directory) }
    let file = directory.appendingPathComponent("tty-graphics-protocol-owned-fixture")
    let original = Data([255, 0, 0])
    try original.write(to: file)
    let payload = Data(file.path.utf8).base64EncodedString()
    let control = "Ga=T,f=24,s=1,v=1,t=t,i=1;" + payload
    let session = NativeTerminalSession()
    var sent: [Data] = []
    let send: (Data) -> Void = { sent.append($0) }
    session.update(
      runID: "initial", output: "initial\u{1b}_" + control + "\u{1b}\\safe", running: true, liveOutput: true,
      sendInput: send, resize: { _, _ in })
    #expect(try Data(contentsOf: file) == original)
    session.update(
      runID: "split-live", output: "", running: true, liveOutput: true, sendInput: send, resize: { _, _ in })
    var snapshot = ""
    for chunk in ["live\u{1b}", "_" + control, "\u{1b}", "\\safe"] {
      snapshot += chunk
      session.update(
        runID: "split-live", output: snapshot, appendedOutput: chunk, running: true, liveOutput: true,
        sendInput: send, resize: { _, _ in })
      #expect(try Data(contentsOf: file) == original)
    }
    session.update(
      runID: "history", output: "history\u{9f}" + control + "\u{9c}safe", running: false, liveOutput: false,
      sendInput: send, resize: { _, _ in })
    #expect(try Data(contentsOf: file) == original)
    #expect(session.view.getTerminal().getLine(row: 0)?.translateToString(trimRight: true) == "historysafe")
    #expect(sent.isEmpty)
  }

  @Test func changingRunOrReplacingHistoryAndDiscardingSessionResetsPartialAPCPolicyState() {
    let session = NativeTerminalSession()
    let send: (Data) -> Void = { _ in }
    session.update(
      runID: "old", output: "\u{1b}_Gunfinished", running: true, liveOutput: true,
      sendInput: send, resize: { _, _ in })
    session.update(
      runID: "new", output: "new", running: true, liveOutput: true, sendInput: send, resize: { _, _ in })
    #expect(session.view.getTerminal().getLine(row: 0)?.translateToString(trimRight: true) == "new")
    session.update(
      runID: "new", output: "\u{9f}unfinished history", running: false, liveOutput: false,
      sendInput: send, resize: { _, _ in })
    session.update(
      runID: "new", output: "fresh history", running: false, liveOutput: false,
      sendInput: send, resize: { _, _ in })
    #expect(session.view.getTerminal().getLine(row: 0)?.translateToString(trimRight: true) == "fresh history")
    session.view.feedHostOutput("\u{1b}_Gunfinished")
    session.discard()
    session.view.feedHostOutput("cleared")
    #expect(session.view.getTerminal().getLine(row: 0)?.translateToString(trimRight: true) == "cleared")
  }
}

import AppKit
import Foundation
import SwiftTerm
import SwiftUI

/// SwiftTerm renders the shared runtime's PTY; this view never creates a local process or a second terminal session.
struct NativeTerminalView: NSViewRepresentable {
  let session: NativeTerminalSession

  func makeNSView(context: Context) -> RuntimeTerminalView { session.view }
  func updateNSView(_ nsView: RuntimeTerminalView, context: Context) {}
}

@MainActor final class NativeTerminalCoordinator: NSObject, @preconcurrency TerminalViewDelegate {
  private(set) weak var view: RuntimeTerminalView?
  private var runID: String?
  private var running = false
  private var feedingOutput = false
  private var replayingSnapshot = false
  private var sendInput: ((Data) -> Void)?
  private var sendResize: ((Int, Int) -> Void)?
  private var sentSize: (Int, Int)?
  private let lifetime: TerminalSessionLifetime
  var openLink: (URL) -> Void = { NSWorkspace.shared.open($0) }

  init(lifetime: TerminalSessionLifetime) {
    self.lifetime = lifetime
    super.init()
  }

  func attach(_ view: RuntimeTerminalView) {
    self.view = view
    view.terminalDelegate = self
  }

  func update(
    runID: String, output: String, appendedOutput: String?, running: Bool, liveOutput: Bool,
    sendInput: @escaping (Data) -> Void, resize: @escaping (Int, Int) -> Void
  ) {
    guard lifetime.isActive, let view else { return }
    self.sendInput = sendInput
    sendResize = resize
    let changedRun = self.runID != runID
    let wasRunning = self.running
    self.runID = runID
    self.running = running
    view.acceptsRuntimeInput = running
    feedingOutput = true
    // Live chunks are authoritative; the rolling history snapshot must never rewind the emulator.
    replayingSnapshot = !liveOutput
    let reset = changedRun || (appendedOutput == nil && !liveOutput)
    if reset {
      view.resetForRun()
      sentSize = nil
      view.feedHostOutput(output)
    } else if let appendedOutput {
      view.feedHostOutput(appendedOutput)
    }
    feedingOutput = false
    replayingSnapshot = false
    if reset || wasRunning != running { reportCurrentSize() }
  }

  func suspendInput() {
    running = false
    sendInput = nil
    sendResize = nil
    view?.acceptsRuntimeInput = false
  }

  func discard() {
    suspendInput()
    runID = nil
    sentSize = nil
    view?.resetForRun()
  }

  private func reportCurrentSize() {
    guard let view else { return }
    let terminal = view.getTerminal()
    sizeChanged(source: view, newCols: terminal.cols, newRows: terminal.rows)
  }

  func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
    guard lifetime.isActive, source === view, running, !feedingOutput, newCols > 0, newRows > 0,
      sentSize?.0 != newCols || sentSize?.1 != newRows
    else { return }
    sentSize = (newCols, newRows)
    let activeRun = runID
    // SwiftUI layout can invoke the delegate synchronously; publish the runtime resize on the next main turn.
    DispatchQueue.main.async { [weak self, weak source] in
      guard let self, self.lifetime.isActive, let source, source === self.view, self.running,
        self.runID == activeRun
      else { return }
      self.sendResize?(newCols, newRows)
    }
  }

  func send(source: TerminalView, data: ArraySlice<UInt8>) {
    guard lifetime.isActive, source === view, running, !replayingSnapshot, !data.isEmpty else { return }
    // Preserve legacy mouse bytes and all terminal responses; never round-trip through a lossy UTF-8 String.
    sendInput?(Data(data))
  }

  func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {
    guard lifetime.isActive, source === view, view?.isUserActivatingLink == true,
      let url = DesktopBridge.externalURL(link)
    else { return }
    openLink(url)
  }

  // Output is untrusted terminal data. These delegate hooks deliberately have no operating-system side effects.
  func clipboardCopy(source: TerminalView, content: Data) {}
  func clipboardRead(source: TerminalView) -> Data? { nil }
  func setTerminalTitle(source: TerminalView, title: String) {}
  func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
  func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}
  func bell(source: TerminalView) {}
  func scrolled(source: TerminalView, position: Double) {}
  func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
}

/// App-owned presentation state consumes each live output event even when its SwiftUI page is absent, and reattaches
/// the same emulator when the page returns. It never creates a process or retains a project-execution approval.
@MainActor final class NativeTerminalSession {
  private let lifetime: TerminalSessionLifetime
  let coordinator: NativeTerminalCoordinator
  init() {
    let lifetime = TerminalSessionLifetime()
    self.lifetime = lifetime
    coordinator = NativeTerminalCoordinator(lifetime: lifetime)
  }
  lazy var view: RuntimeTerminalView = {
    let view = RuntimeTerminalView.make()
    coordinator.attach(view)
    return view
  }()

  func update(
    runID: String, output: String, appendedOutput: String? = nil, running: Bool, liveOutput: Bool,
    sendInput: @escaping (Data) -> Void, resize: @escaping (Int, Int) -> Void
  ) {
    _ = view
    coordinator.update(
      runID: runID, output: output, appendedOutput: appendedOutput, running: running, liveOutput: liveOutput,
      sendInput: sendInput, resize: resize)
  }

  func suspendInput() { coordinator.suspendInput() }
  func discard() { coordinator.discard() }

  deinit {
    // ARC may release an app-owned session away from the main thread. Block callbacks immediately, then clear AppKit
    // state on the main actor even if a dismantling SwiftUI view temporarily retains the coordinator.
    lifetime.invalidate()
    let retired = coordinator
    Task { @MainActor in retired.discard() }
  }
}

/// A session can be destroyed away from AppKit's main actor; callback revocation remains synchronous and thread-safe.
final class TerminalSessionLifetime: @unchecked Sendable {
  private let lock = NSLock()
  private var active = true
  var isActive: Bool {
    lock.lock()
    defer { lock.unlock() }
    return active
  }
  func invalidate() {
    lock.lock()
    active = false
    lock.unlock()
  }
}

/// TerminalView owns native drawing, selection and NSTextInputClient/IME behavior; the runtime owns execution.
@MainActor final class RuntimeTerminalView: TerminalView {
  private var outputPolicy = TerminalAPCFilter()
  var acceptsRuntimeInput = false {
    didSet {
      allowMouseReporting = acceptsRuntimeInput
      if !acceptsRuntimeInput && hasMarkedText() {
        super.setMarkedText(
          "", selectedRange: .init(location: 0, length: 0), replacementRange: .init(location: NSNotFound, length: 0))
      }
    }
  }
  private(set) var isUserActivatingLink = false

  static func make() -> RuntimeTerminalView {
    let view = RuntimeTerminalView(
      frame: .zero, font: NSFont.monospacedSystemFont(ofSize: 12, weight: .regular),
      options: TerminalOptions(
        scrollback: 2000, enableSixelReported: false, kittyImageCacheLimitBytes: 16 * 1024 * 1024))
    view.optionAsMetaKey = false
    view.linkReporting = .implicit
    view.linkHighlightMode = .hoverWithModifier
    view.nativeForegroundColor = .textColor
    view.nativeBackgroundColor = .textBackgroundColor
    view.caretColor = .textColor
    view.selectedTextBackgroundColor = .selectedTextBackgroundColor
    view.allowMouseReporting = false
    view.installSideEffectPolicy()
    view.setAccessibilityLabel(L10n.text.copy("命令终端", "Command Terminal"))
    view.setAccessibilityHelp(
      L10n.text.copy(
        "输入直接发送到运行中的命令。选择输出后可复制，按住 Command 点击 HTTPS 链接。",
        "Input goes to the running command. Select output to copy; Command-click HTTPS links to open them."))
    return view
  }

  func resetForRun() {
    outputPolicy = TerminalAPCFilter()
    getTerminal().resetToInitialState()
    getTerminal().showCursor()
    selection.active = false
    super.setMarkedText(
      "", selectedRange: .init(location: 0, length: 0), replacementRange: .init(location: NSNotFound, length: 0))
    installSideEffectPolicy()
  }

  /// SwiftTerm's Kitty APC graphics transport can open/unlink local files or shared memory before delegate callbacks.
  /// Deny all APC graphics before parsing; OSC, CSI, text rendering and keyboard protocols remain SwiftTerm-owned.
  func feedHostOutput(_ text: String) {
    let safe = outputPolicy.consume(text)
    if !safe.isEmpty { super.feed(text: safe) }
  }

  private func installSideEffectPolicy() {
    // Keep OSC8 hyperlinks as inert link metadata until a user clicks. Do not offer clipboard, title, directory,
    // notification/progress, or iTerm file/inline-image operations from output. The explicit delegates deny them too.
    for code in [0, 1, 2, 6, 7, 9, 52, 777, 1337] { getTerminal().registerOscHandler(code: code) { _ in } }
    // SwiftTerm 1.19's windowCommand implementation ignores window mutations and only answers size queries.
    // Coordinator.sizeChanged also refuses any geometry callbacks produced while feeding control sequences.
  }

  override func insertText(_ string: Any, replacementRange: NSRange) {
    guard acceptsRuntimeInput else { return }
    super.insertText(string, replacementRange: replacementRange)
  }

  override func setMarkedText(_ string: Any, selectedRange: NSRange, replacementRange: NSRange) {
    guard acceptsRuntimeInput else { return }
    super.setMarkedText(string, selectedRange: selectedRange, replacementRange: replacementRange)
  }

  override func paste(_ sender: Any) {
    guard acceptsRuntimeInput else { return }
    super.paste(sender)
  }

  override func mouseUp(with event: NSEvent) {
    withUserLinkActivation(modifiers: event.modifierFlags) { super.mouseUp(with: event) }
  }

  func withUserLinkActivation(modifiers: NSEvent.ModifierFlags, _ action: () -> Void) {
    isUserActivatingLink = modifiers.contains(.command)
    defer { isUserActivatingLink = false }
    action()
  }
}

/// A narrow streaming policy boundary, not a terminal parser. It retains at most one pending ESC and no APC payload.
/// Unicode scalars are intentional: raw UTF-8 continuation byte 0x9f must never be mistaken for the C1 APC control.
struct TerminalAPCFilter {
  private enum State { case text, escape, apc, apcEscape }
  private var state = State.text

  mutating func consume(_ text: String) -> String {
    var result = String.UnicodeScalarView()
    for scalar in text.unicodeScalars {
      switch state {
      case .text:
        if scalar.value == 0x1b {
          state = .escape
        } else if scalar.value == 0x9f {
          // CAN clears any incomplete engine escape/string before the denied APC. It has no visible ground-state effect.
          result.append("\u{18}")
          state = .apc
        } else {
          result.append(scalar)
        }
      case .escape:
        if scalar.value == 0x5f || scalar.value == 0x9f {
          result.append("\u{18}")
          state = .apc
        } else if scalar.value == 0x1b {
          result.append("\u{1b}")
        } else {
          result.append("\u{1b}")
          result.append(scalar)
          state = .text
        }
      case .apc:
        if scalar.value == 0x1b { state = .apcEscape } else if Self.terminatesAPC(scalar) { state = .text }
      case .apcEscape:
        if scalar.value == 0x5c || Self.terminatesAPC(scalar) {
          state = .text
        } else if scalar.value != 0x1b {
          state = .apc
        }
      }
    }
    return String(result)
  }

  private static func terminatesAPC(_ scalar: Unicode.Scalar) -> Bool {
    [0x07, 0x18, 0x1a, 0x9c].contains(scalar.value)
  }
}

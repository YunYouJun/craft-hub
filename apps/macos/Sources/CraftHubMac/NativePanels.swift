import AppKit
import Carbon
import SwiftUI

/// Owns reusable native windows; closing a panel hides it without destroying its draft or search store.
@MainActor
final class NativePanels: NSObject, NSWindowDelegate {
  let palette = CommandPaletteModel()
  let capture = QuickCaptureModel()
  private let workbench: WorkbenchModel
  var showMainWindow: () -> Void = {}
  private var palettePanel: NSPanel?
  private var capturePanel: NSPanel?
  private var hotKey: EventHotKeyRef?
  private var hotKeyHandler: EventHandlerRef?

  init(workbench: WorkbenchModel) { self.workbench = workbench }

  func showPalette(mode: CommandPaletteModel.Category = .all) {
    PerformanceTrace.mark(.paletteRequested)
    capturePanel?.orderOut(nil)
    capture.closed()
    if palettePanel == nil {
      palettePanel = panel(
        title: L10n.text.commandPalette, showsTitlebar: false,
        content: CommandPaletteView(
          model: palette,
          choose: { [weak self] in self?.choose($0) }, dismiss: { [weak self] in self?.palettePanel?.close() }))
    }
    palette.opened(mode: mode)
    palettePanel?.title = L10n.text.commandPalette
    present(palettePanel!)
    palettePanel!.displayIfNeeded()
    PerformanceTrace.mark(.palettePresented)
  }
  func showCapture() {
    PerformanceTrace.mark(.captureRequested)
    palettePanel?.orderOut(nil)
    palette.closed()
    if capturePanel == nil {
      capturePanel = panel(
        title: L10n.text.copy("快速记录", "Quick Capture"),
        content: QuickCaptureView(
          model: capture,
          dismiss: { [weak self] in self?.capturePanel?.close() },
          openIntegrations: { [weak self] in
            self?.capturePanel?.close()
            self?.navigate(.marketplace)
          }))
    }
    capture.opened()
    capturePanel?.title = L10n.text.copy("快速记录", "Quick Capture")
    present(capturePanel!)
    capturePanel!.displayIfNeeded()
    PerformanceTrace.mark(.capturePresented)
  }
  private func panel<Content: View>(title: String, showsTitlebar: Bool = true, content: Content) -> NSPanel {
    let panel = KeyPanel(
      contentRect: .zero,
      styleMask: showsTitlebar ? [.titled, .closable, .fullSizeContentView] : [.borderless], backing: .buffered,
      defer: false)
    panel.title = title
    panel.titlebarAppearsTransparent = true
    panel.titleVisibility = .hidden
    panel.isReleasedWhenClosed = false
    panel.hidesOnDeactivate = false
    panel.level = .floating
    panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
    if !showsTitlebar {
      panel.isOpaque = false
      panel.backgroundColor = .clear
      panel.hasShadow = true
      panel.isMovableByWindowBackground = true
    }
    panel.contentView = NSHostingView(rootView: content.padding(.top, showsTitlebar ? 16 : 0))
    panel.delegate = self
    panel.center()
    return panel
  }
  private func present(_ panel: NSPanel) {
    NSApp.activate(ignoringOtherApps: true)
    panel.makeKeyAndOrderFront(nil)
  }
  func windowWillClose(_ notification: Notification) {
    if notification.object as? NSWindow === capturePanel { capture.closed() }
    if notification.object as? NSWindow === palettePanel { palette.closed() }
  }
  private func navigate(_ destination: Destination) {
    showMainWindow()
    workbench.selection = destination
    workbench.select(destination)
  }
  private func choose(_ item: CommandPaletteModel.Item) {
    palettePanel?.close()
    switch item.action {
    case .destination(let destination): navigate(destination)
    case .settings:
      showMainWindow()
      workbench.run("settings")
    case .webPath(let path):
      showMainWindow()
      workbench.navigateToWebPath(path)
    case .capture: showCapture()
    case .reload:
      showMainWindow()
      workbench.reload()
    case .project(let project, let capability):
      showMainWindow()
      if item.category == .commands, let capability {
        workbench.showProjectCommand(project, capability: capability)
      } else {
        workbench.selectProject(project, capability: capability)
      }
    }
  }
  /// Carbon registers a single explicit shortcut without recording keyboard events or requesting Input Monitoring.
  func registerShortcut() {
    var event = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    let context = Unmanaged.passUnretained(self).toOpaque()
    let installed = InstallEventHandler(
      GetApplicationEventTarget(),
      { _, event, context in
        guard let context else { return OSStatus(eventNotHandledErr) }
        Task { @MainActor in Unmanaged<NativePanels>.fromOpaque(context).takeUnretainedValue().showCapture() }
        return noErr
      }, 1, &event, context, &hotKeyHandler)
    let status =
      installed == noErr
      ? RegisterEventHotKey(
        UInt32(kVK_Space), UInt32(cmdKey | shiftKey),
        EventHotKeyID(signature: 0x4348_5542, id: 1), GetApplicationEventTarget(), 0, &hotKey) : installed
    if status != noErr {
      capture.shortcutNotice = L10n.text.copy(
        "⇧⌘Space 已被占用；请从菜单打开快速记录。", "⇧⌘Space is unavailable; open Quick Capture from the menu.")
    }
  }
  func stop() {
    capture.closed()
    if let hotKey { UnregisterEventHotKey(hotKey) }
    if let hotKeyHandler { RemoveEventHandler(hotKeyHandler) }
    hotKey = nil
    hotKeyHandler = nil
  }
}

private final class KeyPanel: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}

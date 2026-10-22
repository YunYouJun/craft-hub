import AppKit
import SwiftUI
import CraftHubMacCore

/// Native macOS prototype of the primary desktop host (ADR 0012).
@main
struct CraftHubApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  private var model: WorkbenchModel { delegate.model }
  private let text = L10n.text

  var body: some Scene {
    // A singleton Window quits on close. A value-keyed group keeps background capture alive and reuses the main window.
    WindowGroup("Craft Hub", id: "main", for: String.self) { _ in
      WorkbenchRootView(delegate: delegate)
    } defaultValue: { "main" }
    .defaultSize(width: 1280, height: 820)
    .windowToolbarStyle(.unified)
    .commands { NativeUpdateCommands(updater: delegate.updater) }
    .commands {
      CommandGroup(replacing: .newItem) {
        Button(text.copy("显示 Craft Hub", "Show Craft Hub")) { delegate.panels.showMainWindow() }
      }
      CommandGroup(replacing: .appSettings) {
        Button(text.settings) { model.run("settings") }.keyboardShortcut(",")
      }
      CommandGroup(after: .sidebar) {
        Button(text.commandPalette) { model.run("palette") }.keyboardShortcut("k")
        Button(text.copy("快速记录", "Quick Capture")) { model.run("capture") }.keyboardShortcut(.space, modifiers: [.command, .shift])
        Button(text.reload) { model.reload() }.keyboardShortcut("r")
        Divider()
        Button(text.back) { model.goBack() }.keyboardShortcut("[")
        Button(text.forward) { model.goForward() }.keyboardShortcut("]")
      }
    }
    Window(text.copy("软件更新", "Software Updates"), id: "software-updates") {
      NativeUpdateSettings(updater: delegate.updater)
    }
    .windowResizability(.contentSize)
  }
}

/// Owns the runtime sidecar for the whole app lifetime, so closing the window does not stop the runtime.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  let sidecar = RuntimeSidecar()
  let model = WorkbenchModel()
  let updater = NativeUpdater()
  lazy var panels = NativePanels(workbench: model)
  private var terminating = false

  func applicationDidFinishLaunching(_ notification: Notification) {
    model.presentPanel = { [weak self] name, mode in
      if name == "capture" { self?.panels.showCapture() }
      else { self?.panels.showPalette(mode: CommandPaletteModel.Category(rawValue: mode ?? "all") ?? .all) }
    }
    sidecar.onConnectionChange = { [weak self] connection in
      guard let self else { return }
      let client = connection.map { RuntimeAPIClient(connection: $0) }
      panels.palette.connect(client)
      panels.capture.connect(client)
      if let connection { model.connect(connection) }
    }
    model.restartRuntime = { [weak self] in
      guard let self, case .ready(let connection, _) = sidecar.state else { throw RuntimeAPIError.invalidResponse }
      guard !panels.capture.busy else { throw RuntimeAPIError.rejected(409, "Finish the current capture operation before restarting.") }
      try await RuntimeAPIClient(connection: connection).requireIdleRuntime()
      guard case .ready(let current, _) = sidecar.state, current == connection, !panels.capture.busy else { throw RuntimeAPIError.invalidResponse }
      // Let the initiating bridge call finish before replacing its web view.
      DispatchQueue.main.async { [weak self] in self?.sidecar.start() }
    }
    panels.registerShortcut()
    sidecar.start()
    updater.start()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard !terminating else { return .terminateLater }
    terminating = true
    Task {
      let accepted = await NativeTermination.prepare(requireIdle: {
        guard !self.panels.capture.busy else { throw RuntimeAPIError.rejected(409, "A capture operation is still running.") }
        if case .ready(let connection, _) = self.sidecar.state {
          try await RuntimeAPIClient(connection: connection).requireIdleRuntime()
        }
      }, confirmInterruption: { _ in
        let alert = NSAlert()
        alert.messageText = L10n.text.copy("仍有工作在进行中", "Work may still be in progress")
        alert.informativeText = L10n.text.copy("有任务尚未完成，或无法确认运行时状态。退出会中断当前工作。", "Tasks are still running, or the runtime state could not be checked. Quitting will interrupt current work.")
        alert.addButton(withTitle: L10n.text.copy("取消", "Cancel"))
        alert.addButton(withTitle: L10n.text.copy("仍然退出", "Quit Anyway"))
        return alert.runModal() == .alertSecondButtonReturn
      }, shutdown: {
        self.panels.stop()
        await self.sidecar.stopAndWait()
      })
      self.terminating = accepted
      sender.reply(toApplicationShouldTerminate: accepted)
    }
    return .terminateLater
  }

  func applicationWillTerminate(_ notification: Notification) {
    panels.stop()
    sidecar.stop()
  }
}


private struct WorkbenchRootView: View {
  @Environment(\.openWindow) private var openWindow
  let delegate: AppDelegate
  var body: some View {
    ContentView(model: delegate.model, sidecar: delegate.sidecar)
      .frame(minWidth: 900, minHeight: 620)
      .onAppear { delegate.panels.showMainWindow = { openWindow(id: "main", value: "main") } }
  }
}

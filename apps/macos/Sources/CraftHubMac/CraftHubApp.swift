import AppKit
import SwiftUI

/// Native macOS prototype of the primary desktop host (ADR 0012).
@main
struct CraftHubApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @State private var model = WorkbenchModel()
  private let text = L10n.text

  var body: some Scene {
    Window("Craft Hub", id: "main") {
      ContentView(model: model, sidecar: delegate.sidecar)
        .frame(minWidth: 900, minHeight: 620)
    }
    .defaultSize(width: 1280, height: 820)
    .windowToolbarStyle(.unified)
    .commands {
      CommandGroup(replacing: .appSettings) {
        Button(text.settings) { model.run("settings") }.keyboardShortcut(",")
      }
      CommandGroup(after: .sidebar) {
        Button(text.commandPalette) { model.run("palette") }.keyboardShortcut("k")
        Button(text.reload) { model.reload() }.keyboardShortcut("r")
        Divider()
        Button(text.back) { model.goBack() }.keyboardShortcut("[")
        Button(text.forward) { model.goForward() }.keyboardShortcut("]")
      }
    }
  }
}

/// Owns the runtime sidecar for the whole app lifetime, so closing the window does not stop the runtime.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  let sidecar = RuntimeSidecar()

  func applicationDidFinishLaunching(_ notification: Notification) {
    sidecar.start()
  }

  func applicationWillTerminate(_ notification: Notification) {
    sidecar.stop()
  }
}

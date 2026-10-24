import AppKit
import CraftHubMacCore
import SwiftUI

/// SwiftUI owns the scene. This bridge adds profile-specific geometry and disconnected-display recovery only.
struct WindowRestoration: NSViewRepresentable {
  func makeCoordinator() -> Coordinator { Coordinator() }
  func makeNSView(context: Context) -> WindowProbe {
    let probe = WindowProbe()
    probe.changed = { [weak coordinator = context.coordinator] window in coordinator?.attach(window) }
    return probe
  }
  func updateNSView(_ view: WindowProbe, context: Context) {}
  static func dismantleNSView(_ view: WindowProbe, coordinator: Coordinator) { coordinator.detach() }

  @MainActor final class WindowProbe: NSView {
    var changed: ((NSWindow?) -> Void)?
    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      changed?(window)
    }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
  }

  @MainActor final class Coordinator {
    private weak var window: NSWindow?
    private var observers: [NSObjectProtocol] = []
    private var pendingSave: Task<Void, Never>?
    private var fullscreen = false
    private let defaults = NativeStorage.defaults
    private let key = "nativeMainWindowFrame"

    func attach(_ window: NSWindow?) {
      guard self.window !== window else { return }
      detach()
      guard let window else { return }
      self.window = window
      fullscreen = window.styleMask.contains(.fullScreen)
      if !fullscreen, let data = defaults.data(forKey: key),
        let geometry = try? JSONDecoder().decode(WindowGeometry.self, from: data),
        let frame = geometry.restored(on: NSScreen.screens.map(\.visibleFrame))
      {
        window.setFrame(frame, display: false)
      }
      for name in [NSWindow.didMoveNotification, NSWindow.didResizeNotification] {
        observe(name, object: window) { [weak self] in self?.scheduleSave() }
      }
      observe(NSWindow.willCloseNotification, object: window) { [weak self] in self?.save() }
      observe(NSWindow.willEnterFullScreenNotification, object: window) { [weak self] in
        self?.save()
        self?.fullscreen = true
      }
      observe(NSWindow.didExitFullScreenNotification, object: window) { [weak self] in
        self?.fullscreen = false
        self?.scheduleSave()
      }
      observe(NSApplication.didChangeScreenParametersNotification, object: nil) { [weak self] in
        guard let self, let window = self.window, !fullscreen,
          let frame = WindowGeometry(window.frame).restored(on: NSScreen.screens.map(\.visibleFrame))
        else { return }
        if frame != window.frame { window.setFrame(frame, display: true) }
      }
    }

    private func observe(_ name: Notification.Name, object: Any?, action: @escaping @MainActor () -> Void) {
      observers.append(
        NotificationCenter.default.addObserver(forName: name, object: object, queue: .main) { _ in
          MainActor.assumeIsolated { action() }
        })
    }
    private func scheduleSave() {
      pendingSave?.cancel()
      pendingSave = Task { [weak self] in
        do { try await Task.sleep(for: .milliseconds(200)) } catch { return }
        self?.save()
      }
    }
    private func save() {
      guard let window, !fullscreen, !window.styleMask.contains(.fullScreen), !window.isMiniaturized,
        let data = try? JSONEncoder().encode(WindowGeometry(window.frame))
      else { return }
      defaults.set(data, forKey: key)
    }
    func detach() {
      save()
      pendingSave?.cancel()
      pendingSave = nil
      observers.forEach(NotificationCenter.default.removeObserver)
      observers = []
      window = nil
    }
  }
}

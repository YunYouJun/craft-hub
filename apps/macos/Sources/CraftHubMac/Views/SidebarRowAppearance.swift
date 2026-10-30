import AppKit
import SwiftUI

/// Explicit symbol and title layout keeps both visible when AppKit changes the row's selection emphasis.
struct SidebarDestinationLabel: View {
  let destination: Destination

  var body: some View {
    HStack(spacing: 9) {
      Image(systemName: destination.symbol).frame(width: 18, height: 18).accessibilityHidden(true)
      Text(destination.title)
    }.foregroundStyle(Color(nsColor: .labelColor))
  }
}

/// Keep the system's sidebar selection geometry and accessibility, with neutral emphasis behind brand artwork.
struct SidebarRowAppearance: ViewModifier {
  let selected: Bool

  func body(content: Content) -> some View {
    content.background {
      if selected {
        SidebarSelectionAppearance().frame(width: 0, height: 0).allowsHitTesting(false).accessibilityHidden(true)
      }
    }
  }
}

private struct SidebarSelectionAppearance: NSViewRepresentable {
  func makeNSView(context: Context) -> SidebarSelectionProbe { SidebarSelectionProbe() }
  func updateNSView(_ view: SidebarSelectionProbe, context: Context) { view.configure() }
  static func dismantleNSView(_ view: SidebarSelectionProbe, coordinator: ()) { view.stop() }
}

/// Only the selected row observes native window updates; there are no polling timers or delegate replacements.
final class SidebarSelectionProbe: NSView {
  private var observation: NSObjectProtocol?
  private weak var observedWindow: NSWindow?

  override func viewDidMoveToSuperview() {
    super.viewDidMoveToSuperview()
    configure()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    configure()
  }

  func configure() {
    if observedWindow !== window {
      stop()
      observedWindow = window
      if let window {
        observation = NotificationCenter.default.addObserver(
          forName: NSWindow.didUpdateNotification, object: window, queue: .main
        ) { [weak self] _ in
          MainActor.assumeIsolated { self?.apply() }
        }
      }
    }
    apply()
  }

  func apply() {
    var ancestor = superview
    while let view = ancestor {
      if let row = view as? NSTableRowView {
        if row.isSelected && row.isEmphasized {
          row.isEmphasized = false
          row.needsDisplay = true
        }
        return
      }
      ancestor = view.superview
    }
  }

  func stop() {
    if let observation { NotificationCenter.default.removeObserver(observation) }
    observation = nil
    observedWindow = nil
  }
}

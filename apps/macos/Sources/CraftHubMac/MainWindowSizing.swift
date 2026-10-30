import AppKit
import SwiftUI

@MainActor private protocol MainWindowHostingSizeControl: AnyObject {
  func disableContentSizeConstraints() -> Bool
}

extension NSHostingView: MainWindowHostingSizeControl {
  fileprivate func disableContentSizeConstraints() -> Bool {
    let changed = !sizingOptions.isEmpty
    sizingOptions = []
    return changed
  }
}

/// The main workbench already has a window-owned frame; content changes must not remeasure its size limits.
@MainActor enum MainWindowSizing {
  enum Outcome: Equatable {
    case contentSizingDisabled
    case alreadyWindowSized
    case hostingViewUnavailable
  }

  @discardableResult static func configure(_ window: NSWindow, from probe: NSView? = nil) -> Outcome {
    guard let host = hostingView(in: window, from: probe) else {
      PerformanceTrace.mark(.mainWindowSizingHostUnavailable)
      return .hostingViewUnavailable
    }
    let changed = host.disableContentSizeConstraints()
    let minimum = NSSize(width: 900, height: 620)
    if window.contentMinSize != minimum { window.contentMinSize = minimum }
    PerformanceTrace.mark(changed ? .mainWindowContentSizingDisabled : .mainWindowAlreadyWindowSized)
    return changed ? .contentSizingDisabled : .alreadyWindowSized
  }

  private static func hostingView(in window: NSWindow, from probe: NSView?) -> MainWindowHostingSizeControl? {
    if let host = window.contentView as? MainWindowHostingSizeControl { return host }
    guard let probe, probe.window === window else { return nil }
    var current: NSView? = probe
    var outermostHost: MainWindowHostingSizeControl?
    while let view = current {
      if let host = view as? MainWindowHostingSizeControl { outermostHost = host }
      if view === window.contentView { break }
      current = view.superview
    }
    return outermostHost
  }
}

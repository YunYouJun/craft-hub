import AppKit
import SwiftUI
import WebKit

/// Attaches the app-owned browser session to a window without reloading its page or one-use bootstrap.
struct WorkbenchWebView: NSViewRepresentable {
  let url: URL
  let model: WorkbenchModel

  func makeNSView(context: Context) -> WorkbenchWebContainer {
    WorkbenchWebContainer(webView: model.webSession(url: url).webView)
  }

  func updateNSView(_ view: WorkbenchWebContainer, context: Context) {}

  static func dismantleNSView(_ view: WorkbenchWebContainer, coordinator: ()) { view.detach() }
}

/// SwiftUI can propose a zero frame while recreating a window. Keep it away from the retained web viewport:
/// responsive web layouts may remount editors when they cross a breakpoint, losing their in-memory drafts.
final class WorkbenchWebContainer: NSVisualEffectView {
  private let webView: WKWebView

  init(webView: WKWebView) {
    self.webView = webView
    super.init(frame: .zero)
    material = .windowBackground
    blendingMode = .behindWindow
    state = .followsWindowActiveState
  }

  required init?(coder: NSCoder) { nil }

  override func layout() {
    super.layout()
    guard window != nil, bounds.width > 0, bounds.height > 0 else { return }
    if webView.superview !== self { addSubview(webView) }
    webView.frame = bounds
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    needsLayout = true
  }

  func detach() {
    if webView.superview === self { webView.removeFromSuperview() }
  }
}

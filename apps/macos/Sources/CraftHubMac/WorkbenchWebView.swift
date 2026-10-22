import AppKit
import SwiftUI
import WebKit

/// The web workbench as window content. The page learns it is embedded before any script runs, hides its own
/// chrome, and reports routes through the `craftHubNative` message handler.
struct WorkbenchWebView: NSViewRepresentable {
  let url: URL
  let model: WorkbenchModel

  func makeCoordinator() -> Coordinator { Coordinator(model: model, origin: url) }

  func makeNSView(context: Context) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = model.webSessionDataStore()
    let scripts = configuration.userContentController
    scripts.addUserScript(WKUserScript(source: "window.__craftHubNativeHost = 'macos'", injectionTime: .atDocumentStart, forMainFrameOnly: true))
    scripts.addUserScript(WKUserScript(source: DesktopBridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    scripts.add(context.coordinator, name: "craftHubNative")
    scripts.addScriptMessageHandler(context.coordinator.bridge, contentWorld: .page, name: DesktopBridge.handlerName)
    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = context.coordinator
    webView.uiDelegate = context.coordinator
    webView.allowsBackForwardNavigationGestures = true
    webView.isInspectable = true
    context.coordinator.observe(webView)
    context.coordinator.bridge.webView = webView
    model.webWillLoad()
    model.webView = webView
    webView.load(URLRequest(url: url))
    return webView
  }

  func updateNSView(_ webView: WKWebView, context: Context) {}

  static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
    if coordinator.model.webView === webView { coordinator.model.webWillLoad(); coordinator.model.webView = nil }
    webView.configuration.userContentController.removeScriptMessageHandler(forName: "craftHubNative")
    webView.configuration.userContentController.removeScriptMessageHandler(forName: DesktopBridge.handlerName, contentWorld: .page)
  }

  @MainActor
  final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    let model: WorkbenchModel
    let origin: URL
    let bridge: DesktopBridge
    private var observations: [NSKeyValueObservation] = []

    init(model: WorkbenchModel, origin: URL) {
      self.model = model
      self.origin = origin
      bridge = DesktopBridge(origin: origin)
      bridge.restartRuntime = { [weak model] in try await model?.restartRuntime?() }
    }

    func observe(_ webView: WKWebView) {
      let update: (WKWebView) -> Void = { [weak self] view in
        let back = view.canGoBack
        let forward = view.canGoForward
        Task { @MainActor in self?.model.historyChanged(back: back, forward: forward) }
      }
      observations = [
        webView.observe(\.canGoBack) { view, _ in update(view) },
        webView.observe(\.canGoForward) { view, _ in update(view) },
      ]
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
      let source = message.frameInfo.securityOrigin
      guard message.frameInfo.isMainFrame, source.protocol == origin.scheme, source.host == origin.host,
            source.port == origin.port ?? 0 else { return }
      guard let body = message.body as? [String: Any] else { return }
      switch body["type"] as? String {
      case "route": if let path = body["path"] as? String { model.routeChanged(path) }
      case "ready": model.webBecameReady()
      case "palette": model.presentPanel?("palette", body["mode"] as? String)
      case "capture": model.presentPanel?("capture", nil)
      default: break
      }
    }

    /// The workbench stays on its local origin; HTTPS links open in the default browser.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
      guard let target = action.request.url else { return decisionHandler(.cancel) }
      if target.scheme == origin.scheme && target.host == origin.host && target.port == origin.port {
        return decisionHandler(.allow)
      }
      if target.scheme == "https", action.navigationType == .linkActivated {
        NSWorkspace.shared.open(target)
      }
      decisionHandler(.cancel)
    }

    /// Links that ask for a new window never get one; HTTPS targets open in the default browser instead.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
      if let target = action.request.url, target.scheme == "https" {
        NSWorkspace.shared.open(target)
      }
      return nil
    }
  }
}

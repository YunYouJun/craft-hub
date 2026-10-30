import AppKit
import CraftHubMacCore
import WebKit

/// An on-demand, memory-only browser session. Keep its DOM, drafts and back/forward list until the runtime changes.
@MainActor
final class WorkbenchWebSession {
  let webView: WKWebView
  private let coordinator: Coordinator

  init(url: URL, model: WorkbenchModel) {
    coordinator = Coordinator(model: model, origin: url)
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    let scripts = configuration.userContentController
    scripts.addUserScript(
      WKUserScript(
        source: "window.__craftHubNativeHost = 'macos'", injectionTime: .atDocumentStart, forMainFrameOnly: true))
    scripts.addUserScript(
      WKUserScript(source: DesktopBridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    scripts.add(coordinator, name: "craftHubNative")
    scripts.addScriptMessageHandler(coordinator.bridge, contentWorld: .page, name: DesktopBridge.handlerName)
    webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = coordinator
    webView.uiDelegate = coordinator
    webView.allowsBackForwardNavigationGestures = true
    webView.isInspectable = true
    coordinator.observe(webView)
    coordinator.bridge.webView = webView
    model.webWillLoad()
    PerformanceTrace.mark(.webRequested)
    webView.load(URLRequest(url: url))
  }

  /// A new sidecar has a different authentication session; never reuse the previous page or its native handlers.
  func invalidate() {
    webView.stopLoading()
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
    coordinator.invalidate()
    webView.configuration.userContentController.removeScriptMessageHandler(forName: "craftHubNative")
    webView.configuration.userContentController.removeScriptMessageHandler(
      forName: DesktopBridge.handlerName, contentWorld: .page)
  }

  @MainActor
  private final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private weak var model: WorkbenchModel?
    let origin: URL
    let bridge: DesktopBridge
    private let generation: UUID
    private var observations: [NSKeyValueObservation] = []
    private var inactiveObserver: NSObjectProtocol?

    init(model: WorkbenchModel, origin: URL) {
      self.model = model
      self.origin = origin
      generation = model.connectionGeneration
      bridge = DesktopBridge(origin: origin)
      super.init()
      bridge.restartRuntime = { [weak model] in try await model?.restartRuntime?() }
      bridge.openPluginManagement = { [weak model] catalog in try model?.openPluginManagement(catalogURL: catalog) }
      let generation = model.connectionGeneration
      bridge.cloudAction = { [weak model] action in
        guard let model, model.connectionGeneration == generation else { throw NativeHostChannelError.closed }
        return try await model.cloud.bridge(action)
      }
      bridge.codexActivityAction = { [weak model] action in
        guard let model, model.connectionGeneration == generation else { throw NativeHostChannelError.closed }
        return try await model.codexActivity.bridge(action)
      }
      bridge.resourceAction = { [weak model] action, input in
        guard let model, model.connectionGeneration == generation else { throw NativeHostChannelError.closed }
        return try await model.resourceBridge.perform(action, input: input)
      }
      inactiveObserver = NotificationCenter.default.addObserver(
        forName: NSApplication.didResignActiveNotification, object: nil, queue: .main
      ) { [weak self] _ in
        Task { @MainActor in
          guard let self, let model = self.model, model.connectionGeneration == self.generation else { return }
          model.webView?.evaluateJavaScript(
            "window.dispatchEvent(new Event('craft-hub-conceal'))", completionHandler: nil)
        }
      }
    }

    func invalidate() {
      if let inactiveObserver { NotificationCenter.default.removeObserver(inactiveObserver) }
      inactiveObserver = nil
      observations.removeAll()
      model = nil
      bridge.webView = nil
      bridge.restartRuntime = nil
      bridge.openPluginManagement = nil
      bridge.cloudAction = nil
      bridge.codexActivityAction = nil
      bridge.resourceAction = nil
    }

    func observe(_ webView: WKWebView) {
      let update: (WKWebView) -> Void = { [weak self] view in
        let back = view.canGoBack
        let forward = view.canGoForward
        Task { @MainActor [weak self] in
          guard let self, let model, model.connectionGeneration == generation, model.webView === view else { return }
          model.historyChanged(back: back, forward: forward)
        }
      }
      observations = [
        webView.observe(\.canGoBack) { view, _ in update(view) },
        webView.observe(\.canGoForward) { view, _ in update(view) },
      ]
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
      guard let model, model.connectionGeneration == generation, model.webView === message.webView else { return }
      let source = message.frameInfo.securityOrigin
      guard message.frameInfo.isMainFrame, source.protocol == origin.scheme, source.host == origin.host,
        source.port == origin.port ?? 0
      else { return }
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
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
      model?.resourceBridge.invalidate()
    }

    func webView(
      _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
      decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
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
    func webView(
      _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
      windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
      if let target = action.request.url, target.scheme == "https" {
        NSWorkspace.shared.open(target)
      }
      return nil
    }
  }
}

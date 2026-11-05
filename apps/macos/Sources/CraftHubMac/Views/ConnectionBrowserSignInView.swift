import CraftHubMacCore
import CryptoKit
import SwiftUI
import WebKit

/// An isolated login surface with no desktop bridge. Only the declared cloud-session cookies leave this partition.
struct ConnectionBrowserSignInView: View {
  let request: ConnectionBrowserBridge.Request
  let save: (String) async -> Bool
  let cancel: () -> Void
  @State private var browser: ConnectionSignInBrowser
  private var text: L10n { .text }

  init(request: ConnectionBrowserBridge.Request, save: @escaping (String) async -> Bool, cancel: @escaping () -> Void) {
    self.request = request
    self.save = save
    self.cancel = cancel
    _browser = State(initialValue: ConnectionSignInBrowser(policy: request.declaration))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text(request.declaration.title).font(.title2)
        Spacer()
        Button(text.copy("取消", "Cancel"), action: cancel).disabled(browser.busy)
      }
      Text(request.declaration.cookieOrigin).font(.caption).textSelection(.enabled)
      Text(
        text.copy(
          "在下方完成登录，成功后将自动连接。登录会话仅保存在本机系统凭据库。",
          "Sign in below to connect automatically. The cloud session stays in this device's system credential store.")
      ).foregroundStyle(.secondary)
      ConnectionSignInWebView(browser: browser).frame(minWidth: 780, minHeight: 540)
      HStack {
        if browser.busy { ProgressView().controlSize(.small) }
        Text(browser.message ?? text.copy("等待完成登录…", "Waiting for sign-in…")).foregroundStyle(.secondary)
        Spacer()
        Button(text.copy("重试连接", "Retry connection")) { Task { await browser.capture(force: true) } }
          .disabled(browser.busy)
      }
    }
    .padding(20)
    .task { browser.open(save: save) }
    .onDisappear { browser.close() }
    .interactiveDismissDisabled(browser.busy)
  }
}

@MainActor @Observable
final class ConnectionSignInBrowser: NSObject, WKNavigationDelegate, WKUIDelegate, WKHTTPCookieStoreObserver {
  let webView: WKWebView
  private let policy: ConnectionBrowserAuthorization
  private var save: ((String) async -> Bool)?
  private var generation = UUID()
  private var lastDigest: String?
  private(set) var busy = false
  private(set) var message: String?

  init(policy: ConnectionBrowserAuthorization, dataStore: WKWebsiteDataStore? = nil) {
    self.policy = policy
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = dataStore ?? .nonPersistent()
    webView = WKWebView(frame: .zero, configuration: configuration)
    super.init()
    webView.navigationDelegate = self
    webView.uiDelegate = self
  }

  func open(save: @escaping (String) async -> Bool) {
    guard (try? policy.validate()) != nil, let url = URL(string: policy.url) else { return }
    self.save = save
    generation = UUID()
    webView.configuration.websiteDataStore.httpCookieStore.add(self)
    webView.load(URLRequest(url: url))
  }

  func close() {
    generation = UUID()
    save = nil
    webView.configuration.websiteDataStore.httpCookieStore.remove(self)
    webView.stopLoading()
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
  }

  func capture(force: Bool = false) async {
    guard !busy, let save, let page = webView.url, ConnectionBrowserAuthorization.origin(page) == policy.cookieOrigin
    else { return }
    let stamp = generation
    let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
    guard stamp == generation, let current = webView.url,
      let header = policy.cookieHeader(cookies, at: current)
    else { return }
    let digest = SHA256.hash(data: Data(header.utf8)).map { String(format: "%02x", $0) }.joined()
    guard force || digest != lastDigest else { return }
    lastDigest = digest
    busy = true
    message = L10n.text.copy("正在验证并保存连接…", "Verifying and saving the connection…")
    let connected = await save(header)
    guard generation == stamp else { return }
    busy = false
    message =
      connected
      ? L10n.text.copy("已连接", "Connected")
      : L10n.text.copy("连接未完成，请确认已进入云服务页面后重试。", "Connection did not finish. Open the cloud page and retry.")
  }

  nonisolated func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
    Task { @MainActor [weak self] in await self?.capture() }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    Task { await capture() }
  }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url, url.scheme == "https" else { return decisionHandler(.cancel) }
    if navigationAction.targetFrame?.isMainFrame != false && !policy.allows(url) {
      message = L10n.text.copy("登录页面跳转到了未允许的地址，已停止跳转。", "The sign-in page tried to leave the allowed sites.")
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = navigationAction.request.url, policy.allows(url) { webView.load(navigationAction.request) }
    return nil
  }
}

private struct ConnectionSignInWebView: NSViewRepresentable {
  let browser: ConnectionSignInBrowser
  func makeNSView(context: Context) -> WKWebView { browser.webView }
  func updateNSView(_ view: WKWebView, context: Context) {}
}

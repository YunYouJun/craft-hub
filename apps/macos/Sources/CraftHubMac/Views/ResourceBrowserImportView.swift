import CraftHubMacCore
import CryptoKit
import SwiftUI
import WebKit

/// A separate browser has no desktop bridge or local runtime access. Only an explicit import submits metadata.
struct ResourceBrowserImportView: View {
  let declaration: IntegrationResourcePage.BrowserImport
  let vault: ResourceCredentialVault
  let save: (String) async -> Bool
  @Environment(\.dismiss) private var dismiss
  @State private var browser: ResourceImportBrowser
  @State private var batch: ResourceBrowserImportBatch?
  @State private var batchGeneration: Int?
  @State private var busy = false
  @State private var message: String?
  private var text: L10n { .text }

  init(
    declaration: IntegrationResourcePage.BrowserImport, vault: ResourceCredentialVault,
    save: @escaping (String) async -> Bool
  ) {
    self.declaration = declaration
    self.vault = vault
    self.save = save
    _browser = State(initialValue: ResourceImportBrowser(profile: NativeStorage.directory, source: declaration))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text(declaration.title).font(.title2)
        Spacer()
        Button(text.copy("关闭", "Close")) { dismiss() }.disabled(busy)
      }
      Text(declaration.url).font(.caption).textSelection(.enabled)
      Text(
        text.copy(
          "在下方完成登录，再刷新预览。账号信息加入清单，密码仅保存在本机 Keychain。",
          "Sign in below, then refresh the preview. Credentials remain in this Mac's Keychain.")
      )
      .foregroundStyle(.secondary)
      ResourceImportWebView(browser: browser).frame(minWidth: 760, minHeight: 460)
      if let message { Text(message).foregroundStyle(.secondary) }
      if let batch {
        Text(
          text.copy(
            "待导入 \(batch.count) 条，含 \(batch.credentials.count) 份本机密码",
            "Import \(batch.count) records with \(batch.credentials.count) local passwords"))
      }
      HStack {
        Button(text.copy("刷新预览", "Refresh Preview")) {
          Task {
            busy = true
            batch = nil
            defer { busy = false }
            do {
              batch = try await browser.query(declaration)
              batchGeneration = browser.currentGeneration
              message = nil
            } catch {
              message =
                (error as? ResourceImportReadFailure)?.message
                ?? text.copy(
                  "读取失败。请确认已登录账号页面，或检查网络后重试。",
                  "Cannot read records. Sign in to the account page and check your connection.")
            }
          }
        }.disabled(busy)
        Spacer()
        if busy { ProgressView().controlSize(.small) }
        Button(text.copy("导入到我的清单", "Import into My List")) {
          guard let batch, batch.count > 0 else { return }
          guard browser.isCurrent(batchGeneration, declaration) else {
            self.batch = nil
            message = text.copy("账号页面已变化，请重新刷新预览。", "The account page changed. Refresh the preview again.")
            return
          }
          Task {
            busy = true
            defer { busy = false }
            guard await save(batch.metadataJSON) else {
              message = text.copy(
                "账号导入未完成，请关闭窗口查看错误并刷新后重试。",
                "Import did not finish. Close this window, review the error and refresh before retrying.")
              self.batch = nil
              return
            }
            do {
              for (key, password) in batch.credentials { try await vault.save(password, key: key) }
              self.batch = nil
              dismiss()
            } catch {
              self.batch = nil
              message = text.copy(
                "账号信息已保存，部分密码未能保存。请检查 Keychain 后重新导入。",
                "Metadata was saved, but some passwords could not be saved. Check Keychain and import again.")
            }
          }
        }.buttonStyle(.borderedProminent).disabled(busy || batch?.count == nil || batch?.count == 0)
      }
    }
    .padding(20)
    .task { browser.open(declaration) }
    .onDisappear {
      batch = nil
      browser.close()
    }
    .interactiveDismissDisabled(busy)
  }
}

@MainActor
@Observable
final class ResourceImportBrowser: NSObject, WKNavigationDelegate, WKUIDelegate {
  let webView: WKWebView
  private var declaration: IntegrationResourcePage.BrowserImport?
  private var generation = 0
  var currentGeneration: Int { generation }

  func isCurrent(_ stamp: Int?, _ source: IntegrationResourcePage.BrowserImport) -> Bool {
    guard stamp == generation, let url = webView.url else { return false }
    return source.isAccountPage(url)
  }

  init(profile: URL, source: IntegrationResourcePage.BrowserImport, dataStore: WKWebsiteDataStore? = nil) {
    let configuration = WKWebViewConfiguration()
    // Reuse only this profile/source's login partition, without a host bridge or shared browser cookies.
    let hash = SHA256.hash(data: Data((profile.path + "\n" + source.url).utf8)).map { String(format: "%02x", $0) }
      .joined()
    let id = String(hash.prefix(32))
    let groups = [
      String(id.prefix(8)), String(id.dropFirst(8).prefix(4)), String(id.dropFirst(12).prefix(4)),
      String(id.dropFirst(16).prefix(4)), String(id.suffix(12)),
    ]
    configuration.websiteDataStore =
      dataStore ?? WKWebsiteDataStore(forIdentifier: UUID(uuidString: groups.joined(separator: "-"))!)
    webView = WKWebView(frame: .zero, configuration: configuration)
    super.init()
    webView.navigationDelegate = self
    webView.uiDelegate = self
  }

  func open(_ value: IntegrationResourcePage.BrowserImport) {
    guard (try? value.validate()) != nil, let url = URL(string: value.url) else { return }
    declaration = value
    generation += 1
    webView.load(URLRequest(url: url))
  }

  func close() {
    generation += 1
    declaration = nil
    webView.stopLoading()
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
  }

  func query(_ value: IntegrationResourcePage.BrowserImport) async throws -> ResourceBrowserImportBatch {
    guard let current = webView.url, value.isAccountPage(current) else { throw ResourceImportReadFailure.page }
    let stamp = generation
    let specification = try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
    guard let scriptURL = Bundle.module.url(forResource: "query", withExtension: "txt", subdirectory: "BrowserImport")
    else {
      throw ResourceImportReadFailure.resource
    }
    let script = try String(contentsOf: scriptURL, encoding: .utf8)
    let result: Any?
    do {
      result = try await evaluateRequest(script, arguments: ["spec": specification])
    } catch {
      let message = (error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? ""
      if message == "Error: login" || message == "login" { throw ResourceImportReadFailure.login }
      if message == "Error: unavailable" || message == "unavailable" { throw ResourceImportReadFailure.network }
      if message == "Error: invalid" || message == "invalid" { throw ResourceImportReadFailure.response }
      throw ResourceImportReadFailure.browser
    }
    guard generation == stamp, let current = webView.url, value.isAccountPage(current) else {
      throw ResourceImportReadFailure.page
    }
    do { return try value.prepare(result as Any) } catch { throw ResourceImportReadFailure.records }
  }

  /// Bridge the completion explicitly: the SDK's default completion overload otherwise infers Void as Any.
  func evaluateRequest(_ script: String, arguments: [String: Any]) async throws -> Any {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Any, Error>) in
      webView.callAsyncJavaScript(script, arguments: arguments, in: nil, in: .page) { result in
        continuation.resume(with: result)
      }
    }
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { generation += 1 }
  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    generation += 1
    guard let url = action.request.url, declaration?.allows(url) == true else { return decisionHandler(.cancel) }
    decisionHandler(.allow)
  }
  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = action.request.url, declaration?.allows(url) == true { webView.load(URLRequest(url: url)) }
    return nil
  }
}

private enum ResourceImportReadFailure: Error {
  case page, resource, login, network, response, browser, records
  @MainActor var message: String {
    let text = L10n.text
    switch self {
    case .page: return text.copy("账号页面已变化，请返回账号页后刷新。", "The page changed. Return to the account page and refresh.")
    case .resource:
      return text.copy("安装包缺少导入组件，请重新安装应用。", "The import component is missing. Reinstall the application.")
    case .login: return text.copy("页面登录信息尚未就绪，请完成登录后刷新。", "Page sign-in is not ready. Complete sign-in and refresh.")
    case .network:
      return text.copy("账号查询请求失败，请检查登录和网络后重试。", "The account request failed. Check sign-in and network, then retry.")
    case .response: return text.copy("账号来源返回了不兼容的数据，请稍后重试。", "The source returned incompatible data. Retry later.")
    case .browser:
      return text.copy("浏览器无法执行账号读取，请重新打开来源页面。", "The browser could not read accounts. Reopen the source page.")
    case .records:
      return text.copy("账号或密码字段格式不兼容，本次未导入。", "An account or credential field is incompatible. Nothing was imported.")
    }
  }
}

private struct ResourceImportWebView: NSViewRepresentable {
  let browser: ResourceImportBrowser
  func makeNSView(context: Context) -> WKWebView { browser.webView }
  func updateNSView(_ view: WKWebView, context: Context) {}
}

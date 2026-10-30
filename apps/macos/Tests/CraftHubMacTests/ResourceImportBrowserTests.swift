import AppKit
import CraftHubMacCore
import Foundation
import Testing
import WebKit

@testable import CraftHubMac

@MainActor
private final class ResourceImportTestPage: NSObject, WKNavigationDelegate {
  var pending: CheckedContinuation<Void, Never>?
  func load(_ webView: WKWebView) async {
    webView.navigationDelegate = self
    await withCheckedContinuation { continuation in
      pending = continuation
      webView.loadHTMLString("<html><body>Import request fixture</body></html>", baseURL: nil)
    }
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    pending?.resume()
    pending = nil
  }
}

@MainActor
@Test func browserImportsAwaitTheRealWebKitResultAndPropagateFailures() async throws {
  _ = NSApplication.shared
  let data = Data(
    #"{"id":"example","title":"Accounts","url":"https://accounts.example.com/list","allowedOrigins":["https://accounts.example.com"],"formId":"import","request":{"path":"/api/accounts","operatorGlobal":"currentUser","operatorParameter":"operator"},"response":{"recordsPath":["accounts"],"successField":"code","successValue":0},"credentials":{"keyField":"username","secretField":"password","availableField":"status","publicFields":["username","status"]}}"#
      .utf8)
  let source = try JSONDecoder().decode(IntegrationResourcePage.BrowserImport.self, from: data)
  let profile = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  let browser = ResourceImportBrowser(profile: profile, source: source, dataStore: .nonPersistent())
  defer { browser.close() }
  let page = ResourceImportTestPage()
  await page.load(browser.webView)
  let result = try await browser.evaluateRequest(
    "return await Promise.resolve({ count: expected });", arguments: ["expected": 4])
  #expect((result as? [String: Int])?["count"] == 4)
  await #expect(throws: (any Error).self) {
    try await browser.evaluateRequest("throw new Error('fixture failure');", arguments: [:])
  }
}

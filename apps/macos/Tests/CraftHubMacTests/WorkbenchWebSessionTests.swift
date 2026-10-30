import AppKit
import Foundation
import Network
import SwiftUI
import Testing
import WebKit

@testable import CraftHubMac

@MainActor @Test func webDraftAndHistorySurviveNativeNavigationAndWindowRecreation() async throws {
  let suite = "craft-hub-retained-browser-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = WorkbenchModel(defaults: defaults)
  defer { model.connect(nil) }
  // Serve a real document: loadHTMLString does not expose a normal WebKit back/forward list.
  let listener = try NWListener(using: .tcp, on: .any)
  defer { listener.cancel() }
  let html =
    """
    <!doctype html><textarea id="draft"></textarea><script>
    document.querySelector('#draft').value = 'unsaved draft';
    window.visits = [];
    window.__craftHubNavigate = path => window.visits.push(path);
    window.__craftHubSelect = () => {
      window.visits.push('project-selection');
      document.querySelector('#draft').value = 'project selection discarded the draft';
    };
    history.replaceState({}, '', '/integrations/fixture/view');
    history.pushState({}, '', '/integrations/fixture/view?tab=details');
    window.fixtureReady = true;
    </script>
    """
  let body = Data(html.utf8)
  let response =
    Data(
      "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        .utf8)
    + body
  listener.newConnectionHandler = { connection in
    connection.start(queue: .global())
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { _, _, _, _ in
      connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }
  }
  try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
    listener.stateUpdateHandler = { state in
      switch state {
      case .ready:
        listener.stateUpdateHandler = nil
        continuation.resume()
      case .failed(let error):
        listener.stateUpdateHandler = nil
        continuation.resume(throwing: error)
      default: break
      }
    }
    listener.start(queue: .global())
  }
  let port = try #require(listener.port)
  let url = URL(string: "http://127.0.0.1:\(port.rawValue)/")!
  model.navigateToWebPath("/integrations/fixture/view?scope=global&tab=details")
  let session = model.webSession(url: url)
  let webView = session.webView
  #expect(!webView.configuration.websiteDataStore.isPersistent)
  let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820), styleMask: [.titled, .closable], backing: .buffered,
    defer: false)
  window.isReleasedWhenClosed = false
  defer { window.close() }
  window.contentView = NSHostingView(rootView: WorkbenchWebView(url: url, model: model))
  window.contentView?.layoutSubtreeIfNeeded()
  let deadline = Date().addingTimeInterval(10)
  while (try? await webView.evaluateJavaScript("window.fixtureReady === true")) as? Bool != true {
    guard Date() < deadline else { throw URLError(.timedOut) }
    try await Task.sleep(for: .milliseconds(25))
  }
  model.webBecameReady()
  model.routeChanged("/integrations/fixture/view")
  #expect(
    try await webView.evaluateJavaScript("window.visits[0]") as? String
      == "/integrations/fixture/view?scope=global&tab=details")
  while !webView.canGoBack {
    guard Date() < deadline else { throw URLError(.timedOut) }
    try await Task.sleep(for: .milliseconds(25))
  }
  let protected = try await webView.callAsyncJavaScript(
    "await window.craftHubDesktop.setWorkbenchOperationPending(true); return true", arguments: [:], in: nil,
    contentWorld: .page)
  #expect(protected as? Bool == true)
  #expect(model.webOperationPending)
  model.selectSidebar(.builtin(.software))
  #expect(!model.presentsNativeContent && model.selection == .workbenches)
  let released = try await webView.callAsyncJavaScript(
    "await window.craftHubDesktop.setWorkbenchOperationPending(false); return true", arguments: [:], in: nil,
    contentWorld: .page)
  #expect(released as? Bool == true)
  #expect(!model.webOperationPending)
  let historyCount = webView.backForwardList.backList.count
  #expect(historyCount > 0)
  model.selectProject("native-inspection", capability: nil)
  #expect(model.presentsNativeContent && model.projectDetails.projectID == "native-inspection")
  #expect(model.webView === webView)
  #expect(try await webView.evaluateJavaScript("window.visits.length") as? Int == 1)
  #expect(try await webView.evaluateJavaScript("document.querySelector('#draft').value") as? String == "unsaved draft")
  #expect(try await webView.evaluateJavaScript("window.innerWidth") as? Int == 1280)
  try await webView.evaluateJavaScript(
    """
    window.viewportChanges = 0;
    matchMedia('(max-width: 900px)').addEventListener('change', () => {
      window.viewportChanges++;
      document.querySelector('#draft').value = 'editor remounted at a viewport breakpoint';
    });
    """)
  model.webWillLoad()
  model.showIntegrationWeb("/integrations/fixture/cancelled")
  model.select(.workbenches)
  model.select(.overview)
  model.webBecameReady()
  model.routeChanged("/integrations/fixture/view")
  model.selection = .workbenches
  model.showWebWorkbench()
  window.close()
  window.contentView = nil
  #expect(model.webView === webView)
  window.contentView = NSHostingView(rootView: WorkbenchWebView(url: url, model: model))
  window.contentView?.layoutSubtreeIfNeeded()
  #expect(model.webSession(url: url) === session)
  #expect(webView.backForwardList.backList.count == historyCount)
  #expect(try await webView.evaluateJavaScript("window.viewportChanges") as? Int == 0)
  #expect(try await webView.evaluateJavaScript("document.querySelector('#draft').value") as? String == "unsaved draft")
  // Resuming a section must not navigate away from its editor or replay the cold-start request.
  #expect(try await webView.evaluateJavaScript("window.visits.length") as? Int == 1)
  model.connect(nil)
  #expect(model.webView == nil && !model.webContentRequested)
  #expect(webView.navigationDelegate == nil && webView.uiDelegate == nil)
}

@MainActor @Test func aNativeSelectionCancelsAQueuedWebNavigationBeforeReadiness() {
  let model = WorkbenchModel()
  model.showIntegrationWeb("/integrations/fixture/view")
  model.selection = .software
  model.select(.software)
  model.webBecameReady()
  model.routeChanged("/overview")
  #expect(model.selection == .software && model.presentsNativeContent)
}

import AppKit
import Foundation
import Network
import Testing
import WebKit

@testable import CraftHubMac

/// Exercise the shipped styles in the actual embedded WebKit session, including backgrounds outside page content.
@MainActor @Test func embeddedWebSurfacesMatchSystemColors() async throws {
  let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  let source = repository.appendingPathComponent("apps/web/src")
  let css = try ["desktop.css", "styles/tokens.css", "styles.css", "styles/workbench-view.css"].map { path in
    try String(contentsOf: source.appendingPathComponent(path), encoding: .utf8)
      .components(separatedBy: .newlines).filter { !$0.hasPrefix("@import") }.joined(separator: "\n")
  }.joined(separator: "\n")
  let html =
    """
    <!doctype html><html><head><style>\(css)</style></head><body>
    <main class="workbench-view"><div id="card" style="background:var(--surface);color:var(--text)"></div></main>
    <div id="portal" style="background:var(--menu-background);color:var(--muted);border:1px solid var(--border)"></div>
    <script>
    document.documentElement.dataset.nativeHost = 'macos';
    document.documentElement.dataset.theme = 'dark';
    window.fixtureReady = true;
    </script></body></html>
    """
  let listener = try NWListener(using: .tcp, on: .any)
  defer { listener.cancel() }
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
  let model = WorkbenchModel()
  defer { model.connect(nil) }
  let webView = model.webSession(url: URL(string: "http://127.0.0.1:\(port.rawValue)/")!).webView
  let container = WorkbenchWebContainer(webView: webView)
  #expect(container.material == .windowBackground && container.blendingMode == .behindWindow)
  let deadline = Date().addingTimeInterval(10)
  while (try? await webView.evaluateJavaScript("window.fixtureReady === true")) as? Bool != true {
    guard Date() < deadline else { throw URLError(.timedOut) }
    try await Task.sleep(for: .milliseconds(25))
  }
  for (theme, name) in [("dark", NSAppearance.Name.darkAqua), ("light", .aqua), ("dark", .darkAqua)] {
    let appearance = try #require(NSAppearance(named: name))
    var expected: [String: String] = [:]
    appearance.performAsCurrentDrawingAppearance {
      for (key, color) in [
        ("window", NSColor.windowBackgroundColor), ("control", .controlBackgroundColor), ("label", .labelColor),
        ("secondary", .secondaryLabelColor), ("separator", .separatorColor),
      ] {
        let rgb = color.usingColorSpace(.sRGB)!
        expected[key] =
          "rgba(\(Int((rgb.redComponent * 255).rounded())),\(Int((rgb.greenComponent * 255).rounded())),\(Int((rgb.blueComponent * 255).rounded())),\(rgb.alphaComponent))"
      }
    }
    if NativeWorkbenchWebView.supportsWindowMaterial { expected["window"] = "transparent" }
    let matches = try await webView.callAsyncJavaScript(
      """
      document.documentElement.dataset.theme = theme;
      const probe = document.createElement('div');
      document.body.append(probe);
      const checks = [
        [document.documentElement, 'backgroundColor', 'window'],
        [document.body, 'backgroundColor', 'window'],
        [document.querySelector('main'), 'backgroundColor', 'window'],
        [document.querySelector('#card'), 'backgroundColor', 'control'],
        [document.querySelector('#card'), 'color', 'label'],
        [document.querySelector('#portal'), 'backgroundColor', 'control'],
        [document.querySelector('#portal'), 'color', 'secondary'],
        [document.querySelector('#portal'), 'borderTopColor', 'separator'],
      ];
      const failures = checks.flatMap(([element, property, key]) => {
        probe.style[property] = expected[key];
        const actual = getComputedStyle(element)[property];
        const target = getComputedStyle(probe)[property];
        return actual === target ? [] : [`${element.id || element.tagName}.${property}: ${actual} != ${target}`];
      });
      probe.remove();
      return failures;
      """, arguments: ["theme": theme, "expected": expected], in: nil, contentWorld: .page)
    #expect(matches as? [String] == [], "\(theme): \(String(describing: matches))")
  }
  if NativeWorkbenchWebView.supportsWindowMaterial {
    webView.frame = NSRect(x: 0, y: 0, width: 400, height: 300)
    let snapshot = try await webView.takeSnapshot(configuration: nil)
    let data = try #require(snapshot.tiffRepresentation)
    let bitmap = try #require(NSBitmapImageRep(data: data))
    #expect(try #require(bitmap.colorAt(x: 200, y: 200)).alphaComponent < 0.01)
  }
  try await webView.evaluateJavaScript(
    "document.getElementById('craft-hub-native-appearance').textContent = ':root { --native-window-background: red; }'")
  NotificationCenter.default.post(name: NSColor.systemColorsDidChangeNotification, object: nil)
  let restored = try await webView.evaluateJavaScript(
    "document.querySelectorAll('#craft-hub-native-appearance').length === 1 && !document.getElementById('craft-hub-native-appearance').textContent.includes(': red;')"
  )
  #expect(restored as? Bool == true)
  // Invalidating a retained session removes its system observers without touching another window's session.
  model.connect(nil)
  try await webView.evaluateJavaScript(
    "document.getElementById('craft-hub-native-appearance').textContent = 'invalidated'")
  NotificationCenter.default.post(name: NSColor.systemColorsDidChangeNotification, object: nil)
  #expect(
    try await webView.evaluateJavaScript("document.getElementById('craft-hub-native-appearance').textContent")
      as? String
      == "invalidated")
}

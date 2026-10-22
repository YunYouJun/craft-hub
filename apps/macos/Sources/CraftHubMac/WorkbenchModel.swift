import Foundation
import Observation
import WebKit

/// Shared state between the native chrome and the embedded web workbench.
@MainActor
@Observable
final class WorkbenchModel {
  var selection: Destination? = .overview
  private(set) var canGoBack = false
  private(set) var canGoForward = false
  /// The route the web workbench last reported; the sidebar follows it without navigating again.
  private(set) var route = "/overview"
  @ObservationIgnored weak var webView: WKWebView?
  @ObservationIgnored private var restoredLastDestination = false
  private static let lastDestinationKey = "lastDestination"

  func select(_ destination: Destination?) {
    guard let destination else { return }
    UserDefaults.standard.set(destination.rawValue, forKey: Self.lastDestinationKey)
    guard Destination.matching(path: route) != destination else { return }
    evaluate("window.__craftHubNavigate?.(\(Self.jsonString(destination.path)))")
  }

  func routeChanged(_ path: String) {
    route = path
    // Like native apps, reopen where the user left off once the workbench reports its first route.
    if !restoredLastDestination {
      restoredLastDestination = true
      let saved = UserDefaults.standard.string(forKey: Self.lastDestinationKey).flatMap(Destination.init(rawValue:))
      if let saved, saved != Destination.matching(path: path) {
        selection = saved
        return
      }
    }
    let destination = Destination.matching(path: path)
    if destination != selection { selection = destination }
  }

  func historyChanged(back: Bool, forward: Bool) {
    canGoBack = back
    canGoForward = forward
  }

  func goBack() { webView?.goBack() }
  func goForward() { webView?.goForward() }
  func reload() { webView?.reload() }
  func run(_ command: String) { evaluate("window.__craftHubCommand?.(\(Self.jsonString(command)))") }

  private func evaluate(_ script: String) {
    webView?.evaluateJavaScript(script, completionHandler: nil)
  }

  private static func jsonString(_ value: String) -> String {
    let data = (try? JSONSerialization.data(withJSONObject: [value])) ?? Data("[\"\"]".utf8)
    return String(decoding: data, as: UTF8.self).dropFirst().dropLast().description
  }
}

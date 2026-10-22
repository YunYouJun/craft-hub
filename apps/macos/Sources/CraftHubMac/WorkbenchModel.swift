import Foundation
import CraftHubMacCore
import Observation
import WebKit

/// Shared state between the native chrome and the embedded web workbench.
@MainActor
@Observable
final class WorkbenchModel {
  var selection: Destination? = .overview
  private(set) var machine: MachineModel?
  private(set) var showsWebContent = false
  var presentsNativeContent: Bool { selection?.isNative == true && !showsWebContent }
  private(set) var canGoBack = false
  private(set) var canGoForward = false
  /// The route the web workbench last reported; the sidebar follows it without navigating again.
  private(set) var route = "/overview"
  @ObservationIgnored weak var webView: WKWebView?
  @ObservationIgnored var restartRuntime: (() async throws -> Void)?
  @ObservationIgnored var presentPanel: ((String, String?) -> Void)?
  @ObservationIgnored private var webReady = false
  @ObservationIgnored private var webDataStore: WKWebsiteDataStore?
  @ObservationIgnored private var pendingSelection: String?
  @ObservationIgnored private var restoredLastDestination = false
  @ObservationIgnored private let defaults: UserDefaults
  private static let lastDestinationKey = "lastDestination"

  init(defaults: UserDefaults = .standard) { self.defaults = defaults }

  func select(_ destination: Destination?) {
    guard let destination else { return }
    showsWebContent = false
    defaults.set(destination.rawValue, forKey: Self.lastDestinationKey)
    guard !destination.isNative else { return }
    guard Destination.matching(path: route) != destination else { return }
    evaluate("window.__craftHubNavigate?.(\(Self.jsonString(destination.path)))")
  }

  func connect(_ connection: RuntimeConnection) {
    webReady = false
    webDataStore = nil
    machine = MachineModel(client: RuntimeAPIClient(connection: connection))
    showsWebContent = false
    restoredLastDestination = false
    canGoBack = false
    canGoForward = false
  }

  func showWebWorkbench() {
    showsWebContent = true
    if let selection { evaluate("window.__craftHubNavigate?.(\(Self.jsonString(selection.path)))") }
  }

  func routeChanged(_ path: String) {
    route = path
    // Like native apps, reopen where the user left off once the workbench reports its first route.
    if !restoredLastDestination {
      restoredLastDestination = true
      let saved = defaults.string(forKey: Self.lastDestinationKey).flatMap(Destination.init(rawValue:))
      if let saved, saved != Destination.matching(path: path) {
        selection = saved
        // A runtime restart may restore the already-selected destination, so onChange alone is insufficient.
        select(saved)
        return
      }
    }
    // The hidden web page may finish an earlier navigation while a native page is already selected.
    guard !presentsNativeContent else { return }
    let destination = Destination.matching(path: path)
    if destination != selection { selection = destination }
  }

  func historyChanged(back: Bool, forward: Bool) {
    canGoBack = back
    canGoForward = forward
  }

  func goBack() { webView?.goBack() }
  func goForward() { webView?.goForward() }
  func reload() {
    if presentsNativeContent {
      Task {
        if selection == .environment { await machine?.loadEnvironment(force: true) }
        if selection == .software { await machine?.loadSoftware(force: true) }
      }
    } else { webView?.reload() }
  }
  func run(_ command: String) {
    if command == "palette" || command == "capture" { presentPanel?(command, nil); return }
    showsWebContent = true
    pendingSelection = "window.__craftHubCommand?.(\(Self.jsonString(command)))"
    deliverSelection()
  }

  func selectProject(_ project: String, capability: String?) {
    showsWebContent = true
    selection = .projects
    var value = ["projectId": project]
    value["capabilityId"] = capability
    guard let data = try? JSONSerialization.data(withJSONObject: value), let json = String(data: data, encoding: .utf8) else { return }
    pendingSelection = "window.__craftHubSelect?.(\(json))"
    deliverSelection()
  }

  func navigateToWebPath(_ path: String) {
    showsWebContent = true
    pendingSelection = "window.__craftHubNavigate?.(\(Self.jsonString(path)))"
    deliverSelection()
  }
  /// Keep the ephemeral browser session when the main window is recreated; the bootstrap is one-use.
  func webSessionDataStore() -> WKWebsiteDataStore {
    if let webDataStore { return webDataStore }
    let created = WKWebsiteDataStore.nonPersistent()
    webDataStore = created
    return created
  }
  func webWillLoad() { webReady = false }
  func webBecameReady() { webReady = true; deliverSelection() }
  private func deliverSelection() {
    guard webReady, webView != nil, let pendingSelection else { return }
    showsWebContent = true
    evaluate(pendingSelection)
    self.pendingSelection = nil
  }

  private func evaluate(_ script: String) {
    webView?.evaluateJavaScript(script, completionHandler: nil)
  }

  private static func jsonString(_ value: String) -> String {
    let data = (try? JSONSerialization.data(withJSONObject: [value])) ?? Data("[\"\"]".utf8)
    return String(decoding: data, as: UTF8.self).dropFirst().dropLast().description
  }
}

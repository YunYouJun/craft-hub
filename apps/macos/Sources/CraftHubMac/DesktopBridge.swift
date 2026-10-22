import AppKit
import WebKit

/// The `window.craftHubDesktop` contract the web workbench already uses with Electron. Operating-system actions run
/// here in Swift; actions that need runtime state go to the sidecar's same-origin host routes.
@MainActor
final class DesktopBridge: NSObject, WKScriptMessageHandlerWithReply {
  static let handlerName = "craftHubBridge"

  /// Defined before any page script runs, frozen so the page cannot replace individual actions.
  static let script = """
  (() => {
    const native = (action, input = {}) => window.webkit.messageHandlers.\(handlerName).postMessage({ action, input })
    const sidecar = async (action, input = {}) => {
      const response = await fetch('/__craft_hub_host/' + action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-craft-hub-host': '1' },
        body: JSON.stringify(input),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Host action failed')
      return result.value
    }
    Object.defineProperty(window, 'craftHubDesktop', { value: Object.freeze({
      platform: 'darwin',
      hostKind: 'macos',
      selectProjectDirectory: defaultPath => native('select-project-directory', { defaultPath }),
      selectProjectDirectories: defaultPath => native('select-project-directories', { defaultPath }),
      openExternalUrl: url => native('open-external-url', { url }),
      copyText: text => native('copy-text', { text }),
      openWorkbenchTool: toolId => sidecar('open-workbench-tool', { toolId }),
    }) })
  })()
  """

  private let origin: URL
  weak var webView: WKWebView?

  init(origin: URL) {
    self.origin = origin
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor (Any?, String?) -> Void) {
    // Only the workbench page itself may ask for native actions, never a frame or another origin.
    let source = message.frameInfo.securityOrigin
    guard message.frameInfo.isMainFrame, source.protocol == origin.scheme, source.host == origin.host, source.port == origin.port ?? 0 else {
      return replyHandler(nil, "Native actions are limited to the Craft Hub workbench")
    }
    guard let body = message.body as? [String: Any], let action = body["action"] as? String else {
      return replyHandler(nil, "Native action input must be an object")
    }
    let input = body["input"] as? [String: Any] ?? [:]
    switch action {
    case "select-project-directory", "select-project-directories":
      selectDirectories(multiple: action.hasSuffix("directories"), defaultPath: input["defaultPath"] as? String, reply: replyHandler)
    case "open-external-url":
      guard let url = Self.externalURL(input["url"]) else { return replyHandler(nil, "An HTTPS URL without credentials is required") }
      NSWorkspace.shared.open(url)
      replyHandler(nil, nil)
    case "copy-text":
      guard let text = input["text"] as? String else { return replyHandler(nil, "Clipboard text must be a string") }
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(text, forType: .string)
      replyHandler(nil, nil)
    default:
      replyHandler(nil, "Unknown native action")
    }
  }

  private func selectDirectories(multiple: Bool, defaultPath: String?, reply: @escaping @MainActor (Any?, String?) -> Void) {
    let panel = NSOpenPanel()
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    panel.canCreateDirectories = true
    panel.allowsMultipleSelection = multiple
    if let defaultPath, defaultPath.hasPrefix("/"), !defaultPath.contains("\0") {
      panel.directoryURL = URL(fileURLWithPath: defaultPath, isDirectory: true)
    }
    let finish: (NSApplication.ModalResponse) -> Void = { response in
      let paths = response == .OK ? panel.urls.map(\.path) : []
      // Cancelling resolves to undefined, as the Electron host does.
      if paths.isEmpty { reply(nil, nil) } else { reply(multiple ? paths : paths[0], nil) }
    }
    if let window = webView?.window {
      panel.beginSheetModal(for: window, completionHandler: finish)
    }
    else {
      finish(panel.runModal())
    }
  }

  /// Credential-free HTTPS only, with no control characters, matching the sidecar's own validation.
  static func externalURL(_ value: Any?) -> URL? {
    guard let text = value as? String, !text.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }),
          let url = URL(string: text), url.scheme == "https", url.user == nil, url.password == nil, url.host != nil else { return nil }
    return url
  }
}

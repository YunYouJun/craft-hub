import AppKit
import CraftHubMacCore
import WebKit

/// The `window.craftHubDesktop` contract the web workbench already uses with Electron. Operating-system actions run
/// here in Swift; actions that need runtime state go to the sidecar's same-origin host routes.
@MainActor
final class DesktopBridge: NSObject, WKScriptMessageHandlerWithReply {
  static let handlerName = "craftHubBridge"

  /// Defined before any page script runs, frozen so the page cannot replace individual actions.
  static let script = """
    (() => {
      const native = (action, input = {}) => window.webkit.messageHandlers.\(handlerName).postMessage({ action, input: JSON.parse(JSON.stringify(input)) })
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
      const pending = new Map(), listeners = new Map(), revisions = new Map()
      const consume = kind => { const value = pending.get(kind); pending.delete(kind); return value }
      const subscribe = (kind, callback) => {
        if (!listeners.has(kind)) listeners.set(kind, new Set())
        listeners.get(kind).add(callback)
        return () => listeners.get(kind)?.delete(callback)
      }
      let activitySource
      let activityRevision = 0, latestActivity
      const activityStatus = async () => {
        const revision = activityRevision
        const status = await sidecar('codex-activity-status')
        if (revision !== activityRevision && latestActivity) return latestActivity
        latestActivity = status
        return status
      }
      const changeActivity = async action => {
        const status = await native(action)
        if (status) { latestActivity = status; activityRevision++ }
        return status
      }
      const closeActivity = () => { activitySource?.close(); activitySource = undefined }
      const subscribeActivity = callback => {
        const stop = subscribe('codex-activity', callback)
        if (!activitySource) {
          const source = new EventSource('/__craft_hub_host/codex-activity-events')
          activitySource = source
          source.onmessage = event => {
            if (source !== activitySource) return
            let status
            try { status = JSON.parse(event.data) } catch { return }
            if (!status || typeof status.installed !== 'boolean' || !Array.isArray(status.runningSessionIds)) return
            latestActivity = status
            activityRevision++
            for (const listener of [...(listeners.get('codex-activity') || [])]) {
              try { listener(status) } catch {}
            }
          }
        }
        return () => { stop(); if (!listeners.get('codex-activity')?.size) closeActivity() }
      }
      window.addEventListener('pagehide', () => { closeActivity(); listeners.delete('codex-activity') })
      window.__craftHubDesktopLink = async url => {
        const host = new URL(url).hostname
        const lane = ['marketplace', 'celebrate', 'cloud'].includes(host) ? host : 'navigation'
        const revision = (revisions.get(lane) || 0) + 1
        revisions.set(lane, revision)
        const link = await sidecar('resolve-desktop-link', { url })
        if (revisions.get(lane) !== revision) return
        if (link.kind === 'marketplace-import' || (link.kind === 'navigation' && link.navigation.kind === 'marketplace')) {
          pending.delete(link.kind)
          await native('open-plugin-management', link.kind === 'marketplace-import' ? { catalogUrl: link.catalogUrl } : {})
          return
        }
        const value = link.kind === 'navigation' ? link.navigation
          : link.kind === 'marketplace-import' ? link.catalogUrl : true
        const callbacks = listeners.get(link.kind)
        if (callbacks?.size) for (const callback of [...callbacks]) callback(value)
        else pending.set(link.kind, value)
      }
      Object.defineProperty(window, 'craftHubDesktop', { value: Object.freeze({
        bridgeVersion: 1,
        platform: 'darwin',
        hostKind: 'macos',
        consumeDesktopNavigation: async () => consume('navigation'),
        onDesktopNavigation: callback => subscribe('navigation', callback),
        consumeMarketplaceSourceImport: async () => consume('marketplace-import'),
        onMarketplaceSourceImport: callback => subscribe('marketplace-import', callback),
        consumeCelebration: async () => consume('celebration') || false,
        onCelebrationRequested: callback => subscribe('celebration', callback),
        verifyProjectReference: (reference, path) => sidecar('verify-project-reference', { reference, path }),
        selectProjectDirectory: defaultPath => native('select-project-directory', { defaultPath }),
        selectProjectDirectories: defaultPath => native('select-project-directories', { defaultPath }),
        openExternalUrl: url => native('open-external-url', { url }),
        copyText: text => native('copy-text', { text }),
        saveTextFile: input => native('save-text-file', input),
        openResourceSession: context => native('open-resource-session', context),
        closeResourceSession: sessionId => native('close-resource-session', { sessionId }),
        resourceCredential: input => native('resource-credential', input),
        importResourceAccounts: sessionId => native('import-resource-accounts', { sessionId }),
        setWorkbenchOperationPending: pending => native('set-workbench-operation-pending', { pending }),
        setTheme: theme => native('set-theme', { theme }),
        setLocale: locale => native('set-locale', { locale }),
        hostExtensions: () => sidecar('host-extensions'),
        setHostExtensionEnabled: (id, enabled) => sidecar('set-host-extension-enabled', { id, enabled }),
        restartForHostExtensions: () => native('restart-runtime'),
        openWorkbenchTool: toolId => sidecar('open-workbench-tool', { toolId }),
        openProjectDirectory: projectId => sidecar('open-project-directory', { projectId }),
        openProjectInVSCode: projectId => sidecar('open-project-in-vscode', { projectId }),
        openProjectInEditor: projectId => sidecar('open-project-in-editor', { projectId }),
        openIntegrationSource: (integrationId, actionId, entityId, detailIndex, projectId) => sidecar('open-integration-source', { integrationId, actionId, entityId, detailIndex, projectId }),
        openProjectEvidenceInEditor: (projectId, path, line, column) => sidecar('open-project-evidence-in-editor', { projectId, path, line, column }),
        openProjectGitRemote: projectId => sidecar('open-project-git-remote', { projectId }),
        openCapabilitySourceInEditor: (projectId, capabilityId) => sidecar('open-capability-source-in-editor', { projectId, capabilityId }),
        openCapabilityWorkingDirectory: (projectId, capabilityId) => sidecar('open-capability-working-directory', { projectId, capabilityId }),
        startProjectInCodex: async (projectId, prompt, packageRelativePath = '.') => {
          const prepared = await sidecar('prepare-project-codex-handoff', { projectId, prompt, packageRelativePath })
          await native('copy-text', { text: prepared.prompt })
          await sidecar('open-project-in-codex', { projectId, packageRelativePath })
        },
        startWorkspaceInCodex: (workspaceId, projectIds, primaryProjectId, prompt) => sidecar('start-workspace-in-codex', { workspaceId, projectIds, primaryProjectId, prompt }),
        openProjectInCodex: projectId => sidecar('open-project-in-codex', { projectId }),
        openWorkspaceInCodex: workspaceId => sidecar('open-workspace-in-codex', { workspaceId }),
        openWorkspaceInEditor: workspaceId => sidecar('open-workspace-in-editor', { workspaceId }),
        openCodexThread: threadId => sidecar('open-codex-thread', { threadId }),
        focusCodexApplication: () => sidecar('focus-codex-application'),
        codexActivityStatus: activityStatus,
        installCodexActivityHooks: () => changeActivity('install-codex-activity-hooks'),
        uninstallCodexActivityHooks: () => changeActivity('uninstall-codex-activity-hooks'),
        onCodexActivityStatus: subscribeActivity,
        listTerminalApplications: () => sidecar('list-terminal-applications'),
        openProjectInTerminal: (projectId, application) => sidecar('open-project-in-terminal', { projectId, application }),
        openDotfilesInTerminal: () => sidecar('open-dotfiles-in-terminal'),
        openSettingsFile: () => sidecar('open-settings-file'),
        cloudStatus: () => native('cloud-status'),
        cloudConnect: () => native('cloud-connect'),
        cloudDisconnect: () => native('cloud-disconnect'),
        cloudSynchronize: () => native('cloud-synchronize'),
      }) })
    })()
    """

  private let origin: URL
  weak var webView: WKWebView?
  var restartRuntime: (() async throws -> Void)?
  var openPluginManagement: ((String?) throws -> Void)?
  var cloudAction: ((String) async throws -> Any?)?
  var codexActivityAction: ((String) async throws -> Any?)?
  var workbenchOperation: ((Bool) -> Void)?
  var resourceAction: ((String, [String: Any]) async throws -> Any)?

  init(origin: URL) {
    self.origin = origin
  }

  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage,
    replyHandler: @escaping @MainActor (Any?, String?) -> Void
  ) {
    // Only the workbench page itself may ask for native actions, never a frame or another origin.
    let source = message.frameInfo.securityOrigin
    guard message.frameInfo.isMainFrame, source.protocol == origin.scheme, source.host == origin.host,
      source.port == origin.port ?? 0
    else {
      return replyHandler(nil, "Native actions are limited to the Craft Hub workbench")
    }
    guard let body = message.body as? [String: Any], let action = body["action"] as? String else {
      return replyHandler(nil, "Native action input must be an object")
    }
    let input = body["input"] as? [String: Any] ?? [:]
    switch action {
    case "set-workbench-operation-pending":
      guard input.count == 1, let pending = input["pending"] as? Bool, let workbenchOperation else {
        return replyHandler(nil, "Workbench operation state must be a boolean")
      }
      workbenchOperation(pending)
      replyHandler(nil, nil)
    case "open-resource-session", "close-resource-session", "resource-credential", "import-resource-accounts":
      guard let resourceAction else { return replyHandler(nil, "Native resource actions are unavailable") }
      Task {
        do { replyHandler(try await resourceAction(action, input), nil) } catch {
          replyHandler(nil, "Local resource action unavailable. Refresh the page and retry.")
        }
      }
    case "install-codex-activity-hooks", "uninstall-codex-activity-hooks":
      guard input.isEmpty, let codexActivityAction else {
        return replyHandler(nil, "Native Codex activity is unavailable")
      }
      Task {
        do { replyHandler(try await codexActivityAction(action), nil) } catch {
          replyHandler(nil, error.localizedDescription)
        }
      }
    case "cloud-status", "cloud-connect", "cloud-disconnect", "cloud-synchronize":
      guard input.isEmpty, let cloudAction else { return replyHandler(nil, "Native cloud is unavailable") }
      Task {
        do { replyHandler(try await cloudAction(action), nil) } catch { replyHandler(nil, error.localizedDescription) }
      }
    case "open-plugin-management":
      guard let openPluginManagement else { return replyHandler(nil, "Plugin management is unavailable") }
      var catalog: String?
      if let value = input["catalogUrl"] {
        guard let url = Self.externalURL(value), url.fragment == nil, url.absoluteString.count <= 2048 else {
          return replyHandler(nil, "A credential-free HTTPS catalog URL is required")
        }
        catalog = url.absoluteString
      }
      do {
        try openPluginManagement(catalog)
        replyHandler(nil, nil)
      } catch { replyHandler(nil, error.localizedDescription) }
    case "select-project-directory", "select-project-directories":
      selectDirectories(
        multiple: action.hasSuffix("directories"), defaultPath: input["defaultPath"] as? String, reply: replyHandler)
    case "open-external-url":
      guard let url = Self.externalURL(input["url"]) else {
        return replyHandler(nil, "An HTTPS URL without credentials is required")
      }
      replyHandler(nil, NSWorkspace.shared.open(url) ? nil : "The requested application could not open the URL")
    case "restart-runtime":
      guard let restartRuntime else { return replyHandler(nil, "Runtime restart is unavailable") }
      Task {
        do {
          try await restartRuntime()
          replyHandler(nil, nil)
        } catch { replyHandler(nil, error.localizedDescription) }
      }
    case "set-theme":
      guard let raw = input["theme"] as? String, let theme = RuntimePreferences.Theme(rawValue: raw) else {
        return replyHandler(nil, "Theme must be system, light, or dark")
      }
      NativePreferences.shared.setTheme(theme)
      replyHandler(nil, nil)
    case "set-locale":
      guard let raw = input["locale"] as? String, let language = RuntimePreferences.Language(rawValue: raw) else {
        return replyHandler(nil, "Locale must be en or zh-CN")
      }
      NativePreferences.shared.setLanguage(language)
      replyHandler(nil, nil)
    case "save-text-file":
      guard let document = Self.textExport(input) else {
        return replyHandler(nil, "A bounded text document and a file name are required")
      }
      let panel = NSSavePanel()
      panel.nameFieldStringValue = document.filename
      panel.canCreateDirectories = true
      let finish: (NSApplication.ModalResponse) -> Void = { response in
        guard response == .OK, let url = panel.url else { return replyHandler(["saved": false], nil) }
        do {
          try document.data.write(to: url, options: .atomic)
          replyHandler(["saved": true], nil)
        } catch { replyHandler(nil, "The text document could not be saved") }
      }
      if let window = webView?.window {
        panel.beginSheetModal(for: window, completionHandler: finish)
      } else {
        finish(panel.runModal())
      }
    case "copy-text":
      guard let text = input["text"] as? String else { return replyHandler(nil, "Clipboard text must be a string") }
      NSPasteboard.general.clearContents()
      replyHandler(nil, NSPasteboard.general.setString(text, forType: .string) ? nil : "Clipboard is unavailable")
    default:
      replyHandler(nil, "Unknown native action")
    }
  }

  private func selectDirectories(
    multiple: Bool, defaultPath: String?, reply: @escaping @MainActor (Any?, String?) -> Void
  ) {
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
    } else {
      finish(panel.runModal())
    }
  }

  /// The web page supplies text and a suggested basename; only the system save panel selects a path.
  static func textExport(_ input: [String: Any]) -> (filename: String, data: Data)? {
    guard input.count == 2, let filename = input["filename"] as? String,
      !filename.isEmpty, filename.utf8.count <= 255, ![".", ".."].contains(filename),
      !filename.unicodeScalars.contains(where: {
        $0.value < 32 || $0.value == 127 || "/\\:".unicodeScalars.contains($0)
      }),
      let content = input["content"] as? String, content.utf8.count <= 8 * 1024 * 1024
    else { return nil }
    return (filename, Data(content.utf8))
  }

  /// Credential-free HTTPS only, with no control characters, matching the sidecar's own validation.
  static func externalURL(_ value: Any?) -> URL? {
    guard let text = value as? String, !text.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }),
      let url = URL(string: text), url.scheme == "https", url.user == nil, url.password == nil, url.host != nil
    else { return nil }
    return url
  }
}

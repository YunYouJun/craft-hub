import CraftHubMacCore
import Foundation
import Observation
import WebKit

/// Shared state between the native chrome and the embedded web workbench.
@MainActor
@Observable
final class WorkbenchModel {
  var selection: Destination? = .overview
  private(set) var machine: MachineModel?
  let projects = ProjectsModel()
  let today = TodayFocusModel()
  let settings = NativeSettingsModel()
  let plugins = PluginsModel()
  let diagnostics = DiagnosticsModel()
  let websiteNavigation = WebsiteNavigationModel()
  private(set) var toolsPage: ToolsPage
  let cloud = NativeCloudModel()
  let codexActivity = CodexActivityModel()
  private(set) var connectionGeneration = UUID()
  let integrations = IntegrationWorkbenchModel()
  private(set) var recentProjectIDs: [String]
  let observation = RuntimeObservation()
  private(set) var showsWebContent = false
  var presentsNativeContent: Bool { selection?.isNative == true && !showsWebContent }
  private(set) var canGoBack = false
  private(set) var canGoForward = false
  var navigationError: String?
  private(set) var findRequest = 0
  /// The route the web workbench last reported; the sidebar follows it without navigating again.
  private(set) var route = "/overview"
  @ObservationIgnored weak var webView: WKWebView?
  @ObservationIgnored var restartRuntime: (() async throws -> Void)?
  @ObservationIgnored var presentPanel: ((String, String?) -> Void)?
  @ObservationIgnored var importProjects: (([URL]) -> Void)?
  @ObservationIgnored var presentSettings: (() -> Void)?
  @ObservationIgnored private var preferencesClient: RuntimeAPIClient?
  @ObservationIgnored private var webReady = false
  @ObservationIgnored private var webDataStore: WKWebsiteDataStore?
  @ObservationIgnored private var pendingSelection: String?
  @ObservationIgnored private var desktopLinks = DesktopLinkInbox()
  @ObservationIgnored private var pendingApplicationMaintenance: ApplicationMaintenanceLink?
  @ObservationIgnored private var restoredLastDestination = false
  @ObservationIgnored private var configurationNavigation = UUID()
  @ObservationIgnored private let defaults: UserDefaults
  private static let lastDestinationKey = "lastDestination"
  private static let toolsPageKey = "toolsPage"

  init(defaults: UserDefaults = NativeStorage.defaults) {
    self.defaults = defaults
    toolsPage = defaults.string(forKey: Self.toolsPageKey).flatMap(ToolsPage.init(rawValue:)) ?? .favorites
    recentProjectIDs = defaults.stringArray(forKey: "recentProjects") ?? []
  }

  var recentProjects: [PaletteProject] {
    Array(recentProjectIDs.compactMap { id in projects.projects.first { $0.id == id } }.prefix(8))
  }

  func select(_ destination: Destination?) {
    configurationNavigation = UUID()
    if destination != .marketplace { plugins.cancelNavigation() }
    guard let destination else { return }
    PerformanceTrace.mark(.pageRequested)
    showsWebContent = false
    defaults.set(destination.rawValue, forKey: Self.lastDestinationKey)
    guard !destination.isNative else { return }
    guard Destination.matching(path: route) != destination else { return }
    evaluate("window.__craftHubNavigate?.(\(Self.jsonString(destination.path)))")
  }

  func connect(_ connection: RuntimeConnection?) {
    connectionGeneration = UUID()
    configurationNavigation = UUID()
    webReady = false
    webDataStore = nil
    machine?.disconnect()
    machine = connection.map { MachineModel(client: RuntimeAPIClient(connection: $0)) }
    projects.connect(connection.map { RuntimeAPIClient(connection: $0) })
    today.connect(connection.map { RuntimeAPIClient(connection: $0) })
    preferencesClient = connection.map { RuntimeAPIClient(connection: $0) }
    settings.connect(preferencesClient)
    cloud.connect(preferencesClient)
    codexActivity.connect(preferencesClient)
    plugins.connect(preferencesClient)
    diagnostics.connect(preferencesClient)
    websiteNavigation.connect(preferencesClient)
    integrations.connect(preferencesClient)
    NativePreferences.shared.refresh(preferencesClient)
    observation.connect(connection)
    if connection != nil {
      Task {
        await projects.load()
        await today.load()
      }
    }
    showsWebContent = false
    restoredLastDestination = false
    canGoBack = false
    canGoForward = false
    if let link = pendingApplicationMaintenance { openApplicationMaintenance(link) }
  }

  func invalidate(_ changes: Set<RuntimeChange>) {
    if changes.contains(.settings) { NativePreferences.shared.refresh(preferencesClient) }
    projects.invalidate(changes)
    plugins.invalidate(changes)
    diagnostics.invalidate(changes)
    websiteNavigation.invalidate(changes)
    integrations.invalidate(changes)
    if !changes.isDisjoint(with: [.settings, .plugins, .pluginUpdate, .userConfig, .configurationSync, .integrations]) {
      today.invalidate()
      Task { await today.load() }
    }
    Task { await projects.load() }
    guard let machine else { return }
    machine.invalidate(changes)
    guard presentsNativeContent else { return }
    let destination = selection
    Task {
      if destination == .marketplace { await plugins.load() }
      if destination == .diagnostics { await diagnostics.load() }
      if destination == .workbenches { await integrations.refreshIfIdle() }
      if destination == .environment {
        await machine.loadEnvironment()
        if machine.environmentTab == "profile" { await machine.environmentProfile.load() }
        if machine.environmentTab == "configuration" { await machine.configuration.refreshIfIdle() }
      }
      if destination == .software {
        await machine.loadSoftware()
        await machine.softwareSources.load()
      }
      if destination == .tools {
        if toolsPage == .navigation {
          await websiteNavigation.load(locale: L10n.text.chinese ? "zh-CN" : "en")
        } else {
          await machine.favorites.load()
        }
      }
    }
  }

  func showWebWorkbench() {
    showsWebContent = true
    if let selection {
      let path = selection == .tools ? toolsPage.path : selection.path
      evaluate("window.__craftHubNavigate?.(\(Self.jsonString(path)))")
    }
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
    if let page = ToolsPage(path: path) {
      showTools(page)
      return
    }
    if let plugin = PluginRoute(path: path) {
      openNativePlugin(package: plugin.package, source: plugin.source)
      return
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
  func find() {
    if presentsNativeContent
      && [.projects, .tools, .software, .workbenches, .marketplace, .diagnostics].contains(selection)
    {
      findRequest += 1
    } else {
      run("palette")
    }
  }

  func acceptDesktopLink(_ url: URL) {
    if let link = ApplicationMaintenanceLink(url: url) {
      openApplicationMaintenance(link)
      return
    }
    if url.host?.lowercased() == "cloud" {
      presentSettings?()
      Task { await cloud.adopt(url) }
      return
    }
    guard desktopLinks.accept(url) else {
      navigationError = L10n.text.copy("无法打开此 Craft Hub 链接。", "This Craft Hub link could not be opened.")
      return
    }
    navigationError = nil
    restoredLastDestination = true
    deliverDesktopLinks()
  }

  private func openApplicationMaintenance(_ link: ApplicationMaintenanceLink) {
    restoredLastDestination = true
    showsWebContent = false
    selection = .software
    navigationError = nil
    guard let machine else {
      pendingApplicationMaintenance = link
      return
    }
    pendingApplicationMaintenance = nil
    machine.softwareTab = "uninstall"
    let model = machine.applicationMaintenance
    model.bundleId = link.bundleId
    model.query = ""
    model.selection = nil
    Task {
      await model.load()
      guard self.machine === machine, machine.softwareTab == "uninstall", model.bundleId == link.bundleId else {
        return
      }
      model.selection = model.applications.first?.id
    }
  }

  private func deliverDesktopLinks() {
    guard webReady, let webView else { return }
    let links = desktopLinks.drain()
    guard !links.isEmpty else { return }
    restoredLastDestination = true
    showsWebContent = true
    for url in links {
      webView.callAsyncJavaScript(
        "await window.__craftHubDesktopLink(url); return true", arguments: ["url": url], in: nil, in: .page
      ) { [weak self, weak webView] result in
        guard let self, self.webView === webView else { return }
        if case .failure = result {
          self.navigationError = L10n.text.copy(
            "链接无效或此候选版尚不支持该入口。未执行任何操作。",
            "The link is invalid or unsupported by this candidate. No action was performed.")
        }
      }
    }
  }
  func reload() {
    if presentsNativeContent {
      Task {
        if selection == .marketplace {
          await plugins.load(force: true)
          if plugins.tab == .hosts { await plugins.hostComponents.load() }
        }
        if selection == .diagnostics { await diagnostics.load(force: true) }
        if selection == .workbenches {
          await integrations.loadCatalog(force: true)
          await integrations.refresh()
        }
        if selection == .projects { await projects.load(force: true) }
        if selection == .overview { await today.load(force: true) }
        if selection == .environment { await machine?.loadEnvironment(force: true) }
        if selection == .software { await machine?.loadSoftware(force: true) }
        if selection == .tools {
          if toolsPage == .navigation {
            await websiteNavigation.load(locale: L10n.text.chinese ? "zh-CN" : "en", force: true)
          } else {
            await machine?.favorites.load(force: true)
          }
        }
      }
    } else {
      webView?.reload()
    }
  }
  func run(_ command: String) {
    if command == "settings", let presentSettings {
      presentSettings()
      return
    }
    if command == "palette" || command == "capture" {
      presentPanel?(command, nil)
      return
    }
    runWebCommand(command)
  }

  func runWebCommand(_ command: String) {
    showsWebContent = true
    pendingSelection = "window.__craftHubCommand?.(\(Self.jsonString(command)))"
    deliverSelection()
  }

  func selectProject(_ project: String, capability: String?) {
    recentProjectIDs = Array(([project] + recentProjectIDs.filter { $0 != project }).prefix(20))
    defaults.set(recentProjectIDs, forKey: "recentProjects")
    showsWebContent = true
    selection = .projects
    var value = ["projectId": project]
    value["capabilityId"] = capability
    guard let data = try? JSONSerialization.data(withJSONObject: value), let json = String(data: data, encoding: .utf8)
    else { return }
    pendingSelection = "window.__craftHubSelect?.(\(json))"
    deliverSelection()
  }

  func openDiagnostic(_ target: DiagnosticSnapshot.Target) {
    switch target.type {
    case "settings": run("settings")
    case "marketplace":
      openNativePlugin(package: target.package, source: target.sourceId)
    case "project":
      if let id = target.projectId, projects.projects.contains(where: { $0.id == id }) {
        selectProject(id, capability: nil)
      } else {
        navigationError = L10n.text.copy("项目已不在登记列表中。", "This project is no longer registered.")
      }
    case "integration":
      guard let id = target.integrationId, let client = preferencesClient else { return }
      Task {
        do {
          let path = try await client.diagnosticIntegrationPath(id)
          guard preferencesClient === client else { return }
          if let path {
            navigateToWebPath(path)
          } else {
            navigationError = L10n.text.copy(
              "此集成暂无可用页面，请检查插件状态。", "This integration has no available view. Review its plugin status.")
          }
        } catch { if preferencesClient === client { navigationError = error.localizedDescription } }
      }
    default: break
    }
  }

  func navigateToWebPath(_ path: String) {
    configurationNavigation = UUID()
    if let page = ToolsPage(path: path) {
      showTools(page)
      return
    }
    if let plugin = PluginRoute(path: path) {
      openNativePlugin(package: plugin.package, source: plugin.source)
      return
    }
    if path == "/environment/setup", let machine {
      machine.environmentTab = "profile"
      selection = .environment
      select(.environment)
      return
    }
    if ["/marketplace", "/diagnostics", "/tools", "/software"].contains(path),
      let destination = Destination.matching(path: path)
    {
      selection = destination
      select(destination)
      return
    }
    if path.hasPrefix("/integrations/") {
      let request = UUID()
      configurationNavigation = request
      Task {
        await integrations.loadCatalog()
        guard configurationNavigation == request else { return }
        let parts = URLComponents(string: path)
        guard let entry = integrations.entries.first(where: { $0.path == parts?.path }),
          integrations.canChangeContext
        else {
          showIntegrationWeb(path)
          return
        }
        let project = parts?.queryItems?.first { $0.name == "project" }?.value ?? ""
        guard project.isEmpty || projects.projects.contains(where: { $0.id == project }) else {
          navigationError = L10n.text.copy("项目已不在登记列表中。", "This project is no longer registered.")
          return
        }
        selection = .workbenches
        select(.workbenches)
        await integrations.select(entry.id, project: project)
      }
      return
    }
    showIntegrationWeb(path)
  }
  private func showTools(_ page: ToolsPage) {
    toolsPage = page
    defaults.set(page.rawValue, forKey: Self.toolsPageKey)
    pendingSelection = nil
    selection = .tools
    select(.tools)
  }
  private func openNativePlugin(package: String?, source: String?) {
    selection = .marketplace
    select(.marketplace)
    Task {
      await plugins.show(package: package, source: source) {
        self.selection == .marketplace && self.presentsNativeContent
      }
    }
  }
  /// Explicit fallback keeps the selected scope in the URL and never loops back into native routing.
  func showIntegrationWeb(_ path: String) {
    configurationNavigation = UUID()
    showsWebContent = true
    pendingSelection = "window.__craftHubNavigate?.(\(Self.jsonString(path)))"
    deliverSelection()
  }
  /// Environment-profile links resolve against declared global configuration blocks before entering native review.
  func openConfiguration(_ path: String) {
    guard let machine, !machine.configuration.busy, !machine.configuration.loading,
      machine.configuration.uncertain == nil
    else {
      navigationError = L10n.text.copy("请等待当前配置操作完成后继续。", "Wait for the current configuration operation to finish.")
      return
    }
    let request = UUID()
    configurationNavigation = request
    Task {
      await machine.configuration.loadCatalog()
      guard self.machine === machine, configurationNavigation == request else { return }
      let components = URLComponents(string: path)
      guard components?.scheme == nil, components?.host == nil,
        let entry = machine.configuration.entries.first(where: { $0.path == components?.path })
      else {
        navigateToWebPath(path)
        return
      }
      selection = .environment
      machine.environmentTab = "configuration"
      select(.environment)
      let item = components?.queryItems?.first { $0.name == "setupItem" }?.value
      await machine.configuration.select(entry.id, item: item)
    }
  }
  /// Called only after the sidecar validates a desktop link. Import links fill a draft without fetching or adding it.
  func openPluginManagement(catalogURL: String?) throws {
    if let catalogURL {
      guard !plugins.busy else {
        throw NSError(
          domain: "CraftHubNavigation", code: 1,
          userInfo: [
            NSLocalizedDescriptionKey: L10n.text.copy(
              "请等待当前插件操作完成，再打开来源链接。", "Wait for the current plugin operation before opening the source link.")
          ])
      }
      plugins.prepareSourceImport(catalogURL)
    }
    selection = .marketplace
    select(.marketplace)
  }
  /// Keep the ephemeral browser session when the main window is recreated; the bootstrap is one-use.
  func webSessionDataStore() -> WKWebsiteDataStore {
    if let webDataStore { return webDataStore }
    let created = WKWebsiteDataStore.nonPersistent()
    webDataStore = created
    return created
  }
  func webWillLoad() { webReady = false }
  func webBecameReady() {
    PerformanceTrace.mark(.webReady)
    webReady = true
    deliverSelection()
    deliverDesktopLinks()
  }
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

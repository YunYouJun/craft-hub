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
  let projectDetails = ProjectDetailsModel()
  let projectCommand = ProjectCommandModel()
  let projectTerminal: ProjectTerminalModel
  let today = TodayFocusModel()
  let settings = NativeSettingsModel()
  let plugins = PluginsModel()
  let diagnostics = DiagnosticsModel()
  let websiteNavigation = WebsiteNavigationModel()
  let pluginNavigation = PluginNavigationModel()
  private(set) var pluginWorkbenchPath: String?
  var sidebarSelection: SidebarDestination? {
    if let pluginWorkbenchPath { return .pluginWorkbench(pluginWorkbenchPath) }
    return selection.map(SidebarDestination.builtin)
  }
  var navigationTitle: String {
    pluginNavigation.workbenches.first { $0.path == pluginWorkbenchPath }?.title ?? selection?.title ?? "Craft Hub"
  }
  private(set) var toolsPage: ToolsPage
  let cloud = NativeCloudModel()
  let codexActivity = CodexActivityModel()
  private(set) var connectionGeneration = UUID()
  let resourceBridge = ResourceDesktopBridge()
  let integrations = IntegrationWorkbenchModel()
  let workItemActions = WorkItemQuickActionsModel()
  private(set) var recentProjectIDs: [String]
  let observation = RuntimeObservation()
  private(set) var showsWebContent = false
  /// Once requested, keep the browser alive for this runtime session, including when its window closes.
  private(set) var webContentRequested = false
  var presentsNativeContent: Bool { selection?.isNative == true && !showsWebContent }
  private(set) var canGoBack = false
  private(set) var canGoForward = false
  var navigationError: String?
  private(set) var findRequest = 0
  /// The route the web workbench last reported; the sidebar follows it without navigating again.
  private(set) var route = "/overview"
  var webView: WKWebView? { retainedWebSession?.webView }
  @ObservationIgnored private var retainedWebSession: WorkbenchWebSession?
  @ObservationIgnored var restartRuntime: (() async throws -> Void)?
  @ObservationIgnored var presentPanel: ((String, String?) -> Void)?
  @ObservationIgnored var importProjects: (([URL]) -> Void)?
  @ObservationIgnored var presentSettings: (() -> Void)?
  @ObservationIgnored private var preferencesClient: RuntimeAPIClient?
  @ObservationIgnored private var webReady = false
  @ObservationIgnored private var pendingSelection: String?
  @ObservationIgnored private var desktopLinks = DesktopLinkInbox()
  @ObservationIgnored private var pendingApplicationMaintenance: ApplicationMaintenanceLink?
  @ObservationIgnored private var desktopLinksPending = false
  @ObservationIgnored private var runtimeConnected = false
  @ObservationIgnored private var configurationNavigation = UUID()
  @ObservationIgnored private let defaults: UserDefaults
  private static let lastDestinationKey = "lastDestination"
  private static let toolsPageKey = "toolsPage"

  init(defaults: UserDefaults = NativeStorage.defaults) {
    self.defaults = defaults
    projectTerminal = ProjectTerminalModel(defaults: defaults)
    selection = defaults.string(forKey: Self.lastDestinationKey).flatMap(Destination.init(rawValue:)) ?? .overview
    toolsPage = defaults.string(forKey: Self.toolsPageKey).flatMap(ToolsPage.init(rawValue:)) ?? .favorites
    recentProjectIDs = defaults.stringArray(forKey: "recentProjects") ?? []
  }

  var recentProjects: [PaletteProject] {
    Array(recentProjectIDs.compactMap { id in projects.projects.first { $0.id == id } }.prefix(8))
  }

  func select(_ destination: Destination?) {
    guard projectCommand.canChangeContext else {
      selection = .projects
      navigationError = L10n.text.copy("请先核对当前命令操作的结果。", "Review the current command operation before leaving.")
      return
    }
    workItemActions.close()
    configurationNavigation = UUID()
    if destination != .marketplace { plugins.cancelNavigation() }
    guard let destination else { return }
    resourceBridge.invalidate()
    webView?.evaluateJavaScript("window.dispatchEvent(new Event('craft-hub-conceal'))", completionHandler: nil)
    pluginWorkbenchPath = nil
    projectCommand.close()
    projectDetails.close()
    projectTerminal.select(projectID: nil)
    PerformanceTrace.mark(.pageRequested)
    showsWebContent = false
    pendingSelection = nil
    defaults.set(destination.rawValue, forKey: Self.lastDestinationKey)
    guard !destination.isNative else { return }
    guard Destination.matching(path: route) != destination else { return }
    requestWebContent("window.__craftHubNavigate?.(\(Self.jsonString(destination.path)))")
  }

  func selectSidebar(_ destination: SidebarDestination?) {
    switch destination {
    case .builtin(let destination):
      selection = destination
      select(destination)
    case .pluginWorkbench(let path):
      guard pluginNavigation.canOpen, pluginNavigation.workbenches.contains(where: { $0.path == path }),
        projectCommand.canChangeContext, canNavigateToIntegration()
      else { return }
      selection = .workbenches
      select(.workbenches)
      showIntegrationWeb(path)
      pluginWorkbenchPath = path
    case nil: break
    }
  }

  func loadPluginNavigation(locale: String, force: Bool = false) async {
    await pluginNavigation.load(locale: locale, force: force)
    if pluginNavigation.canOpen, let path = pluginWorkbenchPath,
      !pluginNavigation.workbenches.contains(where: { $0.path == path })
    {
      selectSidebar(.builtin(.workbenches))
    }
  }

  func connect(_ connection: RuntimeConnection?) {
    if runtimeConnected { pendingSelection = nil }
    runtimeConnected = connection != nil
    connectionGeneration = UUID()
    configurationNavigation = UUID()
    webReady = false
    retainedWebSession?.invalidate()
    retainedWebSession = nil
    machine?.disconnect()
    machine = connection.map { MachineModel(client: RuntimeAPIClient(connection: $0)) }
    projects.connect(connection.map { RuntimeAPIClient(connection: $0) })
    projectDetails.connect(connection.map { RuntimeAPIClient(connection: $0) })
    projectCommand.connect(connection.map { RuntimeAPIClient(connection: $0) })
    projectTerminal.connect(connection.map { RuntimeAPIClient(connection: $0) })
    today.connect(connection.map { RuntimeAPIClient(connection: $0) })
    preferencesClient = connection.map { RuntimeAPIClient(connection: $0) }
    settings.connect(preferencesClient)
    cloud.connect(preferencesClient)
    codexActivity.connect(preferencesClient)
    plugins.connect(preferencesClient)
    diagnostics.connect(preferencesClient)
    websiteNavigation.connect(preferencesClient)
    pluginNavigation.connect(preferencesClient)
    pluginWorkbenchPath = nil
    integrations.connect(preferencesClient)
    resourceBridge.connect(preferencesClient)
    workItemActions.connect(preferencesClient)
    workItemActions.completed = { [weak self] _ in
      guard let self else { return }
      await self.today.refreshWorkItems()
      await self.integrations.refresh()
    }
    NativePreferences.shared.refresh(preferencesClient)
    observation.connect(connection)
    if connection != nil {
      Task {
        await projects.load()
        await today.load()
      }
    }
    showsWebContent = pendingSelection != nil || desktopLinksPending
    webContentRequested = showsWebContent
    canGoBack = false
    canGoForward = false
    if let link = pendingApplicationMaintenance { openApplicationMaintenance(link) }
  }

  func invalidate(_ changes: Set<RuntimeChange>) {
    if !changes.isDisjoint(with: [.settings, .plugins, .pluginUpdate, .userConfig, .projects]) {
      workItemActions.invalidate()
    }
    if changes.contains(.settings) { NativePreferences.shared.refresh(preferencesClient) }
    projects.invalidate(changes)
    projectDetails.invalidate(changes)
    projectCommand.invalidate(changes)
    plugins.invalidate(changes)
    diagnostics.invalidate(changes)
    websiteNavigation.invalidate(changes)
    if pluginNavigation.invalidate(changes) {
      Task { await loadPluginNavigation(locale: L10n.text.chinese ? "zh-CN" : "en") }
    }
    let integrationsChanged = integrations.invalidate(changes)
    if !changes.isDisjoint(with: [.settings, .plugins, .pluginUpdate, .userConfig, .integrations]) {
      if changes.isSubset(of: [.integrations, .configurationSync]) {
        today.markWorkItemsStale()
      } else {
        today.invalidate()
      }
      Task { await today.load() }
    }
    Task { await projects.load() }
    guard let machine else { return }
    machine.invalidate(changes)
    guard presentsNativeContent else { return }
    let destination = selection
    Task {
      if destination == .projects, projectDetails.projectID != nil { await projectDetails.load() }
      if destination == .projects, projectCommand.capabilityID != nil { await projectCommand.load() }
      if destination == .marketplace { await plugins.load() }
      if destination == .diagnostics { await diagnostics.load() }
      if destination == .workbenches, integrationsChanged { await integrations.refreshIfIdle() }
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
    if let pluginWorkbenchPath {
      requestWebContent("window.__craftHubNavigate?.(\(Self.jsonString(pluginWorkbenchPath)))")
      return
    }
    // Returning to the same section resumes its current detail/editor rather than navigating away from a draft.
    if let selection, Destination.matching(path: route) != selection {
      let path = selection == .tools ? toolsPage.path : selection.path
      requestWebContent("window.__craftHubNavigate?.(\(Self.jsonString(path)))")
    } else {
      requestWebContent()
    }
  }

  func routeChanged(_ path: String) {
    if route != path { resourceBridge.invalidate() }
    route = path
    // The hidden web page may finish an earlier navigation while a native page is already selected.
    guard !presentsNativeContent else { return }
    pluginWorkbenchPath = pluginNavigation.workbenches.first { $0.path == path }?.path
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
    guard projectCommand.canChangeContext else {
      navigationError = L10n.text.copy("请先核对当前命令操作的结果。", "Review the current command operation before leaving.")
      return
    }
    projectCommand.cancelReview()
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
    configurationNavigation = UUID()
    desktopLinksPending = true
    webContentRequested = true
    showsWebContent = true
    deliverDesktopLinks()
  }

  private func openApplicationMaintenance(_ link: ApplicationMaintenanceLink) {
    configurationNavigation = UUID()
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
    desktopLinksPending = false
    guard !links.isEmpty else { return }
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
    Task { await loadPluginNavigation(locale: L10n.text.chinese ? "zh-CN" : "en", force: true) }
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
        if selection == .projects {
          if projectCommand.capabilityID != nil { await projectCommand.load(force: true) }
          if projectDetails.projectID != nil {
            await projectDetails.load(force: true)
          } else {
            await projects.load(force: true)
          }
        }
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
    requestWebContent("window.__craftHubCommand?.(\(Self.jsonString(command)))")
  }

  func selectProject(_ project: String, capability: String?) {
    if let capability {
      guard preferencesClient != nil else {
        showProjectWeb(project, capability: capability)
        return
      }
      guard projectCommand.canChangeContext else { return }
      select(.projects)
      selection = .projects
      rememberProject(project)
      projectDetails.select(project)
      projectTerminal.select(projectID: project)
      let navigation = UUID()
      configurationNavigation = navigation
      Task {
        await projectDetails.load()
        guard configurationNavigation == navigation, projectDetails.projectID == project else { return }
        if projectDetails.snapshot?.discovery.capabilities.contains(where: {
          $0.id == capability && $0.kind == "command"
        }) == true {
          showProjectCommand(project, capability: capability)
        } else if projectDetails.canReview {
          showProjectWeb(project, capability: capability)
        }
      }
      return
    }
    select(.projects)
    selection = .projects
    rememberProject(project)
    projectDetails.select(project)
    projectTerminal.select(projectID: project)
  }

  /// Choosing a command opens native inspection only; starting it always requires a separate reviewed action.
  func showProjectCommand(_ project: String, capability: String) {
    guard projectCommand.canChangeContext else { return }
    configurationNavigation = UUID()
    selection = .projects
    showsWebContent = false
    pendingSelection = nil
    rememberProject(project)
    projectDetails.select(project)
    projectCommand.select(project: project, capability: capability)
    projectTerminal.select(projectID: project, capabilityID: capability)
  }

  func closeProjectCommand() {
    guard projectCommand.canChangeContext else { return }
    projectCommand.close()
    projectTerminal.select(projectID: projectDetails.projectID)
  }

  /// Enter the existing review flow only on an explicit user action; native inspection never runs it implicitly.
  func showProjectWeb(_ project: String, capability: String? = nil) {
    guard projectCommand.canChangeContext else { return }
    projectCommand.cancelReview()
    projectTerminal.select(projectID: nil)
    rememberProject(project)
    selection = .projects
    projectDetails.select(project)
    var value = ["projectId": project]
    value["capabilityId"] = capability
    guard let data = try? JSONSerialization.data(withJSONObject: value), let json = String(data: data, encoding: .utf8)
    else { return }
    requestWebContent("window.__craftHubSelect?.(\(json))")
  }

  func returnToNativeContent() {
    if selection == .projects, projectDetails.projectID != nil {
      showsWebContent = false
      pendingSelection = nil
      projectTerminal.select(projectID: projectDetails.projectID, capabilityID: projectCommand.capabilityID)
    } else {
      select(selection)
    }
  }

  private func rememberProject(_ project: String) {
    recentProjectIDs = Array(([project] + recentProjectIDs.filter { $0 != project }).prefix(20))
    defaults.set(recentProjectIDs, forKey: "recentProjects")
    defaults.set(Destination.projects.rawValue, forKey: Self.lastDestinationKey)
    projects.selectedID = project
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
    navigationError = nil
    if pluginNavigation.workbenches.contains(where: { $0.path == path }) {
      selectSidebar(.pluginWorkbench(path))
      return
    }
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
    if ["/overview", "/marketplace", "/diagnostics", "/tools", "/software"].contains(path),
      let destination = Destination.matching(path: path)
    {
      selection = destination
      select(destination)
      return
    }
    if path.hasPrefix("/integrations/") {
      let parts = URLComponents(string: path)
      let project = parts?.queryItems?.first { $0.name == "project" }?.value ?? ""
      guard project.isEmpty || projects.projects.contains(where: { $0.id == project }) else {
        navigationError = L10n.text.copy("项目已不在登记列表中。", "This project is no longer registered.")
        return
      }
      if let entry = integrations.entry, entry.path == parts?.path,
        entry.view.rendering != "web",
        integrations.projectID == (entry.view.scope == "global" ? "" : project)
      {
        integrations.search = ""
        selection = .workbenches
        select(.workbenches)
        Task { await integrations.refreshIfIdle() }
        return
      }
      guard canNavigateToIntegration() else { return }
      let request = UUID()
      configurationNavigation = request
      Task {
        let loaded = await integrations.loadCatalog()
        guard configurationNavigation == request else { return }
        guard canNavigateToIntegration() else { return }
        guard loaded else {
          navigationError =
            integrations.error
            ?? L10n.text.copy(
              "暂无法读取来源目录，请重新读取后重试。", "Could not read the source catalog. Reload it and try again.")
          return
        }
        guard let entry = integrations.entries.first(where: { $0.path == parts?.path }) else {
          showIntegrationWeb(path)
          return
        }
        if entry.view.rendering == "web" {
          showIntegrationWeb(path)
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
  private func canNavigateToIntegration() -> Bool {
    guard integrations.canChangeContext else {
      navigationError =
        integrations.busy
        ? L10n.text.copy(
          "当前来源正在处理操作，完成后可切换到其他来源。",
          "The current source is processing an operation. You can switch sources when it finishes.")
        : L10n.text.copy(
          "上次来源操作的结果尚未确认，请先返回当前来源重新读取并核对。",
          "The last source operation has an uncertain outcome. Return to the current source, reload and review it first."
        )
      return false
    }
    return true
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
    pluginWorkbenchPath = pluginNavigation.workbenches.first { $0.path == path }?.path
    requestWebContent("window.__craftHubNavigate?.(\(Self.jsonString(path)))")
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
  /// Create only at the first web presentation; window recreation reuses the page and its one-use bootstrap.
  func webSession(url: URL) -> WorkbenchWebSession {
    if let retainedWebSession { return retainedWebSession }
    let session = WorkbenchWebSession(url: url, model: self)
    retainedWebSession = session
    return session
  }
  private func requestWebContent(_ script: String? = nil) {
    guard projectCommand.canChangeContext else { return }
    projectCommand.cancelReview()
    configurationNavigation = UUID()
    webContentRequested = true
    showsWebContent = true
    pendingSelection = script
    deliverSelection()
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

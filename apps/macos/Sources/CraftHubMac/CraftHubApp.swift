import AppIntents
import AppKit
import CraftHubMacCore
import SwiftUI

/// Native macOS prototype of the primary desktop host (ADR 0012).
struct CraftHubApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @Environment(\.openWindow) private var openWindow
  @Environment(\.openSettings) private var openSettings
  private var model: WorkbenchModel { delegate.model }
  private var text: L10n { L10n.text }

  var body: some Scene {
    // A singleton Window quits on close. A value-keyed group keeps background capture alive and reuses the main window.
    WindowGroup("Craft Hub", id: "main", for: String.self) { _ in
      if delegate.isPrimary {
        WorkbenchRootView(delegate: delegate)
      } else {
        LaunchGateView(delegate: delegate)
      }
    } defaultValue: {
      "main"
    }
    .defaultSize(width: 1280, height: 820)
    .defaultLaunchBehavior(delegate.isPrimary || delegate.launchError != nil ? .presented : .suppressed)
    .windowToolbarStyle(.unified)
    .onChange(of: delegate.isPrimary, initial: true) {
      // App Intents can cold-launch without creating a window. Connect at the scene level,
      // before a root view appears, so the first navigation request can create that window.
      delegate.connectNavigation(
        showMainWindow: { openWindow(id: "main", value: "main") },
        showSettings: { openSettings() })
    }
    .commands {
      if delegate.isPrimary { NativeUpdateCommands(updater: delegate.updater) }
    }
    .commands {
      if delegate.isPrimary {
        CommandGroup(replacing: .newItem) {
          Button(text.copy("显示 Craft Hub", "Show Craft Hub")) { delegate.panels.showMainWindow() }
        }
        CommandGroup(replacing: .appSettings) {
          Button(text.settings) { model.run("settings") }.keyboardShortcut(",")
        }
        CommandGroup(after: .sidebar) {
          Button(text.copy("查找…", "Find…")) { model.find() }.keyboardShortcut("f")
          Button(text.commandPalette) { model.run("palette") }.keyboardShortcut(delegate.shortcuts.palette)
          Button(text.copy("快速记录", "Quick Capture")) { model.run("capture") }.keyboardShortcut(
            .space, modifiers: [.command, .shift])
          Button(text.reload) { model.reload() }.keyboardShortcut("r")
          Divider()
          Button(text.back) { model.goBack() }.keyboardShortcut("[")
          Button(text.forward) { model.goForward() }.keyboardShortcut("]")
        }
        if !delegate.shortcuts.entries.isEmpty {
          CommandMenu(text.copy("项目快捷键", "Project Shortcuts")) {
            ForEach(delegate.shortcuts.entries) { entry in
              Button(entry.title) { delegate.shortcuts.perform(entry.id) }.keyboardShortcut(entry.shortcut)
            }
          }
        }
      }
    }
    Settings {
      if delegate.isPrimary { NativeSettingsView(delegate: delegate) }
    }
    Window(text.copy("软件更新", "Software Updates"), id: "software-updates") {
      if delegate.isPrimary { NativeUpdateSettings(updater: delegate.updater) }
    }
    .windowResizability(.contentSize)
    MenuBarExtra("Craft Hub", systemImage: "square.grid.2x2", isInserted: .constant(delegate.isPrimary)) {
      if delegate.isPrimary { WorkbenchMenu(delegate: delegate) }
    }
  }
}

private struct LaunchGateView: View {
  let delegate: AppDelegate
  var body: some View {
    VStack(spacing: 16) {
      Image(systemName: "lock.shield").font(.largeTitle)
      Text(delegate.launchError ?? L10n.text.copy("正在打开已有的 Craft Hub…", "Opening the existing Craft Hub…"))
        .multilineTextAlignment(.center)
      Button(L10n.text.copy("退出", "Quit")) { NSApp.terminate(nil) }
    }
    .padding(32).frame(width: 440)
  }
}

/// Owns the runtime sidecar for the whole app lifetime, so closing the window does not stop the runtime.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  let instance: NativeInstance?
  let launchError: String?
  var isPrimary: Bool { instance?.isPrimary == true }
  lazy var sidecar = RuntimeSidecar()
  lazy var model = WorkbenchModel()
  lazy var updater = NativeUpdater()
  lazy var defaultLinks = DefaultLinkModel()
  lazy var notifications = NativeNotifications()
  lazy var panels = NativePanels(workbench: model)
  lazy var shortcuts = NativeShortcuts()
  private var navigationReady = false
  private var launched = false
  private var relayedRequests: [NativeOpenRequest] = []
  private var relayTask: Task<Void, Never>?
  private var launchPayloadDeadline: Date?
  private var terminating = false
  private var snapshotRefresh: Task<Void, Never>?
  private var pendingProjectURLs: [URL] = []
  private var projectImportTask: Task<Void, Never>?

  override init() {
    do {
      instance = try NativeInstance(profile: NativeStorage.directory)
      launchError = nil
    } catch {
      instance = nil
      launchError = L10n.text.copy(
        "此资料目录正在使用或迁移，或无法取得私有锁。未打开资料，请关闭相关客户端后重试。",
        "This profile is busy, being migrated, or its private lock is unavailable. No profile was opened. Close its clients and try again."
      )
    }
    super.init()
    if isPrimary { PerformanceTrace.mark(.instancePrimary) }
    if instance == nil { PerformanceTrace.mark(.instanceBlocked) }
    instance?.observe { [weak self] in
      Task { @MainActor [weak self] in self?.deliverInstanceRequests() }
    }
  }

  func applicationWillFinishLaunching(_ notification: Notification) {
    if instance?.isPrimary == false { NSApp.setActivationPolicy(.accessory) }
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    launched = true
    guard isPrimary else {
      guard instance != nil else { return }
      if (notification.userInfo?[NSApplication.launchIsDefaultUserInfoKey] as? NSNumber)?.boolValue == false,
        relayedRequests.isEmpty
      {
        // Non-default launches may deliver their initial file/URL event after didFinishLaunching.
        launchPayloadDeadline = Date().addingTimeInterval(2)
      }
      SystemIntentRouter.shared.connect { [weak self] request in
        switch request {
        case .capture: self?.relay(.capture)
        case .project(let query): self?.relay(.project(query))
        }
      }
      relay(.activate)
      return
    }
    PerformanceTrace.mark(.appLaunched)
    NSApp.setActivationPolicy(.regular)
    NativePreferences.shared.start()
    shortcuts.openProject = { [weak self] project, capability in
      guard let self else { return }
      panels.showMainWindow()
      model.selectProject(project, capability: capability)
    }
    WorkbenchShortcuts.updateAppShortcutParameters()
    notifications.start()
    notifications.openProject = { [weak self] project in
      guard let self else { return }
      showMainWindow()
      model.selectProject(project, capability: nil)
    }
    model.importProjects = { [weak self] urls in self?.acceptProjectURLs(urls) }
    model.observation.onInvalidation = { [weak self] changes in
      guard let self else { return }
      model.invalidate(changes)
      if changes.contains(.runs) { notifications.refresh() }
      if !changes.isDisjoint(with: [
        .projects, .projectCatalog, .plugins, .pluginUpdate, .userConfig, .configurationSync, .settings,
      ]) {
        panels.palette.invalidate()
        shortcuts.refresh()
      }
      if panels.capture.isOpen, !changes.isDisjoint(with: [.plugins, .userConfig, .configurationSync, .integrations]) {
        Task { await self.panels.capture.load() }
      }
    }
    model.presentPanel = { [weak self] name, mode in
      if name == "capture" {
        self?.panels.showCapture()
      } else {
        self?.panels.showPalette(mode: CommandPaletteModel.Category(rawValue: mode ?? "all") ?? .all)
      }
    }
    sidecar.onConnectionChange = { [weak self] connection in
      guard let self else { return }
      let client = connection.map { RuntimeAPIClient(connection: $0) }
      panels.palette.connect(client)
      panels.capture.connect(client)
      shortcuts.connect(client)
      model.connect(connection)
      notifications.connect(client)
      if connection != nil { importPendingProjects() }
    }
    model.restartRuntime = { [weak self] in
      guard let self, case .ready(let connection, _) = sidecar.state else { throw RuntimeAPIError.invalidResponse }
      guard !nativeOperationPending else {
        throw RuntimeAPIError.rejected(409, "Finish the current native operation before restarting.")
      }
      try await RuntimeAPIClient(connection: connection).requireIdleRuntime()
      guard case .ready(let current, _) = sidecar.state, current == connection, !nativeOperationPending else {
        throw RuntimeAPIError.invalidResponse
      }
      // Let the initiating bridge call finish before replacing its web view.
      DispatchQueue.main.async { [weak self] in self?.sidecar.start() }
    }
    panels.registerShortcut()
    sidecar.start()
    updater.start()
    snapshotRefresh = Task { [weak self] in
      while !Task.isCancelled {
        do { try await Task.sleep(for: .seconds(60)) } catch { return }
        guard let self else { return }
        // Keep background execution and event subscriptions alive, but do not wake external work sources for hidden UI.
        guard NSApp.windows.contains(where: { $0.isVisible }) else { continue }
        await model.today.load()
      }
    }
    deliverInstanceRequests()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

  func application(_ application: NSApplication, open urls: [URL]) {
    guard isPrimary else {
      if instance != nil { relay(.urls(urls)) }
      return
    }
    let files = urls.filter(\.isFileURL)
    if !files.isEmpty { acceptProjectURLs(files) }
    for url in urls where !url.isFileURL {
      showMainWindow()
      model.acceptDesktopLink(url)
    }
  }

  func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
    guard isPrimary else { return nil }
    let menu = NSMenu()
    func item(_ title: String, _ action: Selector, projectID: String? = nil) {
      let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
      entry.target = self
      entry.representedObject = projectID
      menu.addItem(entry)
    }
    item(L10n.text.copy("显示 Craft Hub", "Show Craft Hub"), #selector(showMainWindow))
    item(L10n.text.copy("快速记录", "Quick Capture"), #selector(showCapture))
    item(L10n.text.commandPalette, #selector(showPalette))
    if !model.recentProjects.isEmpty { menu.addItem(.separator()) }
    for project in model.recentProjects {
      item(WorkbenchMenu.shortTitle(project.name), #selector(openRecentProject(_:)), projectID: project.id)
    }
    return menu
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    if isPrimary { showMainWindow() } else if instance != nil { relay(.activate) }
    return false
  }

  func connectNavigation(showMainWindow: @escaping () -> Void, showSettings: @escaping () -> Void) {
    guard isPrimary else { return }
    panels.showMainWindow = showMainWindow
    model.presentSettings = showSettings
    SystemIntentRouter.shared.connect { [weak self] request in
      guard let self else { return }
      switch request {
      case .capture: panels.showCapture()
      case .project(let query):
        self.showMainWindow()
        model.projects.search = query
        model.selection = .projects
        model.select(.projects)
      }
    }
    navigationReady = true
    deliverInstanceRequests()
  }

  private func deliverInstanceRequests() {
    guard isPrimary, navigationReady, launched else { return }
    for request in instance?.drain() ?? [] {
      PerformanceTrace.mark(.instanceReceived)
      switch request {
      case .activate: showMainWindow()
      case .urls(let urls): application(NSApp, open: urls)
      case .capture: panels.showCapture()
      case .project(let query): try? SystemIntentRouter.shared.openProject(query)
      }
    }
  }

  private func relay(_ request: NativeOpenRequest) {
    guard let instance, !instance.isPrimary, relayedRequests.count < 64 else { return }
    if request != .activate { launchPayloadDeadline = nil }
    relayedRequests.append(request)
    guard launched, relayTask == nil else { return }
    relayTask = Task {
      defer { relayTask = nil }
      do {
        while let deadline = launchPayloadDeadline, Date() < deadline {
          try await Task.sleep(for: .milliseconds(50))
        }
        launchPayloadDeadline = nil
        while true {
          while !relayedRequests.isEmpty {
            let request = relayedRequests.removeFirst()
            try await Task.detached { try instance.forward(request) }.value
            PerformanceTrace.mark(.instanceForwarded)
          }
          // Launch Services can deliver open events after didFinishLaunching. Drain late events before exiting.
          try await Task.sleep(for: .seconds(1))
          if relayedRequests.isEmpty { break }
        }
        NSApp.terminate(nil)
      } catch {
        let alert = NSAlert()
        alert.messageText = L10n.text.copy("无法转交给已有窗口", "Could not reach the existing window")
        alert.informativeText = L10n.text.copy(
          "已有 App 未确认导航请求。此进程未打开资料或启动辅助进程；请关闭后重新打开。",
          "The existing app did not acknowledge navigation. This process opened no profile and started no sidecar. Close it and try again."
        )
        alert.addButton(withTitle: L10n.text.copy("退出", "Quit"))
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
        NSApp.terminate(nil)
      }
    }
  }

  @objc private func showMainWindow() {
    panels.showMainWindow()
    NSApp.activate(ignoringOtherApps: true)
  }
  @objc private func showCapture() { panels.showCapture() }
  @objc private func showPalette() { panels.showPalette() }
  @objc private func openRecentProject(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String, model.recentProjects.contains(where: { $0.id == id }) else {
      return
    }
    showMainWindow()
    model.selectProject(id, capability: nil)
  }

  private func acceptProjectURLs(_ urls: [URL]) {
    let combined = Array(Set(pendingProjectURLs + urls.filter(\.isFileURL)))
    guard combined.count <= 100 else {
      model.projects.report(
        RuntimeAPIError.rejected(400, L10n.text.copy("每次最多添加 100 个文件夹。", "Add at most 100 folders at a time.")))
      return
    }
    pendingProjectURLs = combined
    guard !pendingProjectURLs.isEmpty else { return }
    panels.showMainWindow()
    NSApp.activate(ignoringOtherApps: true)
    model.selection = .projects
    model.select(.projects)
    if case .ready = sidecar.state { importPendingProjects() }
  }

  private func importPendingProjects() {
    guard projectImportTask == nil, !pendingProjectURLs.isEmpty else { return }
    projectImportTask = Task {
      defer { projectImportTask = nil }
      while !pendingProjectURLs.isEmpty && !Task.isCancelled {
        guard case .ready = sidecar.state else { return }
        if model.projects.adding {
          do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
          continue
        }
        let urls = pendingProjectURLs
        pendingProjectURLs = []
        await model.projects.add(urls)
      }
    }
  }

  private var nativeOperationPending: Bool {
    panels.capture.busy || model.plugins.busy || model.cloud.operating || model.codexActivity.busy || defaultLinks.busy
      || model.machine?.installations.installing == true
      || model.machine?.installations.uncertain != nil
      || model.machine?.softwareSources.busy == true
      || model.machine?.environmentProfile.busy == true || model.machine?.environmentProfile.uncertain == true
      || model.machine?.environmentSources.busy == true || model.machine?.environmentSources.uncertain == true
      || model.machine?.configuration.busy == true || model.machine?.configuration.uncertain != nil
      || model.machine?.favorites.busy == true || model.machine?.favorites.uncertain == true
      || model.integrations.busy || model.integrations.uncertain != nil || model.integrations.connections.uncertain
      || model.integrations.forms.uncertain || model.workItemActions.pending
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard isPrimary else { return .terminateNow }
    guard !terminating else { return .terminateLater }
    terminating = true
    Task {
      let accepted = await NativeTermination.prepare(
        requireIdle: {
          guard !self.nativeOperationPending else {
            throw RuntimeAPIError.rejected(409, "A native operation is still running.")
          }
          if case .ready(let connection, _) = self.sidecar.state {
            try await RuntimeAPIClient(connection: connection).requireIdleRuntime()
          }
        },
        confirmInterruption: { _ in
          let alert = NSAlert()
          alert.messageText = L10n.text.copy("仍有工作在进行中", "Work may still be in progress")
          alert.informativeText = L10n.text.copy(
            "有任务尚未完成，或无法确认运行时状态。退出会中断当前工作。",
            "Tasks are still running, or the runtime state could not be checked. Quitting will interrupt current work.")
          alert.addButton(withTitle: L10n.text.copy("取消", "Cancel"))
          alert.addButton(withTitle: L10n.text.copy("仍然退出", "Quit Anyway"))
          return alert.runModal() == .alertSecondButtonReturn
        },
        shutdown: {
          self.snapshotRefresh?.cancel()
          self.projectImportTask?.cancel()
          self.panels.stop()
          self.shortcuts.connect(nil)
          self.model.observation.connect(nil)
          self.notifications.connect(nil)
          await self.sidecar.stopAndWait()
        })
      self.terminating = accepted
      sender.reply(toApplicationShouldTerminate: accepted)
    }
    return .terminateLater
  }

  func applicationWillTerminate(_ notification: Notification) {
    guard isPrimary else { return }
    snapshotRefresh?.cancel()
    projectImportTask?.cancel()
    panels.stop()
    shortcuts.connect(nil)
    model.observation.connect(nil)
    notifications.connect(nil)
    sidecar.stop()
  }
}

private struct WorkbenchRootView: View {
  let delegate: AppDelegate
  var body: some View {
    ContentView(model: delegate.model, sidecar: delegate.sidecar)
      .frame(minWidth: 900, minHeight: 620)
      .background(WindowRestoration().frame(width: 0, height: 0))
  }
}

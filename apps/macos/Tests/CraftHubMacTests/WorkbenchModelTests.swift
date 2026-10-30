import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

@MainActor @Test func commandInspectionAndTerminalNavigationRemainNativeAndPreserveProjectSelection() {
  let suite = "craft-hub-command-navigation-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = WorkbenchModel(defaults: defaults)
  model.selectProject("fixture", capability: nil)
  #expect(model.projectTerminal.context == .init(projectID: "fixture"))
  model.projectDetails.search = "build"
  model.showProjectCommand("fixture", capability: "package:build")
  #expect(model.projectCommand.projectID == "fixture")
  #expect(model.projectCommand.capabilityID == "package:build")
  #expect(model.projectTerminal.context == .init(projectID: "fixture", capabilityID: "package:build"))
  #expect(model.presentsNativeContent && !model.webContentRequested && model.webView == nil)
  model.closeProjectCommand()
  #expect(model.projectDetails.projectID == "fixture" && model.projectDetails.search == "build")
  #expect(model.projectCommand.capabilityID == nil && model.presentsNativeContent)
  #expect(model.projectTerminal.context == .init(projectID: "fixture"))
  model.showProjectCommand("fixture", capability: "package:build")
  model.showProjectWeb("fixture", capability: "package:build")
  #expect(!model.presentsNativeContent && model.webContentRequested)
  model.returnToNativeContent()
  #expect(model.projectCommand.capabilityID == "package:build" && model.presentsNativeContent)
  model.select(.overview)
  #expect(model.projectCommand.capabilityID == nil)
  #expect(model.projectTerminal.context == nil)
}

@MainActor @Test func pluginWorkbenchNavigationUsesTheSharedWebRenderer() {
  let suite = "craft-hub-integration-navigation-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = WorkbenchModel(defaults: defaults)
  model.selectSidebar(.builtin(.workbenches))
  #expect(model.selection == .workbenches && !model.presentsNativeContent && model.webContentRequested)
  let request = model.findRequest
  model.find()
  #expect(model.findRequest == request)
  model.navigateToWebPath("/integrations/fixture/view?scope=global")
  #expect(model.selection == .workbenches && !model.presentsNativeContent)
  model.selectSidebar(.builtin(.overview))
  #expect(model.presentsNativeContent)
  model.selectSidebar(.builtin(.workbenches))
  #expect(!model.presentsNativeContent)
}

@MainActor
@Test func lateWebRoutesCannotStealANativeSelection() {
  let suite = "craft-hub-navigation-test-\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = WorkbenchModel(defaults: defaults)
  model.routeChanged("/overview")
  model.selection = .environment
  model.select(.environment)
  model.routeChanged("/software")
  #expect(model.selection == .environment)
  #expect(model.presentsNativeContent)
  model.run("palette")
  model.routeChanged("/tools")
  #expect(model.selection == .environment)
  model.showWebWorkbench()
  model.routeChanged("/tools")
  #expect(model.selection == .tools)
}

@MainActor
@Test func recoveryReturnsFromWebFallbackToTheSavedNativePage() throws {
  let suite = "craft-hub-recovery-test-\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = WorkbenchModel(defaults: defaults)
  model.routeChanged("/overview")
  model.selection = .software
  model.select(.software)
  model.showWebWorkbench()
  #expect(!model.presentsNativeContent)
  let secret = String(repeating: "a", count: 64)
  let data = try JSONSerialization.data(withJSONObject: [
    "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)",
    "nativeApiToken": String(repeating: "b", count: 64),
  ])
  let connection = try RuntimeConnection(handshake: data)
  model.connect(connection)
  model.selection = .software
  model.select(.software)
  model.showWebWorkbench()
  model.connect(nil)
  model.connect(connection)
  model.routeChanged("/overview")
  #expect(model.selection == .software)
  #expect(model.presentsNativeContent)
  #expect(model.machine != nil)
  model.navigateToWebPath("/environment/setup")
  #expect(model.selection == .environment && model.presentsNativeContent)
  #expect(model.machine?.environmentTab == "profile")
  #expect(model.machine?.environmentProfile.snapshot == nil)
  model.showWebWorkbench()
  model.select(.software)
  #expect(model.presentsNativeContent)
}

@MainActor @Test func nativeStartupRestoresTheDestinationWithoutCreatingABrowser() {
  let suite = "craft-hub-lazy-navigation-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  defaults.set("software", forKey: "lastDestination")
  let model = WorkbenchModel(defaults: defaults)
  #expect(model.selection == .software && model.presentsNativeContent)
  for destination in Destination.allCases.filter(\.isNative) {
    model.selection = destination
    model.select(destination)
  }
  model.presentPanel = { _, _ in }
  model.presentSettings = {}
  for command in ["palette", "capture", "settings"] { model.run(command) }
  #expect(!model.webContentRequested && model.webView == nil)
}

@MainActor @Test func webEntrypointsRequestABrowserAndNativeNavigationKeepsTheSessionRequested() {
  let suite = "craft-hub-lazy-entries-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let actions: [(WorkbenchModel) -> Void] = [
    { $0.showWebWorkbench() },
    { $0.runWebCommand("software") },
    { $0.selectProject("fixture", capability: "command") },
    { $0.showIntegrationWeb("/integrations/fixture/view?project=fixture") },
    { $0.acceptDesktopLink(URL(string: "craft-hub://project/fixture")!) },
  ]
  for action in actions {
    let model = WorkbenchModel(defaults: defaults)
    action(model)
    #expect(model.webContentRequested && !model.presentsNativeContent)
    // Presentation creates the browser later, after the sidecar is ready.
    #expect(model.webView == nil)
    model.select(.overview)
    #expect(model.webContentRequested && model.presentsNativeContent)
  }
}

@MainActor @Test func choosingAProjectKeepsItsReviewPageVisibleUntilTheUserReturnsToTheNativeList() {
  let suite = "craft-hub-project-navigation-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = WorkbenchModel(defaults: defaults)
  model.routeChanged("/overview")
  model.selection = .projects
  model.select(.projects)
  #expect(model.presentsNativeContent)
  model.selectProject("registered-project", capability: nil)
  #expect(model.projectDetails.projectID == "registered-project" && model.presentsNativeContent)
  #expect(!model.webContentRequested && model.webView == nil)
  model.select(nil)
  #expect(model.projectDetails.projectID == "registered-project")
  model.selectProject("registered-project", capability: "command")
  #expect(!model.presentsNativeContent && model.selection == .projects)
  model.routeChanged("/")
  #expect(!model.presentsNativeContent)
  model.returnToNativeContent()
  #expect(model.presentsNativeContent && model.projectDetails.projectID == "registered-project")
  #expect(model.webContentRequested)
  model.select(.projects)
  #expect(model.presentsNativeContent && model.projectDetails.projectID == nil)
}

@MainActor @Test func pluginAndDiagnosticsEntrypointsUseNativeSearchablePages() {
  let suite = "craft-hub-management-navigation-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = WorkbenchModel(defaults: defaults)
  model.navigateToWebPath("/marketplace")
  #expect(model.selection == .marketplace && model.presentsNativeContent)
  let old = model.findRequest
  model.find()
  #expect(model.findRequest == old + 1)
  model.navigateToWebPath("/diagnostics")
  #expect(model.selection == .diagnostics && model.presentsNativeContent)
  model.find()
  #expect(model.findRequest == old + 2)
}

@MainActor @Test func validatedMarketplaceLinksNavigateToNativeSourceReviewWithoutAddingAnything() throws {
  let suite = "craft-hub-source-link-test-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = WorkbenchModel(defaults: defaults)
  model.showWebWorkbench()
  try model.openPluginManagement(catalogURL: "https://example.com/catalog.json")
  #expect(model.selection == .marketplace && model.presentsNativeContent)
  #expect(model.plugins.tab == .sources)
  #expect(model.plugins.sourceCatalogURL == "https://example.com/catalog.json")
  #expect(model.plugins.sourceReview == nil && !model.plugins.busy)
  model.routeChanged("/overview")
  #expect(model.selection == .marketplace && model.presentsNativeContent)
  try model.openPluginManagement(catalogURL: nil)
  #expect(model.plugins.sourceCatalogURL == "https://example.com/catalog.json")
}

@MainActor @Test func toolsNavigationUsesNativeFavoritesAndWebsiteDirectory() {
  let suite = "craft-hub-tools-navigation-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = WorkbenchModel(defaults: defaults)
  model.routeChanged("/overview")
  model.navigateToWebPath("/tools")
  #expect(model.selection == .tools && model.presentsNativeContent)
  let request = model.findRequest
  model.find()
  #expect(model.findRequest == request + 1)
  model.navigateToWebPath("/navigation")
  model.routeChanged("/navigation")
  #expect(model.selection == .tools && model.presentsNativeContent && model.toolsPage == .navigation)
  model.navigateToWebPath("/tools")
  #expect(model.toolsPage == .favorites)
  model.select(.tools)
  #expect(model.presentsNativeContent)
  model.navigateToWebPath("/software")
  #expect(model.selection == .software && model.presentsNativeContent)
}

@MainActor @Test func websiteDirectoryRestoresAfterRestartAndAdoptsWebAndPaletteRoutes() {
  let suite = "craft-hub-directory-navigation-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let original = WorkbenchModel(defaults: defaults)
  original.routeChanged("/overview")
  original.navigateToWebPath("/navigation")
  #expect(original.toolsPage == .navigation && original.presentsNativeContent)
  original.navigateToWebPath("/marketplace")
  #expect(original.selection == .marketplace)
  original.selection = .tools
  original.select(.tools)
  #expect(original.toolsPage == .navigation && original.presentsNativeContent)
  let reopened = WorkbenchModel(defaults: defaults)
  reopened.routeChanged("/overview")
  #expect(reopened.selection == .tools && reopened.toolsPage == .navigation && reopened.presentsNativeContent)
  reopened.showIntegrationWeb("/integrations/fixture/view")
  reopened.routeChanged("/tools")
  #expect(reopened.toolsPage == .favorites && reopened.presentsNativeContent)
  // A hidden web navigation must not steal the active native subpage.
  reopened.routeChanged("/navigation")
  #expect(reopened.toolsPage == .favorites)
  reopened.showIntegrationWeb("/integrations/fixture/view")
  reopened.routeChanged("/navigation")
  #expect(reopened.toolsPage == .navigation && reopened.presentsNativeContent)
  let request = reopened.findRequest
  reopened.find()
  #expect(reopened.findRequest == request + 1)
}

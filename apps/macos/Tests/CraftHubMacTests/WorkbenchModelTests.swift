import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

@MainActor @Test func integrationFallbackKeepsTheNativeWorkbenchReturnAndSearchEntrypoints() {
  let suite = "craft-hub-integration-navigation-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  let model = WorkbenchModel(defaults: defaults)
  model.routeChanged("/overview")
  model.selection = .workbenches
  model.select(.workbenches)
  #expect(model.presentsNativeContent)
  let request = model.findRequest
  model.find()
  #expect(model.findRequest == request + 1)
  model.showIntegrationWeb("/integrations/fixture/view?project=selected")
  model.routeChanged("/integrations/fixture/view")
  #expect(model.selection == .workbenches && !model.presentsNativeContent)
  model.select(.workbenches)
  #expect(model.presentsNativeContent)
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
  model.connect(try RuntimeConnection(handshake: data))
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

@MainActor @Test func recreatedWindowsReuseTheEphemeralSessionUntilTheRuntimeChanges() throws {
  let model = WorkbenchModel()
  let original = model.webSessionDataStore()
  model.webWillLoad()
  #expect(model.webSessionDataStore() === original)
  #expect(!original.isPersistent)
  let secret = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)",
      "nativeApiToken": secret,
    ]))
  model.connect(connection)
  #expect(model.webSessionDataStore() !== original)
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
  model.selectProject("registered-project", capability: "command")
  #expect(!model.presentsNativeContent && model.selection == .projects)
  model.routeChanged("/")
  #expect(!model.presentsNativeContent)
  model.select(.projects)
  #expect(model.presentsNativeContent)
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

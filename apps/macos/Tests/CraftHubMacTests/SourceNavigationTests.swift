import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

@MainActor private func withPluginNavigationModel(_ body: (WorkbenchModel) -> Void) {
  let suite = "craft-hub-plugin-navigation-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  body(WorkbenchModel(defaults: defaults))
}

@MainActor @Test(arguments: ["tasks", "configuration", "resources", "connection", "weekly"])
func pluginViewsAlwaysOpenWebWithoutNativeCatalogReads(_ view: String) {
  withPluginNavigationModel { model in
    model.navigateToWebPath("/integrations/fixture/\(view)?scope=global")
    #expect(model.selection == .workbenches && model.showsWebContent && model.webContentRequested)
    #expect(!model.presentsNativeContent && model.navigationError == nil)
    model.routeChanged("/integrations/fixture/\(view)")
    #expect(model.sidebarSelection == .builtin(.workbenches))
  }
}

@MainActor @Test func pluginNavigationRejectsAnUnavailableProjectBeforeOpeningTheBrowser() {
  withPluginNavigationModel { model in
    model.select(.software)
    model.navigateToWebPath("/integrations/fixture/tasks?project=removed")
    #expect(model.selection == .software && model.presentsNativeContent)
    #expect(!model.webContentRequested && model.navigationError != nil)
  }
}

@MainActor @Test func pluginMutationsBlockNativeNavigationAndReloadUntilSettled() {
  withPluginNavigationModel { model in
    model.navigateToWebPath("/integrations/fixture/tasks?scope=global")
    model.routeChanged("/integrations/fixture/tasks")
    model.setWebOperationPending(true)
    model.selectSidebar(.builtin(.projects))
    model.navigateToWebPath("/software")
    model.selectProject("fixture", capability: nil)
    model.showProjectCommand("fixture", capability: "build")
    model.acceptDesktopLink(URL(string: "craft-hub://project/fixture")!)
    model.reload()
    #expect(model.selection == .workbenches && model.showsWebContent)
    #expect(model.projectDetails.projectID == nil && model.projectCommand.capabilityID == nil)
    #expect(model.navigationError != nil)
    model.setWebOperationPending(false)
    model.selectSidebar(.builtin(.projects))
    #expect(model.selection == .projects && model.presentsNativeContent)
  }
}

@MainActor @Test func startupAndRuntimeRecoveryRestoreTheWebWorkbench() throws {
  let suite = "craft-hub-plugin-startup-\(UUID())"
  let defaults = UserDefaults(suiteName: suite)!
  defer { defaults.removePersistentDomain(forName: suite) }
  defaults.set("workbenches", forKey: "lastDestination")
  let model = WorkbenchModel(defaults: defaults)
  defer { model.connect(nil) }
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)",
      "nativeApiToken": token,
    ]))
  model.connect(connection)
  #expect(model.selection == .workbenches && model.webContentRequested && !model.presentsNativeContent)
  model.setWebOperationPending(true)
  model.connect(nil)
  model.connect(connection)
  #expect(!model.webOperationPending && model.webContentRequested && !model.presentsNativeContent)
}

import AppKit
import CraftHubMacCore
import SwiftUI
import Testing

@testable import CraftHubMac

@MainActor private func terminalControlPickers(in view: NSView) -> [NSPopUpButton] {
  (view as? NSPopUpButton).map { [$0] } ?? view.subviews.flatMap { terminalControlPickers(in: $0) }
}

@Suite(.serialized) @MainActor struct ProjectTerminalControlTests {
  private func model() async throws -> (String, UserDefaults, ProjectTerminalModel) {
    let suite = "CraftHubTerminalControl-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    let model = ProjectTerminalModel(defaults: defaults)
    let secret = String(repeating: "a", count: 64)
    let connection = try RuntimeConnection(
      handshake: JSONSerialization.data(withJSONObject: [
        "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)",
        "nativeApiToken": secret,
      ]))
    model.connect(
      RuntimeAPIClient(
        connection: connection,
        transport: { request in
          #expect(request.url!.path == "/api/native-host/terminal-applications" && request.httpBody == nil)
          return (
            Data(#"{"version":1,"applications":["Terminal","Ghostty","iTerm"]}"#.utf8),
            HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
          )
        }))
    model.select(projectID: "fixture")
    await model.load()
    return (suite, defaults, model)
  }

  @Test func externalTerminalControlKeepsItsNativePickerFunctionalAcrossNarrowLayouts() async throws {
    let (suite, defaults, model) = try await model()
    defer { defaults.removePersistentDomain(forName: suite) }
    for width in [900.0, 640.0, 320.0] {
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: width, height: 240), styleMask: [.borderless], backing: .buffered,
        defer: false)
      window.isReleasedWhenClosed = false
      let host = NSHostingView(
        rootView:
          ProjectTerminalControl(model: model, projectID: "fixture").padding(12).frame(
            width: width, alignment: .leading))
      window.contentView = host
      defer {
        window.close()
        window.contentView = nil
      }
      host.layoutSubtreeIfNeeded()
      try await Task.sleep(for: .milliseconds(60))
      host.layoutSubtreeIfNeeded()
      let picker = try #require(terminalControlPickers(in: host).first)
      #expect(picker.itemArray.map(\.title) == ["Terminal", "Ghostty", "iTerm2"])
      #expect(picker.titleOfSelectedItem == ProjectTerminalModel.displayName(model.preferredApplication))
      let next = model.preferredApplication == "Ghostty" ? "Terminal" : "Ghostty"
      let index = picker.indexOfItem(withTitle: next)
      #expect(index >= 0)
      picker.menu?.performActionForItem(at: index)
      await Task.yield()
      #expect(model.preferredApplication == next)
      #expect(host.fittingSize.width <= width + 1 && host.fittingSize.height < 240)
      #expect(model.context == .init(projectID: "fixture") && model.canOpen)
    }
  }

  @Test func commandExternalTerminalControlTargetsTheCommandWithoutRequestingAnOpenOnAppearance() async throws {
    let (suite, defaults, model) = try await model()
    defer { defaults.removePersistentDomain(forName: suite) }
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 640, height: 220), styleMask: [.borderless], backing: .buffered,
      defer: false)
    window.isReleasedWhenClosed = false
    defer {
      window.close()
      window.contentView = nil
    }
    let host = NSHostingView(
      rootView:
        ProjectTerminalControl(model: model, projectID: "fixture", capabilityID: "package:build").padding(12))
    window.contentView = host
    host.layoutSubtreeIfNeeded()
    try await Task.sleep(for: .milliseconds(60))
    #expect(model.context == .init(projectID: "fixture", capabilityID: "package:build"))
    #expect(model.notice == nil && model.error == nil && !model.opening)
  }
}

import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private let localNavigationPackage = "@example/craft-hub-plugin-suite"

@MainActor private func localNavigationModel(local: Bool) async throws -> (PluginsModel, () -> [URLRequest]) {
  let metadata: [String: Any] = [
    "displayName": "Suite", "permissions": [], "includesPlugins": [], "requiresPlugins": [],
  ]
  let catalog = metadata.merging([
    "package": localNavigationPackage, "version": "1.0.0", "sourceId": "fixture", "sourceName": "Fixture",
    "sourceKind": "user", "publisher": "Example", "status": "blocked", "action": local ? "local" : "install",
    "preferred": true, "included": false,
  ]) { _, value in value }
  let installed: [[String: Any]] =
    local
    ? [
      [
        "package": localNavigationPackage, "version": "2.0.0", "sourceId": "local", "origin": "local",
        "enabled": true, "packagePath": "/fixture/local-suite", "manifest": metadata,
      ]
    ] : []
  let overview = try JSONSerialization.data(withJSONObject: [
    "version": 1, "catalog": [catalog], "installed": installed, "sources": [],
  ])
  let token = String(repeating: "a", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(token)",
      "nativeApiToken": token,
    ]))
  var requests: [URLRequest] = []
  let model = PluginsModel()
  model.connect(
    RuntimeAPIClient(connection: connection) { request in
      requests.append(request)
      return (overview, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    })
  await model.load()
  return (model, { requests })
}

@MainActor @Test func blockedCatalogStillOpensTheLinkedPluginInsteadOfInstallingItsOldVersion() async throws {
  let (model, requests) = try await localNavigationModel(local: true)
  let plugin = try #require(model.catalog.first)
  #expect(model.canPerformCatalogAction(plugin))
  let destination = model.catalogDetail(plugin)
  #expect(destination.source == "local")
  #expect(destination.version == "2.0.0")
  await model.performCatalogAction(plugin)
  #expect(model.detail?.source == "local")
  #expect(model.detail?.version == "2.0.0")
  #expect(model.installReview == nil)
  #expect(model.error == nil)
  await model.show(package: localNavigationPackage, source: "fixture")
  #expect(model.detail?.source == "local")
  #expect(model.detail?.version == "2.0.0")
  #expect(requests().map(\.httpMethod) == ["GET"])
}

@MainActor @Test func blockedCatalogWithoutALocalOverrideCannotStartAnInstallation() async throws {
  let (model, requests) = try await localNavigationModel(local: false)
  let plugin = try #require(model.catalog.first)
  #expect(!model.canPerformCatalogAction(plugin))
  #expect(model.catalogDetail(plugin).source == "fixture")
  await model.performCatalogAction(plugin)
  await model.preview(plugin)
  #expect(model.detail == nil)
  #expect(model.installReview == nil)
  #expect(model.error == nil)
  #expect(requests().map(\.httpMethod) == ["GET"])
}

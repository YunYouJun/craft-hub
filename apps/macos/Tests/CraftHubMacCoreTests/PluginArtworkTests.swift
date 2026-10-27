import Foundation
import Testing

@testable import CraftHubMacCore

private func iconConnection() throws -> RuntimeConnection {
  let secret = String(repeating: "a", count: 64)
  return try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)",
      "nativeApiToken": secret,
    ]))
}

@Test func pluginArtworkDistinguishesPackageRemoteAndInlineSources() throws {
  let reference = PluginIconReference(sourceID: "local", package: "example-plugin", version: "1.0.0")
  #expect(
    PluginArtwork(icon: "assets/brand.svg", sourceID: "local", package: "example-plugin", version: "1.0.0").source
      == .package(reference))
  let url = URL(string: "https://example.com/brand.svg")!
  #expect(PluginArtwork(icon: url.absoluteString).source == .remote(url))
  let data = "data:image/png;base64,AA=="
  #expect(PluginArtwork(icon: data).source == .inline(data))
  for value in [
    "http://example.com/logo.png", "https://user:secret@example.com/logo.png", "file:///tmp/logo.png",
    "/tmp/logo.png", "../logo.png", "assets/../logo.png", "assets\\..\\logo.png",
    "data:image/png;base64," + String(repeating: "A", count: 512 * 1024),
  ] {
    #expect(PluginArtwork(icon: value, sourceID: "local", package: "example-plugin").source == nil)
  }
  #expect(PluginArtwork(icon: "assets/brand.svg").source == nil)
  #expect(PluginArtwork(icon: nil).source == nil)
  #expect(PluginArtwork(icon: "").source == nil)
}

@Test func marketplaceIconsDecodeFromCatalogAndInstalledManifestsWithoutRequiringThem() throws {
  let data = Data(
    #"""
    {"version":1,"sources":[],"catalog":[{"package":"example-plugin","version":"1.0.0","sourceId":"example-source","sourceName":"Example","sourceKind":"user","status":"available","publisher":"Example","action":"install","preferred":true,"included":false,"displayName":"Example","icon":"https://example.com/brand.png","permissions":[],"includesPlugins":[],"requiresPlugins":[]}],"installed":[{"package":"example-plugin","version":"1.0.0","sourceId":"local","enabled":true,"packagePath":"/fixture/plugin","manifest":{"displayName":"Example","icon":"assets/brand.svg","permissions":[],"includesPlugins":[],"requiresPlugins":[]}},{"package":"another-plugin","version":"1.0.0","sourceId":"local","enabled":false,"packagePath":"/fixture/another","manifest":{"displayName":"Another","permissions":[],"includesPlugins":[],"requiresPlugins":[]}}]}
    """#.utf8)
  let snapshot = try JSONDecoder().decode(MarketplaceOverview.self, from: data)
  #expect(snapshot.catalog.first?.artwork.source == .remote(URL(string: "https://example.com/brand.png")!))
  #expect(
    snapshot.installed.first?.artwork.source
      == .package(.init(sourceID: "local", package: "example-plugin", version: "1.0.0")))
  #expect(snapshot.installed.last?.manifest.icon == nil)
  #expect(snapshot.installed.last?.artwork.source == nil)
}

@Test func packageArtworkRequestKeepsIdentityInQueryAndUsesOnlyRuntimeCredentials() async throws {
  let reference = PluginIconReference(sourceID: "source/a?b", package: "@example/plugin", version: "1.2.3+build")
  let content = Data("artwork".utf8)
  let client = RuntimeAPIClient(connection: try iconConnection()) { request in
    #expect(request.url?.path == "/api/plugins/icon")
    #expect(request.httpMethod == "GET")
    #expect(request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true)
    #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
    #expect(!request.httpShouldHandleCookies)
    let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
    #expect(query?.first { $0.name == "sourceId" }?.value == reference.sourceID)
    #expect(query?.first { $0.name == "package" }?.value == reference.package)
    #expect(query?.first { $0.name == "version" }?.value == reference.version)
    return (
      content,
      HTTPURLResponse(
        url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "image/png"])!
    )
  }
  #expect(try await client.pluginIcon(reference) == content)
}

@Test func packageArtworkRejectsRedirectsNonImagesAndOversizeResponses() async throws {
  let reference = PluginIconReference(sourceID: "local", package: "example-plugin")
  for variant in ["redirect", "html", "large", "missing"] {
    let client = RuntimeAPIClient(connection: try iconConnection()) { request in
      let url = variant == "redirect" ? URL(string: "https://example.com/logo.svg")! : request.url!
      let data = Data(repeating: 65, count: variant == "large" ? 128_001 : 10)
      return (
        data,
        HTTPURLResponse(
          url: url, statusCode: variant == "missing" ? 404 : 200, httpVersion: nil,
          headerFields: ["Content-Type": variant == "html" ? "text/html" : "image/svg+xml"])!
      )
    }
    await #expect(throws: RuntimeAPIError.self) { try await client.pluginIcon(reference) }
  }
}

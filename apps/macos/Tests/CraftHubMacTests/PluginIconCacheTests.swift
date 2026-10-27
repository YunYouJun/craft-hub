import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private let pluginIconData = Data(
  #"<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="blue"/></svg>"#
    .utf8)

private func pluginIconClient(_ transport: @escaping RuntimeAPIClient.Transport) throws -> RuntimeAPIClient {
  let secret = String(repeating: "a", count: 64)
  return RuntimeAPIClient(
    connection: try RuntimeConnection(
      handshake: JSONSerialization.data(withJSONObject: [
        "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)",
        "nativeApiToken": secret,
      ])), transport: transport)
}

private func pluginIconResponse(_ request: URLRequest, data: Data = pluginIconData) -> (Data, URLResponse) {
  (
    data,
    HTTPURLResponse(
      url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "image/svg+xml"])!
  )
}

@MainActor @Test func packageIconCacheCoalescesRequestsAndKeepsRuntimeSessionsSeparate() async throws {
  let artwork = PluginArtwork(
    icon: "assets/icon.svg", sourceID: "example-source", package: "example-plugin", version: "1.0.0")
  let cache = PluginIconCache()
  var calls = 0
  var held: CheckedContinuation<Void, Never>?
  let firstClient = try pluginIconClient { request in
    calls += 1
    await withCheckedContinuation { held = $0 }
    return pluginIconResponse(request)
  }
  let first = Task { await cache.image(for: artwork, client: firstClient) }
  let second = Task { await cache.image(for: artwork, client: firstClient) }
  for _ in 0..<100 {
    if held != nil { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  try #require(held).resume()
  #expect(await first.value?.isValid == true)
  #expect(await second.value?.isValid == true)
  #expect(await cache.image(for: artwork, client: firstClient)?.isValid == true)
  #expect(calls == 1)
  let secondClient = try pluginIconClient { request in
    calls += 1
    return pluginIconResponse(request)
  }
  #expect(await cache.image(for: artwork, client: secondClient)?.isValid == true)
  #expect(calls == 2)
}

@MainActor @Test func localArtworkReloadsAndBrokenPackageImagesFallBackWithBackoff() async throws {
  let artwork = PluginArtwork(icon: "assets/icon.svg", sourceID: "local", package: "example-plugin", version: "1.0.0")
  var date = Date()
  let cache = PluginIconCache(now: { date })
  var calls = 0
  let client = try pluginIconClient { request in
    calls += 1
    return pluginIconResponse(request)
  }
  #expect(await cache.image(for: artwork, client: client)?.isValid == true)
  #expect(await cache.image(for: artwork, client: client)?.isValid == true)
  #expect(calls == 2)
  var failedCalls = 0
  let broken = try pluginIconClient { request in
    failedCalls += 1
    return pluginIconResponse(request, data: Data("not an image".utf8))
  }
  #expect(await cache.image(for: artwork, client: broken) == nil)
  #expect(await cache.image(for: artwork, client: broken) == nil)
  #expect(failedCalls == 1)
  date = date.addingTimeInterval(61)
  #expect(await cache.image(for: artwork, client: broken) == nil)
  #expect(failedCalls == 2)
  #expect(await cache.image(for: artwork, client: broken, revision: 1) == nil)
  #expect(failedCalls == 3)
  #expect(await cache.image(for: artwork) == nil)
}

@MainActor @Test func contributionArtworkReusesHTTPSCacheAndDecodesInlineIconsWithoutRuntimeRequests() async throws {
  var calls = 0
  let remote = SoftwareIconCache { request in
    calls += 1
    #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    #expect(!request.httpShouldHandleCookies)
    return pluginIconResponse(request)
  }
  let cache = PluginIconCache(remote: remote)
  let artwork = PluginArtwork(icon: "https://example.com/brand.svg")
  #expect(await cache.image(for: artwork)?.isValid == true)
  #expect(await cache.image(for: artwork)?.isValid == true)
  #expect(calls == 1)
  let inline = PluginArtwork(icon: "data:image/svg+xml;base64," + pluginIconData.base64EncodedString())
  #expect(await cache.image(for: inline)?.isValid == true)
  #expect(calls == 1)
  #expect(await cache.image(for: PluginArtwork(icon: nil)) == nil)
  #expect(await cache.image(for: PluginArtwork(icon: "data:image/png;base64,broken!")) == nil)
}

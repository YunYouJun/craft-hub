import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

@Test func softwareSnapshotsPreserveArtworkAndAcceptLegacyItems() throws {
  let metadata: [String: Any] = [
    "iconUrl": "https://example.com/logo.png", "macosIconUrl": "https://example.com/mac.png",
    "iconStyle": "rounded", "iconScale": 1.25,
  ]
  var item: [String: Any] = [
    "id": "editor", "title": ["en": "Editor"], "group": ["id": "tools", "title": ["en": "Tools"]],
    "url": "https://example.com/editor?ref=catalog#download", "status": "not-detected",
  ]
  let legacy = try JSONDecoder().decode(SoftwareSnapshot.Item.self, from: JSONSerialization.data(withJSONObject: item))
  #expect(legacy.artwork.sources.map(\.url.absoluteString) == ["https://example.com/favicon.ico"])
  item.merge(metadata) { _, new in new }
  let catalog = try JSONDecoder().decode(SoftwareSnapshot.Item.self, from: JSONSerialization.data(withJSONObject: item))
  item["title"] = "Editor"
  item["group"] = "Tools"
  let favorite = try JSONDecoder().decode(
    SoftwareFavoritesSnapshot.Tool.self, from: JSONSerialization.data(withJSONObject: item))
  #expect(catalog.artwork == favorite.artwork)
  #expect(
    catalog.artwork.sources.map(\.url.absoluteString) == [
      "https://example.com/mac.png", "https://example.com/logo.png", "https://example.com/favicon.ico",
    ])
  #expect(catalog.artwork.sources.map(\.rounded) == [false, true, false])
  #expect(catalog.artwork.sources.map(\.scale) == [1.25, 1.25, 1])
}

@Test func softwareArtworkRejectsUnsafeURLsAndDeduplicatesSources() {
  for value in [
    "http://example.com/logo.png", "file:///tmp/logo.png", "https://user:secret@example.com/logo.png",
    "https://example.com/\nlogo.png",
  ] {
    #expect(SoftwareArtwork(website: value, iconURL: value, macosIconURL: value).sources.isEmpty)
  }
  let same = SoftwareArtwork(
    website: "https://example.com/tool", iconURL: "https://example.com/favicon.ico",
    macosIconURL: "https://example.com/favicon.ico", style: "rounded", scale: 4)
  #expect(same.sources.count == 1)
  #expect(same.sources.first?.scale == 1 && same.sources.first?.rounded == false)
}

private let iconSVG = Data(
  #"<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>"#
    .utf8)
private func iconResponse(_ url: URL, status: Int = 200) -> HTTPURLResponse {
  HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}

@MainActor @Test func softwareIconFallsBackFromMissingNativeImageToSVGWithoutCredentials() async {
  var requests: [URLRequest] = []
  let loader = SoftwareIconLoader { request in
    requests.append(request)
    return (iconSVG, iconResponse(request.url!, status: requests.count == 1 ? 404 : 200))
  }
  let artwork = SoftwareArtwork(
    website: "https://example.com", iconURL: "https://example.com/logo.svg",
    macosIconURL: "https://example.com/mac.png", style: "rounded")
  await loader.load(artwork)
  #expect(requests.count == 2)
  #expect(loader.loaded?.source.url.path == "/logo.svg" && loader.loaded?.source.rounded == true)
  #expect(loader.loaded?.image.isValid == true)
  #expect(requests.allSatisfy { !$0.httpShouldHandleCookies && $0.allHTTPHeaderFields?.isEmpty != false })
}

@MainActor @Test func softwareIconFallsBackToFaviconAndClearsPreviousImageWhenUnavailable() async {
  var paths: [String] = []
  let loader = SoftwareIconLoader { request in
    paths.append(request.url!.path)
    if request.url!.host == "offline.example.com" { throw URLError(.notConnectedToInternet) }
    let data = request.url!.path == "/favicon.ico" ? iconSVG : Data("<html>Not an image</html>".utf8)
    return (data, iconResponse(request.url!))
  }
  await loader.load(SoftwareArtwork(website: "https://example.com", iconURL: "https://example.com/invalid.png"))
  #expect(paths == ["/invalid.png", "/favicon.ico"])
  #expect(loader.loaded?.source.url.path == "/favicon.ico")
  await loader.load(SoftwareArtwork(website: "https://offline.example.com"))
  #expect(loader.loaded == nil)
}

@MainActor @Test func cancelledSoftwareIconRequestCannotRestoreAnOldImage() async throws {
  var held: CheckedContinuation<Void, Never>?
  var calls = 0
  let loader = SoftwareIconLoader { request in
    calls += 1
    if request.url!.path == "/old.png" { await withCheckedContinuation { held = $0 } }
    return (iconSVG, iconResponse(request.url!))
  }
  let old = Task {
    await loader.load(SoftwareArtwork(website: "https://example.com", iconURL: "https://example.com/old.png"))
  }
  for _ in 0..<100 {
    if held != nil { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  let continuation = try #require(held)
  old.cancel()
  await loader.load(SoftwareArtwork(website: "https://example.com", iconURL: "https://example.com/new.png"))
  continuation.resume()
  await old.value
  #expect(calls == 2)
  #expect(loader.loaded?.source.url.path == "/new.png")
}

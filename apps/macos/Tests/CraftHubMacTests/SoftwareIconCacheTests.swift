import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

private let cachedIcon = Data(
  #"<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12" fill="red"/></svg>"#
    .utf8)
private func imageResponse(_ url: URL, status: Int = 200, type: String = "image/svg+xml") -> HTTPURLResponse {
  HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": type])!
}
private func cacheDirectory() -> URL {
  FileManager.default.temporaryDirectory.appendingPathComponent("artwork-cache-\(UUID())")
}

@MainActor @Test func artworkCacheCoalescesRequestsAndSurvivesAColdStart() async throws {
  let directory = cacheDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let url = URL(string: "https://example.com/logo.svg")!
  var calls = 0
  var held: CheckedContinuation<Void, Never>?
  let cache = SoftwareIconCache(
    directory: directory,
    transport: { request in
      calls += 1
      await withCheckedContinuation { held = $0 }
      return (cachedIcon, imageResponse(request.url!))
    })
  let first = Task { await cache.image(for: url) }
  let second = Task { await cache.image(for: url) }
  for _ in 0..<100 {
    if held != nil { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  try #require(held).resume()
  #expect(await first.value?.isValid == true)
  #expect(await second.value?.isValid == true)
  #expect(await cache.image(for: url)?.isValid == true)
  #expect(calls == 1)
  var coldCalls = 0
  let cold = SoftwareIconCache(
    directory: directory,
    transport: { _ in
      coldCalls += 1
      throw URLError(.notConnectedToInternet)
    })
  #expect(await cold.image(for: url)?.isValid == true)
  #expect(coldCalls == 0)
}

@MainActor @Test func expiredArtworkSurvivesOfflineAndRetriesAfterBackoff() async throws {
  let url = URL(string: "https://example.com/logo.svg")!
  var date = Date()
  var calls = 0
  let cache = SoftwareIconCache(
    lifetime: 60, now: { date },
    transport: { request in
      calls += 1
      if calls == 2 { throw URLError(.notConnectedToInternet) }
      return (cachedIcon, imageResponse(request.url!))
    })
  #expect(await cache.image(for: url)?.isValid == true)
  date = date.addingTimeInterval(61)
  #expect(await cache.image(for: url)?.isValid == true)
  #expect(await cache.image(for: url)?.isValid == true)
  #expect(calls == 2)
  date = date.addingTimeInterval(601)
  #expect(await cache.image(for: url)?.isValid == true)
  #expect(calls == 3)
}

@MainActor @Test func artworkCacheRejectsBadDataAndUnsafeURLsWithoutPersistingThem() async throws {
  let directory = cacheDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  var calls = 0
  let cache = SoftwareIconCache(
    directory: directory,
    transport: { request in
      calls += 1
      if request.url!.path == "/redirect.svg" {
        return (cachedIcon, imageResponse(URL(string: "http://example.com/logo.svg")!))
      }
      return (Data("<html>Not artwork</html>".utf8), imageResponse(request.url!))
    })
  for url in ["http://example.com/a.svg", "file:///tmp/a.svg", "https://user:secret@example.com/a.svg"] {
    #expect(await cache.image(for: URL(string: url)!) == nil)
  }
  #expect(calls == 0)
  for path in ["bad.svg", "redirect.svg"] {
    let url = URL(string: "https://example.com/" + path)!
    #expect(await cache.image(for: url) == nil)
    #expect(await cache.image(for: url) == nil)
  }
  #expect(calls == 2)
  #expect(!FileManager.default.fileExists(atPath: directory.path))
}

@MainActor @Test func faviconMetadataResolvesOfficialArtworkAndCachesTheResultByOrigin() async throws {
  var requests: [URLRequest] = []
  let cache = SoftwareIconCache(transport: { request in
    requests.append(request)
    switch request.url!.path {
    case "/favicon.ico": return (Data(), imageResponse(request.url!, status: 404))
    case "/":
      return (
        Data(#"<head><link href="/brand.svg" rel="icon"></head>"#.utf8),
        imageResponse(request.url!, type: "text/html")
      )
    default: return (cachedIcon, imageResponse(request.url!))
    }
  })
  let loader = SoftwareIconLoader(cache: cache)
  await loader.load(SoftwareArtwork(website: "https://example.com/docs?token=never-request-this#section"))
  #expect(loader.loaded?.image.isValid == true)
  await loader.load(SoftwareArtwork(website: "https://example.com/another"))
  #expect(requests.map { $0.url!.path } == ["/favicon.ico", "/", "/brand.svg"])
  #expect(
    requests.allSatisfy {
      $0.url?.query == nil && !$0.httpShouldHandleCookies && $0.allHTTPHeaderFields?.isEmpty != false
    })
}

@Test func faviconMetadataIsBoundedAndIgnoresScriptsAndUnsafeCandidates() {
  let html = #"""
    <head>
    <!--
      <link rel="icon" href="/comment.svg">
    -->
    <script>const example = '<link rel="icon" href="/script.svg">';</script>
    <link rel="stylesheet" href="/theme.css">
    <link rel="icon" href="http://example.com/plain.ico">
    <link rel="icon" href="https://user:secret@example.com/private.ico">
    <LINK REL='shortcut icon' HREF='/brand.svg?a=1&amp;b=2'>
    <link rel=apple-touch-icon href=https://cdn.example.com/touch.png>
    <link rel=icon href=/brand.svg?a=1&amp;b=2>
    <link rel=icon href=/third.ico>
    <link rel=icon href=/fourth.ico>
    </head><body><link rel=icon href=/body.ico></body>
    """#
  #expect(
    WebsiteIconMetadata.candidates(in: Data(html.utf8), baseURL: URL(string: "https://example.com/")!).map(
      \.absoluteString) == [
        "https://example.com/brand.svg?a=1&b=2", "https://cdn.example.com/touch.png", "https://example.com/third.ico",
      ])
}

@MainActor @Test func corruptArtworkIsRefetchedAndProfilesStaySeparate() async throws {
  let first = cacheDirectory()
  let second = cacheDirectory()
  defer {
    try? FileManager.default.removeItem(at: first)
    try? FileManager.default.removeItem(at: second)
  }
  let url = URL(string: "https://example.com/logo.svg")!
  var calls = 0
  let transport: SoftwareIconCache.Transport = { request in
    calls += 1
    return (cachedIcon, imageResponse(request.url!))
  }
  #expect(await SoftwareIconCache(directory: first, transport: transport).image(for: url) != nil)
  let files = try FileManager.default.contentsOfDirectory(at: first, includingPropertiesForKeys: nil)
  try Data("broken".utf8).write(to: #require(files.first))
  #expect(await SoftwareIconCache(directory: first, transport: transport).image(for: url) != nil)
  #expect(await SoftwareIconCache(directory: second, transport: transport).image(for: url) != nil)
  #expect(calls == 3)
}

@Test func artworkDiskCachePrunesItsOwnFilesToTheConfiguredLimit() async throws {
  let directory = cacheDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let record = ArtworkDiskCache.Record(data: cachedIcon, fetchedAt: Date())
  let capacity = try JSONEncoder().encode(record).count + 20
  let disk = ArtworkDiskCache(directory: directory, capacity: capacity)
  await disk.write(record, for: URL(string: "https://example.com/a.svg")!)
  await disk.write(record, for: URL(string: "https://example.com/b.svg")!)
  let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey])
  #expect(files.count == 1)
  #expect(try files.reduce(0) { try $0 + ($1.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) } <= capacity)
}

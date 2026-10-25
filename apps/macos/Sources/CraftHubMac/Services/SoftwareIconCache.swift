import AppKit
import CraftHubMacCore
import Foundation

/// Coalesces artwork requests across views, with a seven-day cache and an offline fallback.
@MainActor final class SoftwareIconCache {
  typealias Transport = (URLRequest) async throws -> (Data, URLResponse)
  static let shared = SoftwareIconCache(
    directory: NativeStorage.directory.appendingPathComponent("cache/artwork-v1", isDirectory: true))
  private final class Entry: NSObject {
    let image: NSImage
    let record: ArtworkDiskCache.Record
    init(image: NSImage, record: ArtworkDiskCache.Record) {
      self.image = image
      self.record = record
    }
  }
  private let memory = NSCache<NSURL, Entry>()
  private let disk: ArtworkDiskCache
  private let transport: Transport
  private let now: () -> Date
  private let lifetime: TimeInterval
  private var pending: [URL: Task<NSImage?, Never>] = [:]
  private var retryAfter: [URL: Date] = [:]
  private static let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.urlCredentialStorage = nil
    configuration.urlCache = nil
    configuration.timeoutIntervalForRequest = 8
    configuration.timeoutIntervalForResource = 12
    return URLSession(configuration: configuration, delegate: ArtworkRedirectPolicy(), delegateQueue: nil)
  }()

  init(
    directory: URL? = nil, lifetime: TimeInterval = 7 * 24 * 60 * 60, now: @escaping () -> Date = Date.init,
    transport: @escaping Transport = { try await session.data(for: $0) }
  ) {
    disk = ArtworkDiskCache(directory: directory)
    self.transport = transport
    self.now = now
    self.lifetime = lifetime
    memory.countLimit = 256
    memory.totalCostLimit = 32 * 1024 * 1024
  }

  func image(for url: URL) async -> NSImage? {
    guard !SoftwareArtwork(website: "", iconURL: url.absoluteString).sources.isEmpty else { return nil }
    if let entry = memory.object(forKey: url as NSURL), fresh(entry.record) { return entry.image }
    if let task = pending[url] { return await task.value }
    let task = Task { await resolve(url) }
    pending[url] = task
    let image = await task.value
    pending[url] = nil
    return image
  }

  private func fresh(_ record: ArtworkDiskCache.Record) -> Bool {
    (0..<lifetime).contains(now().timeIntervalSince(record.fetchedAt))
  }

  private func resolve(_ url: URL) async -> NSImage? {
    var cached = memory.object(forKey: url as NSURL)
    if cached == nil, let record = await disk.read(url), let image = Self.decode(record.data) {
      let entry = Entry(image: image, record: record)
      cached = entry
      memory.setObject(entry, forKey: url as NSURL, cost: record.data.count)
    }
    if let cached, fresh(cached.record) { return cached.image }
    if let retry = retryAfter[url], retry > now() { return cached?.image }
    if let data = await artworkData(for: url), let image = Self.decode(data) {
      let record = ArtworkDiskCache.Record(data: data, fetchedAt: now())
      memory.setObject(Entry(image: image, record: record), forKey: url as NSURL, cost: data.count)
      await disk.write(record, for: url)
      retryAfter[url] = nil
      return image
    }
    retryAfter = retryAfter.filter { $0.value > now() }
    if retryAfter.count >= 256 { retryAfter.removeAll() }
    retryAfter[url] = now().addingTimeInterval(10 * 60)
    return cached?.image
  }

  private func artworkData(for url: URL) async -> Data? {
    guard let (data, initial) = await fetch(url) else { return nil }
    if (200..<300).contains(initial.statusCode), Self.decode(data) != nil { return data }
    guard initial.statusCode == 404 || (200..<300).contains(initial.statusCode) else { return nil }
    guard url.path == "/favicon.ico", var origin = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
      return nil
    }
    origin.path = "/"
    origin.query = nil
    origin.fragment = nil
    guard let home = origin.url, let (html, response) = await fetch(home),
      (200..<300).contains(response.statusCode),
      response.mimeType?.lowercased() == "text/html", let base = response.url
    else { return nil }
    for candidate in WebsiteIconMetadata.candidates(in: html, baseURL: base) where candidate != url {
      if let (data, response) = await fetch(candidate), (200..<300).contains(response.statusCode),
        Self.decode(data) != nil
      {
        return data
      }
    }
    return nil
  }

  private func fetch(_ url: URL) async -> (Data, HTTPURLResponse)? {
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
    request.httpShouldHandleCookies = false
    guard let (data, response) = try? await transport(request), data.count <= 8 * 1024 * 1024,
      let response = response as? HTTPURLResponse,
      let destination = response.url,
      !SoftwareArtwork(website: "", iconURL: destination.absoluteString).sources.isEmpty
    else { return nil }
    return (data, response)
  }

  private static func decode(_ data: Data) -> NSImage? {
    guard data.count <= 8 * 1024 * 1024, let image = NSImage(data: data), image.isValid else { return nil }
    return image
  }
}

/// Remote artwork cannot carry credentials or downgrade to unencrypted HTTP through a redirect.
private final class ArtworkRedirectPolicy: NSObject, URLSessionTaskDelegate {
  func urlSession(
    _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
  ) {
    guard let url = request.url, !SoftwareArtwork(website: "", iconURL: url.absoluteString).sources.isEmpty else {
      completionHandler(nil)
      return
    }
    var clean = request
    clean.httpShouldHandleCookies = false
    clean.setValue(nil, forHTTPHeaderField: "Cookie")
    clean.setValue(nil, forHTTPHeaderField: "Authorization")
    clean.setValue(nil, forHTTPHeaderField: "Referer")
    completionHandler(clean)
  }
}

import Foundation

/// Public runtime invalidations, not host-menu commands. Unknown future event names are ignored.
public enum RuntimeChange: String, CaseIterable, Sendable {
  case projects = "project-change"
  case projectCatalog = "project-catalog-change"
  case runs = "run-change"
  case agentTasks = "agent-task-change"
  case settings = "settings-change"
  case plugins = "plugin-change"
  case integrations = "integration-change"
  case userConfig = "user-config-change"
  case configurationSync = "configuration-sync"
  case softwareSources = "software-source-change"
  case pluginUpdate = "plugin-update"
}

/// A connection has no replay cursor: every successful connection requires a fresh snapshot.
public enum RuntimeStreamEvent: Equatable, Sendable {
  case connected
  case changed(RuntimeChange)
  case disconnected
}

/// One authenticated SSE subscription, with bounded reconnect delay and cancellation of the underlying socket.
public struct RuntimeEventStream {
  public typealias Handler = @Sendable (RuntimeStreamEvent) async -> Void
  public typealias Attempt = @Sendable (URLRequest, @escaping Handler) async throws -> Void
  private let connection: RuntimeConnection
  private let attempt: Attempt
  private let wait: @Sendable (TimeInterval) async throws -> Void
  private let clock: @Sendable () -> TimeInterval

  public init(connection: RuntimeConnection) {
    self.init(connection: connection, attempt: { try await Self.receive($0, handler: $1) })
  }

  /// Injection keeps reconnect/cancellation tests deterministic without making requests to a user's sidecar.
  init(
    connection: RuntimeConnection, attempt: @escaping Attempt,
    wait: @escaping @Sendable (TimeInterval) async throws -> Void = { try await Task.sleep(for: .seconds($0)) },
    clock: @escaping @Sendable () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }
  ) {
    self.connection = connection
    self.attempt = attempt
    self.wait = wait
    self.clock = clock
  }

  /// Runs until cancellation. The handler receives only event kinds, never credentials or server payloads.
  public func observe(_ handler: @escaping Handler) async {
    guard var request = try? connection.request(path: "/api/events") else { return }
    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    request.timeoutInterval = 60
    var delay: TimeInterval = 1
    while !Task.isCancelled {
      let began = clock()
      do {
        try await attempt(request, handler)
      } catch is CancellationError {
        return
      } catch {
        // The UI reports reconnection, not an error containing a URL or a raw server response.
      }
      guard !Task.isCancelled else { return }
      await handler(.disconnected)
      if clock() - began >= 30 { delay = 1 }
      do { try await wait(delay) } catch { return }
      delay = min(delay * 2, 30)
    }
  }

  private static func receive(_ request: URLRequest, handler: @escaping Handler) async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.urlCache = nil
    configuration.timeoutIntervalForResource = 24 * 60 * 60
    let session = URLSession(configuration: configuration, delegate: RuntimeNoRedirects(), delegateQueue: nil)
    defer { session.invalidateAndCancel() }
    try await withTaskCancellationHandler {
      try Task.checkCancellation()
      let (bytes, response) = try await session.bytes(for: request)
      defer { bytes.task.cancel() }
      try validate(response, for: request)
      try Task.checkCancellation()
      await handler(.connected)
      var decoder = RuntimeEventDecoder()
      for try await byte in bytes {
        try Task.checkCancellation()
        if let change = try decoder.append(byte) { await handler(.changed(change)) }
      }
      // A partial event at EOF is deliberately discarded; reconnect requests a complete snapshot.
    } onCancel: {
      session.invalidateAndCancel()
    }
  }

  static func validate(_ response: URLResponse, for request: URLRequest) throws {
    guard let response = response as? HTTPURLResponse, response.url == request.url,
      response.statusCode == 200, response.mimeType?.lowercased() == "text/event-stream"
    else { throw RuntimeAPIError.invalidResponse }
  }
}

/// Incremental UTF-8 SSE framing: CR, LF, CRLF, BOM, comments and multiline data; bounded before allocation grows.
struct RuntimeEventDecoder {
  private var line = Data()
  private var name = ""
  private var payload = Data()
  private var skipLF = false
  private var firstLine = true
  private let maximumLine: Int
  private let maximumEvent: Int

  init(maximumLine: Int = 64 * 1024, maximumEvent: Int = 256 * 1024) {
    self.maximumLine = maximumLine
    self.maximumEvent = maximumEvent
  }

  mutating func append(_ byte: UInt8) throws -> RuntimeChange? {
    if skipLF {
      skipLF = false
      if byte == 0x0a { return nil }
    }
    if byte == 0x0a || byte == 0x0d {
      skipLF = byte == 0x0d
      defer { line.removeAll(keepingCapacity: true) }
      return try consumeLine()
    }
    guard line.count < maximumLine else { throw RuntimeAPIError.invalidResponse }
    line.append(byte)
    return nil
  }

  private mutating func consumeLine() throws -> RuntimeChange? {
    if firstLine {
      firstLine = false
      if line.starts(with: [0xef, 0xbb, 0xbf]) { line.removeFirst(3) }
    }
    if line.isEmpty {
      defer {
        name = ""
        payload.removeAll(keepingCapacity: true)
      }
      guard !payload.isEmpty, let change = RuntimeChange(rawValue: name) else { return nil }
      guard (try? JSONSerialization.jsonObject(with: payload)) is [String: Any] else {
        throw RuntimeAPIError.invalidResponse
      }
      return change
    }
    guard let text = String(data: line, encoding: .utf8) else { throw RuntimeAPIError.invalidResponse }
    if text.hasPrefix(":") { return nil }
    let parts = text.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
    var value = parts.count > 1 ? String(parts[1]) : ""
    if value.hasPrefix(" ") { value.removeFirst() }
    if parts[0] == "event" { name = value }
    if parts[0] == "data" {
      guard payload.count + value.utf8.count + 1 <= maximumEvent else { throw RuntimeAPIError.invalidResponse }
      payload.append(contentsOf: value.utf8)
      payload.append(0x0a)
    }
    return nil
  }
}

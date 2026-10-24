import Foundation
import Network
import Testing

@testable import CraftHubMacCore

/// A loopback-only HTTP fixture exercises URLSession's real streaming, redirect and socket cancellation behavior.
private final class EventHTTPFixture: @unchecked Sendable {
  private let queue = DispatchQueue(label: "craft-hub-event-test")
  private let listener: NWListener
  private var connections: [NWConnection] = []
  private var received: [String] = []
  private var ended = 0
  private var started = false
  private let redirect: Bool
  private let jsonBody: String?

  init(redirect: Bool = false, jsonBody: String? = nil) throws {
    self.redirect = redirect
    self.jsonBody = jsonBody
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
    listener = try NWListener(using: parameters)
  }

  func start() async throws -> RuntimeConnection {
    let port: UInt16 = try await withCheckedThrowingContinuation { continuation in
      listener.stateUpdateHandler = { [self] state in
        guard !started else { return }
        if case .ready = state {
          started = true
          continuation.resume(returning: listener.port!.rawValue)
        } else if case .failed(let error) = state {
          started = true
          continuation.resume(throwing: error)
        }
      }
      listener.newConnectionHandler = { [weak self] connection in
        guard let self else { return }
        connections.append(connection)
        connection.start(queue: queue)
        read(connection, buffer: Data())
      }
      listener.start(queue: queue)
    }
    let secret = String(repeating: "b", count: 64)
    return try RuntimeConnection(
      handshake: JSONSerialization.data(withJSONObject: [
        "version": 1, "url": "http://127.0.0.1:\(port)/__craft_hub_host/bootstrap?token=\(secret)",
        "nativeApiToken": secret,
      ]))
  }

  private func read(_ connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, complete, error in
      guard let self else { return }
      var buffer = buffer
      if let data { buffer.append(data) }
      if let end = buffer.range(of: Data("\r\n\r\n".utf8)) {
        received.append(String(decoding: buffer[..<end.upperBound], as: UTF8.self))
        buffer.removeSubrange(..<end.upperBound)
        let response =
          jsonBody.map {
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \($0.utf8.count)\r\nConnection: close\r\n\r\n\($0)"
          }
          ?? (redirect
            ? "HTTP/1.1 302 Found\r\nLocation: /unexpected\r\nContent-Length: 0\r\n\r\n"
            : "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nConnection: close\r\n\r\n: keep-alive\n\nevent: project-change\ndata: {\"path\":\"fixture\"}\n\n")
        connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in })
      }
      if complete || error != nil || buffer.count > 16384 {
        ended += 1
        connection.cancel()
      } else {
        read(connection, buffer: buffer)
      }
    }
  }

  var requests: [String] { queue.sync { received } }
  var closed: Int { queue.sync { ended } }
  func stop() {
    queue.sync {
      listener.cancel()
      for connection in connections { connection.cancel() }
      connections.removeAll()
      listener.stateUpdateHandler = nil
      listener.newConnectionHandler = nil
    }
  }
}

@Test func nativeHTTPPreservesRouterIdentifiersWhileEscapingPathSeparators() async throws {
  let server = try EventHTTPFixture(
    jsonBody: #"{"version":1,"kind":"unsupported","softwareId":"editor","destination":"application"}"#)
  defer { server.stop() }
  let client = RuntimeAPIClient(connection: try await server.start())
  _ = try await client.integrationPresentation(
    integration: "fixture-plugin.v1", action: "read_items-v2", project: "project-123")
  try await client.openApplication(sourceID: "shared-source", softwareID: "editor")
  #expect(
    server.requests.contains {
      $0.hasPrefix(
        "POST /api/projects/project-123/integrations/fixture-plugin.v1/actions/read_items-v2?presentation=workbench-v1 HTTP/"
      )
    })
  #expect(
    server.requests.contains {
      $0.hasPrefix("POST /api/software/shared-source/open HTTP/")
    })
  #expect(try RuntimeAPIClient.configurationSegment("provider-v1.read") == "provider-v1.read")
  #expect(try RuntimeAPIClient.segment("part/other?query#fragment") == "part%2Fother%3Fquery%23fragment")
  #expect(throws: (any Error).self) { try RuntimeAPIClient.segment("..") }
}

private actor SocketEvents {
  var values: [RuntimeStreamEvent] = []
  func append(_ value: RuntimeStreamEvent) { values.append(value) }
}

@Test func nativeEventSocketAuthenticatesStreamsAndClosesOnCancellation() async throws {
  let server = try EventHTTPFixture()
  defer { server.stop() }
  let stream = RuntimeEventStream(connection: try await server.start())
  let events = SocketEvents()
  let task = Task { await stream.observe { await events.append($0) } }
  defer { task.cancel() }
  for _ in 0..<300 {
    if await events.values.contains(.changed(.projects)) { break }
    try await Task.sleep(for: .milliseconds(10))
  }
  #expect(await events.values == [.connected, .changed(.projects)])
  let request = try #require(server.requests.first).lowercased()
  #expect(request.hasPrefix("get /api/events http/1.1"))
  #expect(request.contains("authorization: bearer \(String(repeating: "b", count: 64))"))
  #expect(request.contains("accept: text/event-stream"))
  #expect(!request.contains("cookie:"))
  task.cancel()
  await task.value
  for _ in 0..<100 {
    if server.closed == 1 { break }
    try await Task.sleep(for: .milliseconds(10))
  }
  #expect(server.closed == 1)
  #expect(server.requests.count == 1)
}

@Test func nativeEventSocketNeverFollowsEvenSameOriginRedirects() async throws {
  let server = try EventHTTPFixture(redirect: true)
  defer { server.stop() }
  let stream = RuntimeEventStream(connection: try await server.start())
  let events = SocketEvents()
  let task = Task { await stream.observe { await events.append($0) } }
  defer { task.cancel() }
  for _ in 0..<100 {
    if await events.values.contains(.disconnected) { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  task.cancel()
  await task.value
  #expect(await events.values == [.disconnected])
  #expect(server.requests.count == 1)
  #expect(!server.requests.contains { $0.contains("/unexpected") })
}

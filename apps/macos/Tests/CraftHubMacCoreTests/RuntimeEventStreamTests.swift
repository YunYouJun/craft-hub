import Foundation
import Testing

@testable import CraftHubMacCore

private func eventConnection() throws -> RuntimeConnection {
  try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1,
      "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(String(repeating: "a", count: 64))",
      "nativeApiToken": String(repeating: "b", count: 64),
    ]))
}

@Test func eventDecoderHandlesFragmentedUTF8AndAllSSELineEndings() throws {
  for separator in ["\n", "\r", "\r\n"] {
    let input = [
      "\u{feff}: keep-alive", "retry: 1000", "", "event: project-change", "data: {", "data: \"name\":\"项目\"}", "",
      "event: future-event", "data: ignored", "", "event: software-source-change", "data:{}", "",
      "event: settings-change", "data:{}",  // No blank line: incomplete event must not dispatch.
    ].joined(separator: separator)
    var decoder = RuntimeEventDecoder()
    var changes: [RuntimeChange] = []
    for byte in input.utf8 { if let change = try decoder.append(byte) { changes.append(change) } }
    #expect(changes == [.projects, .softwareSources])
  }
}

@Test func eventDecoderBoundsLinesAndFramesAndRejectsMalformedKnownEvents() throws {
  for input in [
    "event: project-change\ndata: [1]\n\n", "event: settings-change\ndata: not-json\n\n",
    String(repeating: "x", count: 65),
    "event: project-change\n" + String(repeating: "data: " + String(repeating: "x", count: 40) + "\n", count: 4),
  ] {
    var decoder = RuntimeEventDecoder(maximumLine: 64, maximumEvent: 128)
    #expect(throws: (any Error).self) {
      for byte in input.utf8 { _ = try decoder.append(byte) }
    }
  }
  var decoder = RuntimeEventDecoder()
  #expect(throws: (any Error).self) {
    for byte: UInt8 in [0xff, 0x0a] { _ = try decoder.append(byte) }
  }
}

@Test func eventStreamAcceptsOnlyTheExactAuthenticatedEndpointAndEventMIMEType() throws {
  let request = try eventConnection().request(path: "/api/events")
  for (url, code, mime, accepted) in [
    (request.url!, 200, "text/event-stream; charset=utf-8", true),
    (request.url!, 401, "text/event-stream", false),
    (request.url!, 302, "text/event-stream", false),
    (request.url!, 200, "application/json", false),
    (URL(string: "http://127.0.0.1:49218/elsewhere")!, 200, "text/event-stream", false),
  ] {
    let response = HTTPURLResponse(url: url, statusCode: code, httpVersion: nil, headerFields: ["Content-Type": mime])!
    if accepted {
      try RuntimeEventStream.validate(response, for: request)
    } else {
      #expect(throws: (any Error).self) { try RuntimeEventStream.validate(response, for: request) }
    }
  }
}

private actor EventLog {
  var requests: [URLRequest] = []
  var events: [RuntimeStreamEvent] = []
  var delays: [TimeInterval] = []
  func request(_ request: URLRequest) { requests.append(request) }
  func event(_ event: RuntimeStreamEvent) { events.append(event) }
  func wait(_ delay: TimeInterval) throws {
    delays.append(delay)
    if delays.count == 7 { throw CancellationError() }
  }
}

@Test func eventReconnectsWithTheSameAPIAuthAndBoundsBackoff() async throws {
  let log = EventLog()
  let stream = RuntimeEventStream(
    connection: try eventConnection(),
    attempt: { request, handler in
      await log.request(request)
      await handler(.connected)
      await handler(.changed(.projects))
      throw URLError(.networkConnectionLost)
    }, wait: { try await log.wait($0) }, clock: { 0 })
  await stream.observe { await log.event($0) }
  #expect(await log.delays == [1, 2, 4, 8, 16, 30, 30])
  #expect(await log.events.filter { $0 == .connected }.count == 7)
  #expect(await log.events.filter { $0 == .disconnected }.count == 7)
  for request in await log.requests {
    #expect(request.url?.path == "/api/events")
    #expect(request.url?.query == nil)
    #expect(request.value(forHTTPHeaderField: "Accept") == "text/event-stream")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(String(repeating: "b", count: 64))")
    #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
  }
}

@Test func cancellationDoesNotReconnectOrEmitAFailureAfterStopping() async throws {
  let log = EventLog()
  let stream = RuntimeEventStream(
    connection: try eventConnection(),
    attempt: { request, handler in
      await log.request(request)
      await handler(.connected)
      try await Task.sleep(for: .seconds(30))
    })
  let task = Task { await stream.observe { await log.event($0) } }
  for _ in 0..<100 {
    if await log.events.contains(.connected) { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  #expect(await log.events == [.connected])
  task.cancel()
  await task.value
  #expect(await log.requests.count == 1)
  #expect(await log.events == [.connected])
}

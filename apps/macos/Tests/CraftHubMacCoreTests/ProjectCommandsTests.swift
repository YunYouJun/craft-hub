import Foundation
import Network
import Testing

@testable import CraftHubMacCore

private func commandContractConnection() throws -> RuntimeConnection {
  let secret = String(repeating: "a", count: 64)
  return try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)",
      "nativeApiToken": secret,
    ]))
}

private func contractRun(_ status: String = "running", stdout: String = "", id: String = "run-one") -> [String: Any] {
  [
    "id": id, "projectId": "fixture", "capabilityId": "build", "command": "fixture",
    "args": ["--name", "value"], "cwd": "/fixture", "startedAt": "2026-10-29T00:00:00Z",
    "stdout": stdout, "stderr": "", "status": status,
  ]
}

private func contractLine(_ value: [String: Any]) throws -> Data {
  var data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  data.append(0x0a)
  return data
}

@Test func nativeCommandStreamFramesUnicodeAndPreservesArrivalOrderUntilConfirmedCompletion() throws {
  var decoder = ProjectCommandStreamDecoder(projectID: "fixture", capabilityID: "build")
  let events: [[String: Any]] = [
    ["type": "start", "run": contractRun()],
    ["type": "output", "stream": "stdout", "chunk": "你好\r\n"],
    ["type": "output", "stream": "stderr", "chunk": "warning\n"],
    ["type": "output", "stream": "stdout", "chunk": "done"],
    ["type": "complete", "run": contractRun("completed", stdout: "你好\r\ndone")],
  ]
  var chunks: [String] = []
  var states: [String] = []
  for event in events {
    for byte in try contractLine(event) {
      if let update = try decoder.append(byte) {
        if let chunk = update.appendedOutput { chunks.append(chunk) }
        states.append(update.run.status)
      }
    }
  }
  #expect(chunks == ["你好\r\n", "warning\n", "done"])
  #expect(states == ["running", "running", "running", "running", "completed"])
  #expect(try decoder.finish() == nil)
  #expect(decoder.completed?.status == "completed")
}

@Test func nativeCommandStreamRejectsEarlyEOFOutputBeforeStartChangedIDsAndOversizeLines() throws {
  var incomplete = ProjectCommandStreamDecoder(projectID: "fixture", capabilityID: "build")
  for byte in try contractLine(["type": "start", "run": contractRun()]) { _ = try incomplete.append(byte) }
  #expect(throws: RuntimeAPIError.self) { try incomplete.finish() }
  let invalid: [[[String: Any]]] = [
    [["type": "output", "stream": "stdout", "chunk": "orphan"]],
    [
      ["type": "start", "run": contractRun()], ["type": "complete", "run": contractRun("completed", id: "different")],
    ],
    [["type": "start", "run": contractRun()], ["type": "complete", "run": contractRun()]],
  ]
  for events in invalid {
    var decoder = ProjectCommandStreamDecoder(projectID: "fixture", capabilityID: "build")
    #expect(throws: (any Error).self) {
      for event in events {
        for byte in try contractLine(event) { _ = try decoder.append(byte) }
      }
    }
  }
  var bounded = ProjectCommandStreamDecoder(projectID: "fixture", capabilityID: "build", maximumLine: 3)
  #expect(throws: RuntimeAPIError.self) {
    for byte in "1234".utf8 { _ = try bounded.append(byte) }
  }
}

private actor CommandContractRequests {
  var requests: [URLRequest] = []
  func receive(_ request: URLRequest) throws -> (Data, URLResponse) {
    requests.append(request)
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(String(repeating: "a", count: 64))")
    #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
    let response: Any
    if request.url!.path.hasSuffix("/command-review") {
      response =
        [
          "reviewId": "review-one",
          "project": ["id": "fixture", "name": "Fixture", "path": "/fixture", "trust": "untrusted"],
          "capability": [
            "id": "build", "kind": "command", "name": "Build", "source": "fixture",
            "invocation": ["command": "fixture", "args": [], "cwd": "/fixture", "requiredEnv": []],
            "inputs": [["id": "name", "type": "text", "private": true, "default": "value"]],
          ],
          "invocation": ["command": "fixture", "args": ["--name", "value"], "cwd": "/fixture", "requiredEnv": []],
          "expiresAt": "2026-10-29T00:05:00.000Z",
        ] as [String: Any]
    } else if request.url!.path.hasSuffix("/run") {
      var data = try contractLine(["type": "start", "run": contractRun()])
      data.append(try contractLine(["type": "complete", "run": contractRun("completed")]))
      return (
        data,
        HTTPURLResponse(
          url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/x-ndjson"])!
      )
    } else if request.url!.path.hasSuffix("/trust") {
      response = ["id": "fixture", "name": "Fixture", "path": "/fixture", "trust": "trusted"]
    } else if request.url!.path.hasSuffix("/input") || request.url!.path.hasSuffix("/resize") {
      response = ["accepted": true]
    } else {
      response = ["cancelled": true]
    }
    return (
      try JSONSerialization.data(withJSONObject: response),
      HTTPURLResponse(
        url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
    )
  }
}

@Test func nativeCommandReviewTrustAndExecutionUseTheSameOpaqueRuntimeReviewAndStructuredInputs() async throws {
  let fixture = CommandContractRequests()
  let client = RuntimeAPIClient(
    connection: try commandContractConnection(), transport: { try await fixture.receive($0) })
  let review = try await client.reviewProjectCommand(
    projectID: "fixture", capabilityID: "build", inputs: ["name": "value"])
  #expect(review.requiresTrust)
  #expect(review.capability.inputs?.first?.privateValue == true)
  #expect(review.capability.inputs?.first?.defaultValue == "value")
  let project = try await client.trustProjectCommand(projectID: "fixture", reviewID: review.reviewId)
  #expect(project.trust == "trusted")
  let result = try await client.runProjectCommand(
    projectID: "fixture", capabilityID: "build", inputs: ["name": "value"], reviewID: review.reviewId, update: { _ in })
  #expect(result.status == "completed")
  try await client.cancelProjectCommandReview(projectID: "fixture", reviewID: review.reviewId)
  try await client.writeProjectCommandRun("run-one", data: "yes\r")
  try await client.resizeProjectCommandRun("run-one", columns: 120, rows: 30)
  let requests = await fixture.requests
  #expect(requests.map { $0.httpMethod ?? "GET" } == ["POST", "POST", "POST", "DELETE", "POST", "POST"])
  let body = try JSONSerialization.jsonObject(with: requests[2].httpBody!) as! [String: Any]
  #expect(body["reviewId"] as? String == "review-one")
  #expect(body["inputs"] as? [String: String] == ["name": "value"])
  #expect(requests[3].url!.path == "/api/projects/fixture/command-review/review-one")
}

@Test func nativeCommandConditionsFollowDefaultsAndConjunctionsWithoutEvaluatingCode() throws {
  let data = Data(
    """
    {"id":"version","type":"text","requiredWhen":{"input":"mode","equals":"custom"},
     "visibleWhen":[{"input":"mode","equals":"custom"},{"input":"enabled","equals":"true"}]}
    """.utf8)
  let input = try JSONDecoder().decode(ProjectCommandInput.self, from: data)
  #expect(input.isRequired(["mode": "custom"]))
  #expect(!input.isVisible(["mode": "custom"]))
  #expect(input.isVisible(["mode": "custom", "enabled": "true"]))
}

@Test func nativeCommandInputEncodesProtocolBytesAsBase64AndKeepsTheLegacyTextContract() async throws {
  let fixture = CommandContractRequests()
  let client = RuntimeAPIClient(
    connection: try commandContractConnection(), transport: { try await fixture.receive($0) })
  let bytes = Data([0x1b, 0x5b, 0x4d, 0xff, 0x00, 0x80])
  try await client.writeProjectCommandRun("run-one", bytes: bytes)
  try await client.writeProjectCommandRun("run-one", data: "你好\r")
  let requests = await fixture.requests
  let binary = try JSONSerialization.jsonObject(with: requests[0].httpBody!) as! [String: String]
  let text = try JSONSerialization.jsonObject(with: requests[1].httpBody!) as! [String: String]
  #expect(binary == ["dataBase64": bytes.base64EncodedString()])
  #expect(text == ["data": "你好\r"])
  await #expect(throws: RuntimeAPIError.self) {
    try await client.writeProjectCommandRun("run-one", bytes: Data(repeating: 0x61, count: 65537))
  }
  #expect(await fixture.requests.count == 2)
}

/// Keeps a real HTTP response open after start/output so cancellation must close the socket rather than await EOF.
private final class CommandHTTPFixture: @unchecked Sendable {
  private let queue = DispatchQueue(label: "craft-hub-command-stream-test")
  private let listener: NWListener
  private var connections: [NWConnection] = []
  private var received: [String] = []
  private var ended = 0
  private var started = false
  private let redirect: Bool
  private let acknowledgesStart: Bool
  init(redirect: Bool = false, acknowledgesStart: Bool = true) throws {
    self.redirect = redirect
    self.acknowledgesStart = acknowledgesStart
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
    let secret = String(repeating: "a", count: 64)
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
        var response = Data(
          (redirect
            ? "HTTP/1.1 302 Found\r\nLocation: /unexpected\r\nContent-Length: 0\r\n\r\n"
            : "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson; charset=utf-8\r\nConnection: close\r\n\r\n").utf8)
        if !redirect && acknowledgesStart {
          response.append(try! contractLine(["type": "start", "run": contractRun()]))
          response.append(try! contractLine(["type": "output", "stream": "stdout", "chunk": "你好\r\n"]))
        }
        connection.send(content: response, completion: .contentProcessed { _ in })
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

private actor CommandSocketUpdates {
  var values: [ProjectCommandUpdate] = []
  func append(_ value: ProjectCommandUpdate) { values.append(value) }
}

@Test func nativeCommandHTTPSocketStreamsBeforeEOFAndCancellationClosesItsOwnSocket() async throws {
  let server = try CommandHTTPFixture()
  defer { server.stop() }
  let client = RuntimeAPIClient(connection: try await server.start())
  let updates = CommandSocketUpdates()
  let task = Task {
    try await client.runProjectCommand(
      projectID: "fixture", capabilityID: "build", inputs: [:], reviewID: "review-one", startupTimeout: 0.2,
      update: { await updates.append($0) })
  }
  defer { task.cancel() }
  for _ in 0..<300 {
    if await updates.values.count >= 2 { break }
    try await Task.sleep(for: .milliseconds(10))
  }
  #expect(await updates.values.count == 2)
  #expect(await updates.values.last?.appendedOutput == "你好\r\n")
  let request = try #require(server.requests.first).lowercased()
  #expect(request.hasPrefix("post /api/projects/fixture/run http/1.1"))
  #expect(request.contains("authorization: bearer \(String(repeating: "a", count: 64))"))
  #expect(request.contains("accept: application/x-ndjson") && !request.contains("cookie:"))
  // Receipt of start removes the short deadline; a silent command stays connected.
  try await Task.sleep(for: .milliseconds(350))
  #expect(server.closed == 0)
  task.cancel()
  await #expect(throws: (any Error).self) { try await task.value }
  for _ in 0..<100 {
    if server.closed == 1 { break }
    try await Task.sleep(for: .milliseconds(10))
  }
  #expect(server.closed == 1 && server.requests.count == 1)
}

@Test func nativeCommandHTTPSocketBoundsMissingStartAcknowledgementWithoutWaitingForTheResourceTimeout() async throws {
  let server = try CommandHTTPFixture(acknowledgesStart: false)
  defer { server.stop() }
  let client = RuntimeAPIClient(connection: try await server.start())
  await #expect(throws: (any Error).self) {
    try await client.runProjectCommand(
      projectID: "fixture", capabilityID: "build", inputs: [:], reviewID: "review-one", startupTimeout: 0.05,
      update: { _ in Issue.record("A missing start response must not synthesize an update") })
  }
  for _ in 0..<100 {
    if server.closed == 1 { break }
    try await Task.sleep(for: .milliseconds(10))
  }
  #expect(server.closed == 1 && server.requests.count == 1)
}

@Test func nativeCommandHTTPSocketNeverForwardsItsCredentialAcrossARedirect() async throws {
  let server = try CommandHTTPFixture(redirect: true)
  defer { server.stop() }
  let client = RuntimeAPIClient(connection: try await server.start())
  await #expect(throws: RuntimeAPIError.self) {
    try await client.runProjectCommand(
      projectID: "fixture", capabilityID: "build", inputs: [:], reviewID: "review-one", update: { _ in })
  }
  #expect(server.requests.count == 1 && !server.requests.contains(where: { $0.contains("/unexpected") }))
}

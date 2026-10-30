import Foundation

/// A structured invocation. Native clients never concatenate these values into a shell command.
public struct ProjectCommandInvocation: Codable, Equatable, Sendable {
  public let command: String
  public let args: [String]
  public let cwd: String
  public let requiredEnv: [String]
  public let prerequisites: [ProjectCommandInvocation]?
  public let label: String?
  public let when: ProjectCommandConditions?
}

/// Conditions are supplied by the project; execution input validation remains owned by the runtime.
public enum ProjectCommandConditions: Codable, Equatable, Sendable {
  public struct Condition: Codable, Equatable, Sendable {
    public let input: String
    public let equals: String
  }
  case one(Condition)
  case all([Condition])

  public init(from decoder: Decoder) throws {
    let value = try decoder.singleValueContainer()
    if let conditions = try? value.decode([Condition].self) {
      self = .all(conditions)
    } else {
      self = .one(try value.decode(Condition.self))
    }
  }
  public func encode(to encoder: Encoder) throws {
    var value = encoder.singleValueContainer()
    switch self {
    case .one(let condition): try value.encode(condition)
    case .all(let conditions): try value.encode(conditions)
    }
  }
  public func matches(_ values: [String: String]) -> Bool {
    switch self {
    case .one(let condition): values[condition.input] == condition.equals
    case .all(let conditions): conditions.allSatisfy { values[$0.input] == $0.equals }
    }
  }
}

/// Form metadata is rendered by the host; only the runtime resolves it to argv.
public struct ProjectCommandInput: Codable, Equatable, Identifiable, Sendable {
  public struct Option: Codable, Equatable, Sendable {
    public let value: String
    public let label: String?
    public let icon: String?
    public let omitArgument: Bool?
    public let arguments: [String]?
  }
  public let id: String
  public let type: String
  public let label: String?
  public let description: String?
  public let options: [Option]?
  public let defaultValue: String?
  public let required: Bool?
  public let requiredWhen: ProjectCommandConditions?
  public let visibleWhen: ProjectCommandConditions?
  public let pattern: String?
  public let flag: String?
  public let omitArgument: Bool?
  public let argumentStyle: String?
  public let privateValue: Bool?
  public let redactInHistory: Bool?
  private enum CodingKeys: String, CodingKey {
    case id, type, label, description, options, required, requiredWhen, visibleWhen, pattern, flag
    case omitArgument, argumentStyle, redactInHistory
    case defaultValue = "default"
    case privateValue = "private"
  }
  public func isVisible(_ values: [String: String]) -> Bool { visibleWhen?.matches(values) ?? true }
  public func isRequired(_ values: [String: String]) -> Bool {
    required == true || requiredWhen?.matches(values) == true
  }
}

/// The complete reviewed command declaration, including the release marker and input privacy metadata.
public struct ProjectCommand: Codable, Equatable, Identifiable, Sendable {
  public struct Availability: Codable, Equatable, Sendable {
    public let available: Bool
    public let diagnostic: String?
  }
  public struct Operation: Codable, Equatable, Sendable {
    public let kind: String
    public let requiresCleanGit: Bool?
    public let requiredBranch: String?
    public let workflowPath: String?
    public let versionInput: String?
    public let customVersionInput: String?
    public let prereleaseIdInput: String?
  }
  public let id: String
  public let kind: String
  public let name: String
  public let source: String
  public let description: String?
  public let script: String?
  public let sourcePath: String?
  public let sourceLine: Int?
  public let invocation: ProjectCommandInvocation
  public let inputs: [ProjectCommandInput]?
  public let inputArgSeparator: String?
  public let availability: Availability?
  public let operation: Operation?
  public var requiresWebReleaseReview: Bool { operation?.kind == "release" }
}

/// A runtime-owned, expiring, one-use review. The opaque ID is never persisted in preferences or logs.
public struct ProjectCommandReview: Decodable, Identifiable, Sendable {
  public let reviewId: String
  public let project: PaletteProject
  public let capability: ProjectCommand
  public let invocation: ProjectCommandInvocation
  public let expiresAt: String
  public var id: String { reviewId }
  public var requiresTrust: Bool { project.trust != "trusted" }
}

/// Persisted runtime execution state. Output from history has no inter-stream ordering information.
public struct ProjectCommandRun: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let projectId: String
  public let capabilityId: String
  public let capabilitySource: String?
  public let command: String
  public let args: [String]
  public let cwd: String
  public let startedAt: String
  public let finishedAt: String?
  public let exitCode: Int?
  public let signal: String?
  public var stdout: String
  public var stderr: String
  public let pinned: Bool?
  public var truncated: Bool?
  public let status: String
  public var isRunning: Bool { status == "running" }
}

/// One NDJSON update carries the current bounded record and the new chunk in arrival order.
public struct ProjectCommandUpdate: Sendable {
  public let run: ProjectCommandRun
  public let appendedOutput: String?
  public let completed: Bool
}

extension RuntimeAPIClient {
  public func previewProjectCommand(projectID: String, capabilityID: String, inputs: [String: String]) async throws
    -> ProjectCommandInvocation
  {
    let path = try Self.segment(projectID)
    let body = try JSONEncoder().encode(CommandRequest(capabilityId: capabilityID, inputs: inputs, reviewId: nil))
    return try await fetch(path: "/api/projects/\(path)/preview-command", body: body)
  }

  /// Creating a review resolves inputs without granting trust or executing the command.
  public func reviewProjectCommand(projectID: String, capabilityID: String, inputs: [String: String]) async throws
    -> ProjectCommandReview
  {
    let path = try Self.segment(projectID)
    let body = try JSONEncoder().encode(CommandRequest(capabilityId: capabilityID, inputs: inputs, reviewId: nil))
    let value: ProjectCommandReview = try await fetch(path: "/api/projects/\(path)/command-review", body: body)
    guard value.project.id == projectID, value.capability.id == capabilityID, value.capability.kind == "command",
      !value.reviewId.isEmpty, !value.capability.requiresWebReleaseReview,
      ISO8601DateFormatter().date(from: value.expiresAt) != nil
        || ISO8601DateFormatter.fractional.date(from: value.expiresAt) != nil
    else { throw RuntimeAPIError.invalidResponse }
    return value
  }

  public func cancelProjectCommandReview(projectID: String, reviewID: String) async throws {
    struct Acknowledgement: Decodable {}
    let project = try Self.segment(projectID)
    let review = try Self.segment(reviewID)
    let _: Acknowledgement = try await fetch(
      path: "/api/projects/\(project)/command-review/\(review)", body: Data("{}".utf8), method: "DELETE")
  }

  /// Trust is bound to the displayed review, so changed project declarations cannot receive stale consent.
  public func trustProjectCommand(projectID: String, reviewID: String) async throws -> PaletteProject {
    let project = try Self.segment(projectID)
    return try await fetch(
      path: "/api/projects/\(project)/trust", body: JSONEncoder().encode(["reviewId": reviewID]))
  }

  public func projectCommandRuns() async throws -> [ProjectCommandRun] { try await fetch(path: "/api/runs") }

  public func cancelProjectCommandRun(_ runID: String) async throws -> ProjectCommandRun {
    try await fetch(path: "/api/runs/\(Self.segment(runID))", method: "DELETE")
  }

  public func writeProjectCommandRun(_ runID: String, data: String) async throws {
    struct Acknowledgement: Decodable { let accepted: Bool }
    let result: Acknowledgement = try await fetch(
      path: "/api/runs/\(Self.segment(runID))/input", body: JSONEncoder().encode(["data": data]))
    guard result.accepted else { throw RuntimeAPIError.invalidResponse }
  }

  public func resizeProjectCommandRun(_ runID: String, columns: Int, rows: Int) async throws {
    struct Acknowledgement: Decodable { let accepted: Bool }
    guard (1...1000).contains(columns), (1...1000).contains(rows) else { throw RuntimeAPIError.invalidEndpoint }
    let result: Acknowledgement = try await fetch(
      path: "/api/runs/\(Self.segment(runID))/resize",
      body: JSONEncoder().encode(["columns": columns, "rows": rows]))
    guard result.accepted else { throw RuntimeAPIError.invalidResponse }
  }

  /// Preserve terminal protocol bytes, including invalid UTF-8, across the JSON transport.
  public func writeProjectCommandRun(_ runID: String, bytes: Data) async throws {
    struct Acknowledgement: Decodable { let accepted: Bool }
    guard bytes.count <= 64 * 1024 else { throw RuntimeAPIError.invalidEndpoint }
    let result: Acknowledgement = try await fetch(
      path: "/api/runs/\(Self.segment(runID))/input",
      body: JSONEncoder().encode(["dataBase64": bytes.base64EncodedString()]))
    guard result.accepted else { throw RuntimeAPIError.invalidResponse }
  }

  /// The runtime consumes the review before spawn. Cancelling the socket never silently cancels the process.
  public func runProjectCommand(
    projectID: String, capabilityID: String, inputs: [String: String], reviewID: String,
    startupTimeout: TimeInterval = 30,
    update: @escaping (ProjectCommandUpdate) async -> Void
  ) async throws -> ProjectCommandRun {
    guard startupTimeout > 0, startupTimeout.isFinite else { throw RuntimeAPIError.invalidEndpoint }
    let project = try Self.segment(projectID)
    let body = try JSONEncoder().encode(CommandRequest(capabilityId: capabilityID, inputs: inputs, reviewId: reviewID))
    var request = try connection.request(path: "/api/projects/\(project)/run", body: body)
    request.setValue("application/x-ndjson", forHTTPHeaderField: "Accept")
    // Quiet commands remain connected; only their initial start acknowledgement has a short deadline.
    request.timeoutInterval = 7 * 24 * 60 * 60
    var decoder = ProjectCommandStreamDecoder(projectID: projectID, capabilityID: capabilityID)
    if session == nil {
      let (data, response) = try await transport(request)
      try Self.validateCommandResponse(response, request: request, failureBody: data)
      for byte in data {
        try Task.checkCancellation()
        if let value = try decoder.append(byte) { await update(value) }
      }
    } else {
      let configuration = URLSessionConfiguration.ephemeral
      configuration.httpCookieStorage = nil
      configuration.urlCache = nil
      configuration.timeoutIntervalForResource = 7 * 24 * 60 * 60
      configuration.timeoutIntervalForRequest = 7 * 24 * 60 * 60
      let streamSession = URLSession(configuration: configuration, delegate: RuntimeNoRedirects(), delegateQueue: nil)
      let startupDeadline = Task {
        do { try await Task.sleep(for: .seconds(startupTimeout)) } catch { return }
        streamSession.invalidateAndCancel()
      }
      defer {
        startupDeadline.cancel()
        streamSession.invalidateAndCancel()
      }
      try await withTaskCancellationHandler {
        let (bytes, response) = try await streamSession.bytes(for: request)
        defer { bytes.task.cancel() }
        if let response = response as? HTTPURLResponse, !(200..<300).contains(response.statusCode) {
          var data = Data()
          for try await byte in bytes {
            guard data.count < 64 * 1024 else { throw RuntimeAPIError.invalidResponse }
            data.append(byte)
          }
          try Self.validateCommandResponse(response, request: request, failureBody: data)
        }
        try Self.validateCommandResponse(response, request: request)
        for try await byte in bytes {
          try Task.checkCancellation()
          if let value = try decoder.append(byte) {
            startupDeadline.cancel()
            await update(value)
          }
        }
      } onCancel: {
        streamSession.invalidateAndCancel()
      }
    }
    if let value = try decoder.finish() { await update(value) }
    guard let result = decoder.completed else { throw RuntimeAPIError.invalidResponse }
    return result
  }

  private static func validateCommandResponse(_ response: URLResponse, request: URLRequest, failureBody: Data? = nil)
    throws
  {
    guard let response = response as? HTTPURLResponse, response.url == request.url else {
      throw RuntimeAPIError.invalidResponse
    }
    if !(200..<300).contains(response.statusCode) {
      struct Failure: Decodable { let error: String }
      let failure = failureBody.flatMap { try? JSONDecoder().decode(Failure.self, from: $0).error }
      throw RuntimeAPIError.rejected(response.statusCode, String((failure ?? "Command request failed").prefix(500)))
    }
    guard response.mimeType?.lowercased() == "application/x-ndjson" else { throw RuntimeAPIError.invalidResponse }
  }
}

private struct CommandRequest: Encodable {
  let capabilityId: String
  let inputs: [String: String]
  let reviewId: String?
}

extension ISO8601DateFormatter {
  fileprivate static var fractional: ISO8601DateFormatter {
    let value = ISO8601DateFormatter()
    value.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return value
  }
}

/// Incremental UTF-8 framing rejects partial/invalid records instead of claiming a disconnected command finished.
struct ProjectCommandStreamDecoder {
  private struct Event: Decodable {
    let type: String
    let run: ProjectCommandRun?
    let stream: String?
    let chunk: String?
  }
  private let projectID: String
  private let capabilityID: String
  private var line = Data()
  private var current: ProjectCommandRun?
  private(set) var completed: ProjectCommandRun?
  private let maximumLine: Int
  init(projectID: String, capabilityID: String, maximumLine: Int = 64 * 1024 * 1024) {
    self.projectID = projectID
    self.capabilityID = capabilityID
    self.maximumLine = maximumLine
  }
  mutating func append(_ byte: UInt8) throws -> ProjectCommandUpdate? {
    if byte == 0x0a { return try consumeLine() }
    guard line.count < maximumLine else { throw RuntimeAPIError.invalidResponse }
    line.append(byte)
    return nil
  }
  mutating func finish() throws -> ProjectCommandUpdate? {
    let value = line.isEmpty ? nil : try consumeLine()
    guard completed != nil else { throw RuntimeAPIError.invalidResponse }
    return value
  }
  private mutating func consumeLine() throws -> ProjectCommandUpdate? {
    defer { line.removeAll(keepingCapacity: true) }
    if line.last == 0x0d { line.removeLast() }
    guard !line.isEmpty else { return nil }
    guard completed == nil else { throw RuntimeAPIError.invalidResponse }
    let event = try JSONDecoder().decode(Event.self, from: line)
    switch event.type {
    case "start", "complete":
      guard let run = event.run, !run.id.isEmpty, run.projectId == projectID, run.capabilityId == capabilityID,
        ["running", "completed", "cancelled", "failed"].contains(run.status)
      else { throw RuntimeAPIError.invalidResponse }
      if event.type == "start" {
        guard current == nil else { throw RuntimeAPIError.invalidResponse }
      } else {
        guard current?.id == run.id, !run.isRunning else { throw RuntimeAPIError.invalidResponse }
        completed = run
      }
      current = run
      return .init(run: run, appendedOutput: nil, completed: event.type == "complete")
    case "output":
      guard var run = current, let stream = event.stream, ["stdout", "stderr"].contains(stream), let chunk = event.chunk
      else { throw RuntimeAPIError.invalidResponse }
      let limit = 10 * 1024 * 1024
      if stream == "stdout" {
        run.stdout = String((run.stdout + chunk).suffix(limit))
      } else {
        run.stderr = String((run.stderr + chunk).suffix(limit))
      }
      current = run
      return .init(run: run, appendedOutput: chunk, completed: false)
    default: throw RuntimeAPIError.invalidResponse
    }
  }
}

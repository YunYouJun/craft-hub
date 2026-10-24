import Foundation

public struct PaletteProject: Decodable, Identifiable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let path: String
  public let trust: String
}
public struct PaletteCapability: Decodable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let kind: String
  public let description: String?
}
public struct CaptureList: Codable, Identifiable, Equatable, Sendable {
  public let id: String
  public let title: String
  public init(id: String, title: String) {
    self.id = id
    self.title = title
  }
}
public struct CaptureDraft: Codable, Equatable, Sendable {
  public var title = ""
  public var listId: String?
  public var dueLocal: String?
  public var important = false
  public var remind = false
  public var notes = ""
  public var warnings: [String] = []
  public init() {}
}
public struct CaptureConnection: Decodable {
  public struct Capabilities: Decodable { public let create: Bool? }
  public struct Authorization: Decodable {
    public let verificationUrl: String
    public let userCode: String
  }
  public let connected: Bool
  public let accountLabel: String?
  public let message: String?
  public let capabilities: Capabilities?
  public let deviceAuthorization: Authorization?
}
public struct CapturePage: Decodable { public let collections: [CaptureList]? }
public struct CaptureReceipt: Decodable {
  public let id: String
  public let title: String
}
public struct AssistantStatus: Decodable { public let available: Bool }

extension RuntimeAPIClient {
  public func projects() async throws -> [PaletteProject] {
    try await projectCatalog().projects
  }
  public func capabilities(projectID: String) async throws -> [PaletteCapability] {
    struct Discovery: Decodable { let capabilities: [PaletteCapability] }
    let value: Discovery = try await fetch(path: "/api/projects/\(try Self.segment(projectID))/capability-discovery")
    return value.capabilities
  }
  /// Read the runtime-resolved pin IDs; semantic reference matching and persistence remain in the shared runtime.
  public func capabilityPins(projectID: String) async throws -> Set<String> {
    struct Pins: Decodable {
      let projectId: String
      let capabilityIds: [String]
    }
    let value: Pins = try await fetch(path: "/api/projects/\(try Self.segment(projectID))/pins")
    guard value.projectId == projectID else { throw RuntimeAPIError.invalidResponse }
    return Set(value.capabilityIds)
  }
  public func captureConnection(authorize: Bool = false, locale: String) async throws -> CaptureConnection {
    var input = ["locale": locale]
    if authorize { input["method"] = "enable-write" }
    return try await todo(action: authorize ? "connect" : "connection", input: input, confirmed: authorize)
  }
  public func captureLists(locale: String) async throws -> [CaptureList] {
    let page: CapturePage = try await todo(action: "tasks", input: ["locale": locale])
    return page.collections ?? []
  }
  public func assistantStatus() async throws -> AssistantStatus { try await fetch(path: "/api/work-assistant") }
  public func previewCapture(text: String, lists: [CaptureList], ai: Bool = false, locale: String) async throws
    -> CaptureDraft
  {
    let encoder = JSONEncoder()
    let encodedLists = try JSONSerialization.jsonObject(with: encoder.encode(lists))
    var input: [String: Any] = ["text": text, "lists": encodedLists, "localNow": CaptureDates.local(Date())]
    if ai {
      input["timeZone"] = TimeZone.current.identifier
      input["locale"] = locale
    }
    return try await fetch(
      path: "/api/work-assistant/\(ai ? "capture" : "capture-preview")",
      body: JSONSerialization.data(withJSONObject: input), timeout: ai ? 100 : 30)
  }
  /// The reviewed fields and durable request ID are passed unchanged to the runtime's idempotent create action.
  public func saveCapture(payload: [String: String], important: Bool, requestID: String) async throws -> CaptureReceipt
  {
    var input: [String: Any] = payload
    input["important"] = important
    input["requestId"] = requestID
    return try await todo(action: "create", input: input, confirmed: true)
  }
  private func todo<Value: Decodable>(action: String, input: [String: Any], confirmed: Bool = false) async throws
    -> Value
  {
    try await fetch(
      path: "/api/integrations/microsoft-todo/actions/\(action)",
      body: JSONSerialization.data(withJSONObject: ["input": input, "confirmed": confirmed]))
  }
  static func segment(_ value: String) throws -> String {
    guard !value.isEmpty, value != ".", value != "..",
      let encoded = value.addingPercentEncoding(
        withAllowedCharacters: CharacterSet(
          charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"))
    else { throw RuntimeAPIError.invalidEndpoint }
    return encoded
  }
}

/// Wall-time dates remain reviewable; conversion to UTC happens only for a requested reminder.
public enum CaptureDates {
  private static func formatter() -> DateFormatter {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = .current
    formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
    formatter.isLenient = false
    return formatter
  }
  public static func local(_ date: Date) -> String { formatter().string(from: date) }
  public static func date(_ value: String) throws -> Date {
    let formatter = formatter()
    guard value.count == 16, let date = formatter.date(from: value), formatter.string(from: date) == value else {
      throw CocoaError(.formatting)
    }
    return date
  }
  public static func instant(_ value: String) throws -> String {
    let date = try self.date(value)
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return iso.string(from: date)
  }
}

public struct PalettePage: Sendable {
  public let id: String
  public let title: String
  public let path: String
}
extension RuntimeAPIClient {
  public func palettePages(locale: String) async throws -> [PalettePage] {
    struct Integration: Decodable {
      struct View: Decodable {
        let id: String
        let title: String
        let placement: String
      }
      let id: String
      let views: [View]
      let translations: [String: [String: String]]?
    }
    struct Integrations: Decodable { let integrations: [Integration] }
    struct Workbench: Decodable {
      let id: String
      let pluginId: String
      let title: String
    }
    async let integrations: Integrations = fetch(path: "/api/integrations")
    async let workbenches: [Workbench] = fetch(
      path: "/api/workbenches", query: [URLQueryItem(name: "locale", value: locale)])
    var pages: [PalettePage] = []
    for contribution in try await integrations.integrations {
      for view in contribution.views where view.placement == "primary-sidebar" {
        pages.append(
          PalettePage(
            id: "integration:\(contribution.id):\(view.id)",
            title: contribution.translations?[locale]?[view.title] ?? view.title,
            path: "/integrations/\(try Self.segment(contribution.id))/\(try Self.segment(view.id))"))
      }
    }
    for workbench in try await workbenches {
      pages.append(
        PalettePage(
          id: "workbench:\(workbench.pluginId):\(workbench.id)", title: workbench.title,
          path: "/workbenches/\(try Self.segment(workbench.pluginId))/\(try Self.segment(workbench.id))"))
    }
    return pages
  }
}

extension RuntimeAPIClient {
  /// A deliberate host restart checks project work, provider-owned installations and configuration source jobs.
  public func requireIdleRuntime() async throws {
    struct RunSummary: Decodable { let running: Int }
    struct AgentTask: Decodable { let status: String }
    async let runs: [RunSummary] = fetch(path: "/api/runs/summary")
    async let agents: [AgentTask] = fetch(path: "/api/agent-tasks")
    let (summaries, tasks) = try await (runs, agents)
    guard !summaries.contains(where: { $0.running > 0 }), !tasks.contains(where: { $0.status == "running" }) else {
      throw RuntimeAPIError.rejected(409, "Finish active commands and agent tasks before restarting.")
    }
    struct SourceJobs: Decodable {
      struct Job: Decodable { let state: String }
      let connections: [Job]
    }
    let jobs: SourceJobs = try await fetch(path: "/api/environment/sources")
    guard !jobs.connections.contains(where: { ["connecting", "authentication-required"].contains($0.state) }) else {
      throw RuntimeAPIError.rejected(409, "Finish or cancel configuration source connections before restarting.")
    }
    for source in try await software().sources where source.canManage == true {
      guard source.supports("runs") else {
        throw RuntimeAPIError.rejected(503, "Software installation state could not be checked.")
      }
      guard try await !softwareRuns(source: source.id).contains(where: \.active) else {
        throw RuntimeAPIError.rejected(409, "Finish or stop software installations before restarting.")
      }
    }
  }
}

import Foundation

/// Shared runtime diagnostics, including incomplete provider reports. The client never invents a passing check.
public struct DiagnosticSnapshot: Decodable, Sendable {
  public struct Counts: Decodable, Sendable {
    public let errors: Int
    public let warnings: Int
  }
  public struct Target: Decodable, Equatable, Sendable {
    public let type: String
    public let integrationId: String?
    public let package: String?
    public let projectId: String?
    public let sourceId: String?
  }
  public struct Item: Decodable, Identifiable, Sendable {
    public let id: String
    public let kind: String
    public let severity: String
    public let message: String
    public let subject: String?
    public let path: String?
    public let line: Int?
    public let column: Int?
    public let target: Target?
    public let providerId: String?
    public let code: String?
  }
  public struct Provider: Decodable, Identifiable, Sendable {
    public struct Summary: Decodable, Sendable {
      public let errors: Int
      public let warnings: Int
      public let passed: Int
    }
    public struct Metadata: Decodable, Sendable {
      public let version: String?
      public let platform: String?
    }
    public let id: String
    public let title: String
    public let pluginId: String
    public let state: String
    public let checkedAt: String?
    public let summary: Summary?
    public let metadata: Metadata?
    public let message: String?
  }
  public let checkedAt: String
  public let diagnostics: [Item]
  public let summary: Counts
  public let providers: [Provider]?
  public var reportsComplete: Bool { (providers ?? []).allSatisfy { $0.state == "ready" } }
  public var allClear: Bool { summary.errors == 0 && summary.warnings == 0 && reportsComplete }
}

extension RuntimeAPIClient {
  public func diagnostics() async throws -> DiagnosticSnapshot { try await fetch(path: "/api/diagnostics") }
}

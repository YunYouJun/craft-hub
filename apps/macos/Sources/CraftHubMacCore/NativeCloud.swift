import Foundation

/// Non-secret native account state and immutable local command reviews. No vault material is an HTTP contract.
public struct NativeCloudSnapshot: Decodable, Sendable {
  public struct Status: Codable, Sendable {
    public let state: String
    public let deviceId: String?
    public let lastSyncAt: String?
    public let diagnostic: String?
    public let busy: Bool?
  }
  public struct Invocation: Decodable, Sendable {
    public let command: String
    public let args: [String]
    public let cwd: String
    public let requiredEnv: [String]
    public let prerequisites: [Invocation]?
    public let label: String?
    public var steps: [Invocation] { (prerequisites ?? []).flatMap(\.steps) + [self] }
  }
  public struct Review: Decodable, Sendable {
    public let projectId: String
    public let projectPath: String
    public let capabilityId: String
    public let invocation: Invocation
    public let script: String?
    public let expiresAt: String
  }
  public struct Approval: Decodable, Sendable, Identifiable {
    public let id: String
    public let projectName: String
    public let capabilityName: String
    public let review: Review
    public var expiresAt: Date? {
      ISO8601DateFormatter().date(from: review.expiresAt) ?? Self.fractional.date(from: review.expiresAt)
    }
    private static var fractional: ISO8601DateFormatter {
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      return formatter
    }
  }
  public let version: Int
  public let status: Status
  public let approvals: [Approval]
}

extension RuntimeAPIClient {
  public func cloudSnapshot() async throws -> NativeCloudSnapshot {
    let snapshot: NativeCloudSnapshot = try await fetch(path: "/api/native-host/cloud")
    guard snapshot.version == 1 else { throw RuntimeAPIError.incompatibleVersion }
    return snapshot
  }
  public func cloudAction(_ action: String, values: [String: String] = [:], accepted: Bool? = nil) async throws
    -> NativeCloudSnapshot
  {
    var body: [String: Any] = values
    body["action"] = action
    if let accepted { body["accepted"] = accepted }
    let snapshot: NativeCloudSnapshot = try await fetch(
      path: "/api/native-host/cloud", body: JSONSerialization.data(withJSONObject: body), timeout: 45)
    guard snapshot.version == 1 else { throw RuntimeAPIError.incompatibleVersion }
    return snapshot
  }
}

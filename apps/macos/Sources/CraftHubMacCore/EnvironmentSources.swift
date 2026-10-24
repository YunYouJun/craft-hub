import Foundation

/// Transient source connection progress. The provider owns destinations, validation and binding.
public struct EnvironmentSourcesSnapshot: Decodable, Sendable {
  public let providers: [Provider]
  public let connections: [Connection]
  public struct Provider: Decodable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let kinds: [String]
  }
  public struct Connection: Decodable, Identifiable, Sendable {
    public let id: String
    public let providerId: String
    public let kind: String
    public let repository: String
    public let state: String
    public let phase: String
    public let expiresAt: String
    public let error: String?
    public let localPath: String?
    public var active: Bool { ["connecting", "authentication-required"].contains(state) }
  }
}
extension RuntimeAPIClient {
  public func environmentSources() async throws -> EnvironmentSourcesSnapshot {
    try await fetch(path: "/api/environment/sources")
  }
  public func connectEnvironmentSource(provider: String, kind: String, repository: String) async throws
    -> EnvironmentSourcesSnapshot
  {
    try await fetch(
      path: "/api/environment/sources",
      body: JSONEncoder().encode([
        "operation": "connect", "providerId": provider, "kind": kind, "repository": repository,
      ]))
  }
  /// Credentials exist only in this request and the caller's transient form; never persist or log them.
  public func authenticateEnvironmentSource(id: String, username: String, token: String) async throws
    -> EnvironmentSourcesSnapshot
  {
    let body = try JSONSerialization.data(withJSONObject: [
      "operation": "authenticate", "id": id, "credentials": ["username": username, "token": token],
    ])
    return try await fetch(path: "/api/environment/sources", body: body)
  }
  public func cancelEnvironmentSource(id: String) async throws -> EnvironmentSourcesSnapshot {
    try await fetch(path: "/api/environment/sources", body: JSONEncoder().encode(["operation": "cancel", "id": id]))
  }
}

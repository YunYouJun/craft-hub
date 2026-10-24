import Foundation

/// Profile-specific activity status; hook ownership and edits remain in the shared Codex adapter.
public struct CodexActivityStatus: Codable, Sendable {
  public let diagnostic: String?
  public let hooksPath: String?
  public let installed: Bool
  public let ownHookCount: Int?
  public let otherHookCount: Int?
  public let requiresTrustReview: Bool?
  public let runningSessionIds: [String]
  public let supported: Bool
}

/// A one-use review of exact local files, with no prompt content or endpoint credential.
public struct CodexActivityReview: Decodable, Sendable {
  public let id: String
  public let action: String
  public let hooksPath: String
  public let bridgePath: String
  public let ownHookCount: Int
  public let otherHookCount: Int
  public let expiresAt: String
}

extension RuntimeAPIClient {
  private struct ActivityReply: Decodable {
    let version: Int
    let status: CodexActivityStatus?
    let review: CodexActivityReview?
  }

  public func codexActivityStatus() async throws -> CodexActivityStatus {
    let reply: ActivityReply = try await fetch(path: "/api/native-host/codex-activity")
    guard reply.version == 1, let status = reply.status else { throw RuntimeAPIError.incompatibleVersion }
    return status
  }

  public func reviewCodexActivity(install: Bool) async throws -> CodexActivityReview {
    let action = install ? "install" : "uninstall"
    let reply: ActivityReply = try await fetch(
      path: "/api/native-host/codex-activity",
      body: JSONEncoder().encode(["action": "review", "operation": action]))
    guard reply.version == 1, let review = reply.review, review.action == action else {
      throw RuntimeAPIError.invalidResponse
    }
    return review
  }

  public func applyCodexActivity(_ id: String) async throws -> CodexActivityStatus {
    let reply: ActivityReply = try await fetch(
      path: "/api/native-host/codex-activity", body: JSONEncoder().encode(["action": "apply", "id": id]))
    guard reply.version == 1, let status = reply.status else { throw RuntimeAPIError.invalidResponse }
    return status
  }

  public func cancelCodexActivity(_ id: String) async throws {
    let reply: ActivityReply = try await fetch(
      path: "/api/native-host/codex-activity", body: JSONEncoder().encode(["action": "cancel", "id": id]))
    guard reply.version == 1 else { throw RuntimeAPIError.incompatibleVersion }
  }
}

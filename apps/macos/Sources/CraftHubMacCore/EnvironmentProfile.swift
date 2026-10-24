import Foundation

/// Portable intent returned by the runtime. Machine paths, credentials, trust and configuration contents stay local.
public struct EnvironmentProfile: Codable, Sendable {
  public let version: Int
  public let platform: String
  public let name: String
  public let software: [Software]
  public let configurations: [Configuration]
  public struct Software: Codable, Identifiable, Sendable {
    public let sourceId: String
    public let softwareId: String
    public let title: SoftwareSnapshot.Text
    public let url: String
    public let installation: SoftwareInstallationPlan.Installation
    public var id: String { "\(sourceId.count):\(sourceId)\(softwareId)" }
  }
  public struct Configuration: Codable, Identifiable, Sendable {
    public let integrationId: String
    public let itemId: String
    public let title: String
    public let kind: String
    public let origin: String
    public let sourceDigest: String
    public var id: String { "\(integrationId.count):\(integrationId)\(itemId)" }
  }
  public func exported() throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(self) + Data("\n".utf8)
  }
}
public struct EnvironmentProfileSnapshot: Decodable, Sendable {
  public let version: Int
  public let revision: String
  public let profile: EnvironmentProfile?
}
public struct EnvironmentProfileInventory: Decodable, Sendable {
  public let software: [Software]
  public let configurations: [Configuration]
  public let unavailableIntegrations: [String]
  public struct Software: Decodable, Sendable {
    public let reference: EnvironmentProfile.Software
    public let status: String
    public let canInstall: Bool
  }
  public struct Configuration: Decodable, Sendable {
    public let reference: EnvironmentProfile.Configuration
    public let status: String
    public let href: String
  }
}
public struct EnvironmentProfileReview: Decodable, Sendable {
  public let snapshot: EnvironmentProfileSnapshot
  public let software: [Software]
  public let configurations: [Configuration]
  public struct Software: Decodable, Sendable {
    public let reference: EnvironmentProfile.Software
    public let state: String
    public let canInstall: Bool
  }
  public struct Configuration: Decodable, Sendable {
    public let reference: EnvironmentProfile.Configuration
    public let state: String
    public let href: String?
  }
}
/// Provider guidance is display/copy only. No native execution action exists in this contract.
public struct EnvironmentSetupSnapshot: Decodable, Sendable {
  public let version: Int
  public let checkedAt: String
  public let profileRevision: String
  public let platform: String
  public let steps: [Step]
  public let prerequisitesReady: Bool
  public struct Step: Decodable, Identifiable, Sendable {
    public let id: String
    public let title: SoftwareSnapshot.Text
    public let description: SoftwareSnapshot.Text
    public let state: String
    public let dependsOn: [String]
    public let actions: [Action]
  }
  public struct Action: Decodable, Sendable {
    public let kind: String
    public let title: SoftwareSnapshot.Text
    public let url: String?
    public let text: String?
  }
}
extension RuntimeAPIClient {
  public func environmentProfile() async throws -> EnvironmentProfileSnapshot {
    try checkedProfile(await fetch(path: "/api/setup-profile"))
  }
  public func environmentProfileInventory() async throws -> EnvironmentProfileInventory {
    try await fetch(path: "/api/setup-profile", body: JSONEncoder().encode(["operation": "inventory"]))
  }
  public func reviewEnvironmentProfile() async throws -> EnvironmentProfileReview {
    let result: EnvironmentProfileReview = try await fetch(
      path: "/api/setup-profile", body: JSONEncoder().encode(["operation": "review"]))
    _ = try checkedProfile(result.snapshot)
    return result
  }
  /// Only IDs and a revision are submitted; the runtime captures metadata from fresh providers.
  public func saveEnvironmentProfile(
    revision: String, name: String, software: [EnvironmentProfile.Software],
    configurations: [EnvironmentProfile.Configuration]
  ) async throws -> EnvironmentProfileSnapshot {
    let body = try JSONSerialization.data(withJSONObject: [
      "operation": "save", "revision": revision, "name": name,
      "software": software.map { ["sourceId": $0.sourceId, "softwareId": $0.softwareId] },
      "configurations": configurations.map { ["integrationId": $0.integrationId, "itemId": $0.itemId] },
    ])
    return try checkedProfile(await fetch(path: "/api/setup-profile", body: body))
  }
  /// Forward the original JSON shape to strict runtime validation; never silently strip unknown imported fields.
  public func importEnvironmentProfile(_ json: Data, revision: String) async throws -> EnvironmentProfileSnapshot {
    guard json.count <= 256 * 1024 else {
      throw RuntimeAPIError.rejected(400, "The environment profile exceeds 256 KiB.")
    }
    let value = try JSONSerialization.jsonObject(with: json)
    let body = try JSONSerialization.data(withJSONObject: [
      "operation": "import", "revision": revision, "profile": value,
    ])
    guard body.count <= 256 * 1024 else {
      throw RuntimeAPIError.rejected(400, "The environment profile request exceeds 256 KiB.")
    }
    return try checkedProfile(await fetch(path: "/api/setup-profile", body: body))
  }
  public func environmentSetup() async throws -> EnvironmentSetupSnapshot {
    let result: EnvironmentSetupSnapshot = try await fetch(path: "/api/environment/setup")
    guard result.version == 1 else { throw RuntimeAPIError.incompatibleVersion }
    return result
  }
  private func checkedProfile(_ value: EnvironmentProfileSnapshot) throws -> EnvironmentProfileSnapshot {
    guard value.version == 1, value.profile == nil || value.profile?.version == 1 else {
      throw RuntimeAPIError.incompatibleVersion
    }
    return value
  }
}

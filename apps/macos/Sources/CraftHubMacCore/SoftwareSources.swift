import Foundation

public struct SoftwareSourceInput: Codable, Equatable, Sendable {
  public var id: String?
  public var repository: String?
  public var localPath: String?
  public var branch: String
  public var catalogPath: String
  public var mode: String
  public init(
    id: String? = nil, repository: String? = nil, localPath: String? = nil,
    branch: String = "HEAD", catalogPath: String = "software.config.ts", mode: String = "remote"
  ) {
    self.id = id
    self.repository = repository
    self.localPath = localPath
    self.branch = branch
    self.catalogPath = catalogPath
    self.mode = mode
  }
}
public struct SoftwareRefreshPolicy: Codable, Equatable, Sendable {
  public var mode: String
  public var intervalMinutes: Int?
  public var time: String?
  public var timeZone: String?
  public init(mode: String, intervalMinutes: Int? = nil, time: String? = nil, timeZone: String? = nil) {
    self.mode = mode
    self.intervalMinutes = intervalMinutes
    self.time = time
    self.timeZone = timeZone
  }
}
public struct SoftwareRepositorySource: Decodable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let repository: String?
  public let localPath: String?
  public let mode: String
  public let branch: String
  public let catalogPath: String
  public let refreshPolicy: SoftwareRefreshPolicy?
  public let checkedAt: String
  public let error: String?
  public let cache: Cache
  public struct Cache: Decodable, Sendable {
    public let readFrom: String
    public let commit: String?
    public let savedAt: String
    public let revision: String
    public let itemCount: Int
  }
}
public struct SoftwareSourcesSnapshot: Decodable, Sendable {
  public let version: Int
  public let revision: String
  public let localAvailable: Bool
  public let sources: [SoftwareRepositorySource]
}
public struct SoftwareSourcePreview: Decodable, Sendable {
  public let previewId: String
  public let source: SoftwareRepositorySource
  public let catalog: Catalog
  public let replaces: String?
  public struct Catalog: Decodable, Sendable {
    public let version: Int
    public let revision: String
    public let items: [Item]
  }
  public struct Item: Decodable, Identifiable, Sendable {
    public let id: String
    public let title: SoftwareSnapshot.Text
    public let installation: SoftwareInstallationPlan.Installation
  }
}
private struct SoftwareSourceCommand: Encodable {
  let operation: String
  var input: SoftwareSourceInput? = nil
  var previewId: String? = nil
  var id: String? = nil
  var revision: String? = nil
  var refreshPolicy: SoftwareRefreshPolicy? = nil
}
extension RuntimeAPIClient {
  public func softwareSources() async throws -> SoftwareSourcesSnapshot {
    let result: SoftwareSourcesSnapshot = try await fetch(path: "/api/software-sources")
    guard result.version == 1 else { throw RuntimeAPIError.incompatibleVersion }
    return result
  }
  public func previewSoftwareSource(_ input: SoftwareSourceInput) async throws -> SoftwareSourcePreview {
    let result: SoftwareSourcePreview = try await fetch(
      path: "/api/software-sources",
      body: JSONEncoder().encode(SoftwareSourceCommand(operation: "preview", input: input)))
    guard result.catalog.version == 1 else { throw RuntimeAPIError.incompatibleVersion }
    return result
  }
  public func applySoftwareSource(_ preview: String) async throws -> SoftwareSourcesSnapshot {
    try await sourceCommand(.init(operation: "apply", previewId: preview))
  }
  public func refreshSoftwareSource(_ id: String) async throws -> SoftwareSourcesSnapshot {
    try await sourceCommand(.init(operation: "refresh", id: id))
  }
  public func removeSoftwareSource(_ id: String, revision: String) async throws -> SoftwareSourcesSnapshot {
    try await sourceCommand(.init(operation: "remove", id: id, revision: revision))
  }
  public func configureSoftwareSource(_ id: String, revision: String, policy: SoftwareRefreshPolicy) async throws
    -> SoftwareSourcesSnapshot
  {
    try await sourceCommand(.init(operation: "configure-refresh", id: id, revision: revision, refreshPolicy: policy))
  }
  private func sourceCommand(_ command: SoftwareSourceCommand) async throws -> SoftwareSourcesSnapshot {
    let result: SoftwareSourcesSnapshot = try await fetch(
      path: "/api/software-sources", body: JSONEncoder().encode(command))
    guard result.version == 1 else { throw RuntimeAPIError.incompatibleVersion }
    return result
  }
}

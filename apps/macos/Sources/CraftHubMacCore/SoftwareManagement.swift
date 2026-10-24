import Foundation

/// Immutable adapter preview. The native client sends back only its ID and explicit confirmation.
public struct SoftwareInstallationPlan: Decodable, Identifiable, Sendable {
  public let version: Int
  public let id: String
  public let sourceId: String
  public let createdAt: String
  public let items: [Item]
  public let prerequisites: [String]
  public struct Installation: Codable, Sendable {
    public let kind: String
    public let packageId: String?
  }
  public struct Item: Decodable, Identifiable, Sendable {
    public let softwareId: String
    public let title: SoftwareSnapshot.Text
    public let action: String
    public let installation: Installation
    public let reason: String?
    public var id: String { softwareId }
  }
}

/// Provider-owned state and bounded logs; the client never derives installation success from a button click.
public struct SoftwareInstallationRun: Decodable, Identifiable, Sendable {
  public let version: Int
  public let id: String
  public let sourceId: String
  public let planId: String
  public let createdAt: String
  public let updatedAt: String
  public let state: String
  public let items: [Item]
  public let retryOf: String?
  public var key: String { "\(sourceId.count):\(sourceId)\(id)" }
  public var active: Bool { ["queued", "running", "cancelling"].contains(state) }
  public var retryableIDs: [String] {
    items.filter { ["failed", "interrupted", "cancelled"].contains($0.state) }.map(\.softwareId)
  }
  public struct Item: Decodable, Identifiable, Sendable {
    public let softwareId: String
    public let title: SoftwareSnapshot.Text
    public let state: String
    public let message: String?
    public let log: String
    public let progress: Progress?
    public var id: String { softwareId }
  }
  public struct Progress: Decodable, Sendable {
    public let phase: String
    public let percent: Double?
    public let resource: String?
  }
}

extension RuntimeAPIClient {
  public func softwarePlan(source: String, software: [String]) async throws -> SoftwareInstallationPlan {
    let result: SoftwareInstallationPlan = try await fetch(
      path: "/api/software/\(softwareSegment(source))/plan", body: JSONEncoder().encode(["softwareIds": software]))
    guard result.version == 1, result.sourceId == source,
      result.items.count == software.count, Set(result.items.map(\.softwareId)) == Set(software)
    else { throw RuntimeAPIError.invalidResponse }
    return result
  }
  public func installSoftware(source: String, plan: String) async throws -> SoftwareInstallationRun {
    struct Input: Encodable {
      let planId: String
      let confirmed = true
    }
    let result: SoftwareInstallationRun = try await fetch(
      path: "/api/software/\(softwareSegment(source))/install", body: JSONEncoder().encode(Input(planId: plan)))
    guard result.version == 1, result.sourceId == source, result.planId == plan else {
      throw RuntimeAPIError.invalidResponse
    }
    return result
  }
  public func softwareRuns(source: String) async throws -> [SoftwareInstallationRun] {
    struct Snapshot: Decodable {
      let version: Int
      let runs: [SoftwareInstallationRun]
    }
    let result: Snapshot = try await fetch(path: "/api/software/\(softwareSegment(source))/runs")
    guard result.version == 1, result.runs.allSatisfy({ $0.version == 1 && $0.sourceId == source }) else {
      throw RuntimeAPIError.invalidResponse
    }
    return result.runs
  }
  public func cancelSoftware(source: String, run: String) async throws -> SoftwareInstallationRun {
    let result: SoftwareInstallationRun = try await fetch(
      path: "/api/software/\(softwareSegment(source))/runs/\(softwareSegment(run))/cancel", body: Data("{}".utf8))
    guard result.version == 1, result.sourceId == source, result.id == run else {
      throw RuntimeAPIError.invalidResponse
    }
    return result
  }
  private func softwareSegment(_ value: String) throws -> String {
    try Self.segment(value)
  }
}

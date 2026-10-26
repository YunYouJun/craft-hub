import Foundation

public struct MaintainedApplication: Decodable, Identifiable, Sendable {
  public let id: String
  public let bundleId: String
  public let name: String
  public let path: String
}

public struct ApplicationMaintenanceSnapshot: Decodable, Sendable {
  public let version: Int
  public let supported: Bool
  public let applications: [MaintainedApplication]
  public let incomplete: Bool
}

public struct ApplicationUninstallGuidance: Decodable, Sendable {
  public let version: Int
  public let application: MaintainedApplication
  public let candidates: [Candidate]
  public let documentation: [Documentation]
  public let searchUrl: String
  public let incomplete: Bool
  public struct Candidate: Decodable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let path: String
    public let evidence: String
    public let verification: String
  }
  public struct Documentation: Decodable, Sendable {
    public let url: String
    public let source: String
  }
}

/// Versioned, navigation-only handoff. No file paths, commands or deletion instructions are accepted.
public struct ApplicationMaintenanceLink: Equatable, Sendable {
  public let bundleId: String?
  public init?(url: URL) {
    guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
      ["craft-hub", "craft-hub-native"].contains(parts.scheme), parts.host == "software",
      ["", "/"].contains(parts.path), parts.user == nil, parts.password == nil, parts.port == nil,
      parts.fragment == nil, url.absoluteString.utf8.count <= 2048,
      !url.absoluteString.unicodeScalars.contains(where: { $0.value <= 32 || $0.value == 127 })
    else { return nil }
    let items = parts.queryItems ?? []
    guard Set(items.map(\.name)).count == items.count,
      items.allSatisfy({ ["v", "bundleId"].contains($0.name) }),
      items.first(where: { $0.name == "v" })?.value == "1"
    else { return nil }
    let requested = items.first(where: { $0.name == "bundleId" })
    if let requested {
      guard let value = requested.value, value.utf8.count <= 255,
        value.range(of: "^[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+\\z", options: .regularExpression) != nil
      else { return nil }
    }
    bundleId = requested?.value
  }
}

extension RuntimeAPIClient {
  public func maintainedApplications() async throws -> ApplicationMaintenanceSnapshot {
    let result: ApplicationMaintenanceSnapshot = try await fetch(path: "/api/application-maintenance")
    guard result.version == 1, result.applications.count <= 500,
      Set(result.applications.map(\.id)).count == result.applications.count
    else { throw RuntimeAPIError.invalidResponse }
    return result
  }

  public func applicationUninstallGuidance(id: String) async throws -> ApplicationUninstallGuidance {
    let result: ApplicationUninstallGuidance = try await fetch(
      path: "/api/application-maintenance/\(Self.segment(id))")
    guard result.version == 1, result.application.id == id, result.candidates.count <= 20,
      result.candidates.allSatisfy({ $0.verification == "unverified" }), result.documentation.count <= 20
    else { throw RuntimeAPIError.invalidResponse }
    return result
  }

  public func revealMaintainedApplication(id: String, candidate: String? = nil) async throws {
    struct Acknowledgement: Decodable {
      let version: Int
      let destination: String
    }
    let body = try JSONEncoder().encode(candidate.map { ["candidateId": $0] } ?? [:])
    let result: Acknowledgement = try await fetch(
      path: "/api/application-maintenance/\(Self.segment(id))/reveal", body: body)
    guard result.version == 1, result.destination == "finder" else { throw RuntimeAPIError.invalidResponse }
  }
}

import Foundation

/// Shared favorites projection. The runtime owns duplicate detection, metadata and launch presets.
public struct SoftwareFavoritesSnapshot: Decodable, Sendable {
  public let version: Int
  public let revision: String
  public let tools: [Tool]
  public let matches: [Match]
  public struct Tool: Decodable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let group: String
    public let url: String
    public let downloadUrl: String?
    public let repositoryUrl: String?
    public let description: String?
    public let iconUrl: String?
    public let macosIconUrl: String?
    public let iconStyle: String?
    public let iconScale: Double?
    public let launch: Launch?
    public var artwork: SoftwareArtwork {
      SoftwareArtwork(website: url, iconURL: iconUrl, macosIconURL: macosIconUrl, style: iconStyle, scale: iconScale)
    }
    public struct Launch: Decodable, Sendable { public let application: String }
  }
  public struct Match: Decodable, Sendable {
    public let sourceId: String
    public let softwareId: String
    public let toolId: String
  }
}

extension RuntimeAPIClient {
  /// Only IDs, language and the inspected revision cross the mutation boundary.
  public func updateFavorite(_ input: [String: String]) async throws -> SoftwareFavoritesSnapshot {
    let result: SoftwareFavoritesSnapshot = try await fetch(
      path: "/api/software-favorites", body: JSONEncoder().encode(input))
    guard result.version == 1 else { throw RuntimeAPIError.incompatibleVersion }
    return result
  }
  public func openFavorite(_ id: String) async throws -> String {
    struct Result: Decodable { let destination: String }
    let result: Result = try await fetch(
      path: "/api/native-host/open-workbench-tool", body: JSONEncoder().encode(["toolId": id]))
    guard ["application", "website"].contains(result.destination) else { throw RuntimeAPIError.invalidResponse }
    return result.destination
  }
}

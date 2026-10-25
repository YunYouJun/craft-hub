import Foundation

/// Shared favorites projection. The runtime owns duplicate detection, metadata and launch presets.
public struct SoftwareFavoritesSnapshot: Decodable, Sendable {
  public let version: Int
  public let revision: String
  public let tools: [Tool]
  public let matches: [Match]
  public struct Tool: Codable, Identifiable, Sendable {
    public let id: String
    public var title: String
    public var group: String
    public var url: String
    public var downloadUrl: String?
    public var repositoryUrl: String?
    public var description: String?
    public var iconUrl: String?
    public var macosIconUrl: String?
    public var iconStyle: String?
    public var iconScale: Double?
    public var launch: Launch?
    public init(id: String = UUID().uuidString, title: String = "", group: String = "", url: String = "") {
      self.id = id
      self.title = title
      self.group = group
      self.url = url
    }
    public var artwork: SoftwareArtwork {
      SoftwareArtwork(website: url, iconURL: iconUrl, macosIconURL: macosIconUrl, style: iconStyle, scale: iconScale)
    }
    public struct Launch: Codable, Sendable {
      public var application: String
      public var commandUrl: String?
      public init(application: String, commandUrl: String? = nil) {
        self.application = application
        self.commandUrl = commandUrl
      }
    }
  }
  public struct Match: Decodable, Sendable {
    public let sourceId: String
    public let softwareId: String
    public let toolId: String
  }
}

extension RuntimeAPIClient {
  /// Replace validated shortcut data at an inspected revision; the runtime preserves other home preferences.
  public func replaceFavorites(_ tools: [SoftwareFavoritesSnapshot.Tool], revision: String) async throws
    -> SoftwareFavoritesSnapshot
  {
    struct Request: Encodable {
      let action = "replace"
      let revision: String
      let tools: [SoftwareFavoritesSnapshot.Tool]
    }
    let result: SoftwareFavoritesSnapshot = try await fetch(
      path: "/api/software-favorites", body: JSONEncoder().encode(Request(revision: revision, tools: tools)))
    guard result.version == 1 else { throw RuntimeAPIError.incompatibleVersion }
    return result
  }
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

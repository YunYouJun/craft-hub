import Foundation

/// Localized, read-only website groups supplied by enabled declarative plugins.
public struct NavigationPanel: Decodable, Identifiable, Sendable {
  public let panelID: String
  public let pluginId: String
  public let pluginName: String
  public let pluginVersion: String
  public let title: String
  public let description: String?
  public let icon: String?
  public let links: [Link]
  /// Panel identifiers are unique within a plugin, not across the entire directory.
  public var id: String { "\(pluginId.utf8.count):\(pluginId)\(panelID)" }

  private enum CodingKeys: String, CodingKey {
    case panelID = "id"
    case pluginId, pluginName, pluginVersion, title, description, icon, links
  }

  public struct Link: Decodable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let description: String?
    public let url: String
    public let icon: String?
    public let keywords: [String]

    /// Match the runtime's credential-free HTTPS boundary before handing a link to the operating system.
    public var destination: URL? {
      guard !url.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
        let value = URL(string: url), value.scheme == "https", value.host?.isEmpty == false,
        value.user == nil, value.password == nil
      else { return nil }
      return value
    }
  }
}

extension RuntimeAPIClient {
  /// Read navigation declarations without executing plugin commands or fetching their destinations.
  public func navigationPanels(locale: String) async throws -> [NavigationPanel] {
    try await fetch(path: "/api/navigation-panels", query: [URLQueryItem(name: "locale", value: locale)])
  }
}

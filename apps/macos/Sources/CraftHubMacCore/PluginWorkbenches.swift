import Foundation

/// A localized, inert plugin workbench entry. Its existing web renderer owns the composed panel content.
public struct PluginWorkbench: Decodable, Identifiable, Sendable {
  public let workbenchID: String
  public let pluginId: String
  public let title: String
  public let description: String?
  public let icon: String?
  public var id: String { path }

  /// Encode each route segment independently, including the slash in a scoped package name.
  public var path: String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
    let plugin = pluginId.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    let workbench = workbenchID.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    return "/workbenches/\(plugin)/\(workbench)"
  }

  private enum CodingKeys: String, CodingKey {
    case workbenchID = "id"
    case pluginId, title, description, icon
  }
}

extension RuntimeAPIClient {
  /// Read enabled workbench declarations without executing plugins or contacting their providers.
  public func pluginWorkbenches(locale: String) async throws -> [PluginWorkbench] {
    try await fetch(path: "/api/workbenches", query: [URLQueryItem(name: "locale", value: locale)])
  }
}

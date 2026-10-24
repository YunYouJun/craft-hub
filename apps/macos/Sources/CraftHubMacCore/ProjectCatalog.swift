import Foundation

/// The runtime owns registration, trust and discovery. Native lists retain its nonfatal catalog diagnostics.
public struct ProjectCatalog: Decodable, Sendable {
  public struct Diagnostic: Decodable, Identifiable, Sendable {
    public let projectId: String
    public let source: String
    public let path: String
    public let message: String
    public var id: String { "\(projectId):\(source):\(path):\(message)" }
  }
  public let projects: [PaletteProject]
  public let diagnostics: [Diagnostic]
  private enum CodingKeys: CodingKey { case projects, diagnostics }
  public init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    projects = try values.decode([PaletteProject].self, forKey: .projects)
    diagnostics = try values.decodeIfPresent([Diagnostic].self, forKey: .diagnostics) ?? []
  }
}

extension RuntimeAPIClient {
  /// Read registered projects and metadata errors without discovering or executing commands.
  public func projectCatalog() async throws -> ProjectCatalog { try await fetch(path: "/api/projects") }

  /// Register a user-selected local directory. The runtime assigns trust and canonicalizes the path.
  public func addProject(path: String) async throws -> PaletteProject {
    guard path.hasPrefix("/"), !path.contains("\0") else { throw RuntimeAPIError.invalidEndpoint }
    return try await fetch(path: "/api/projects", body: JSONEncoder().encode(["path": path]))
  }
}

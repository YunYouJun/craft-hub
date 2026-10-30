import Foundation

/// Read-only projections of runtime discovery. Plugins contribute data; each host owns its rendering.
public struct ProjectDetails: Sendable {
  public struct Package: Decodable, Identifiable, Sendable {
    public let relativePath: String
    public let root: Bool
    public let name: String?
    public let description: String?
    public let hidden: Bool?
    public var id: String { relativePath }
  }

  public struct Capability: Decodable, Identifiable, Sendable {
    public struct Availability: Decodable, Sendable {
      public let available: Bool
      public let diagnostic: String?
    }
    public let id: String
    public let name: String
    public let kind: String
    public let source: String
    public let description: String?
    public let package: Package?
    public let availability: Availability?
    public let command: ProjectCommand?
    public var packagePath: String? { kind == "command" ? package?.relativePath ?? "." : nil }
    public var supportsReview: Bool { kind == "command" || kind == "skill" }
    private enum CodingKeys: CodingKey { case id, name, kind, source, description, package, availability, invocation }
    public init(from decoder: Decoder) throws {
      let values = try decoder.container(keyedBy: CodingKeys.self)
      id = try values.decode(String.self, forKey: .id)
      name = try values.decode(String.self, forKey: .name)
      kind = try values.decode(String.self, forKey: .kind)
      source = try values.decode(String.self, forKey: .source)
      description = try values.decodeIfPresent(String.self, forKey: .description)
      package = try values.decodeIfPresent(Package.self, forKey: .package)
      availability = try values.decodeIfPresent(Availability.self, forKey: .availability)
      command = kind == "command" && values.contains(.invocation) ? try ProjectCommand(from: decoder) : nil
    }
  }

  public struct Diagnostic: Decodable, Sendable {
    public let source: String
    public let path: String
    public let message: String
  }

  public struct Discovery: Decodable, Sendable {
    public let capabilities: [Capability]
    public let packages: [Package]
    public let diagnostics: [Diagnostic]
    private enum CodingKeys: CodingKey { case capabilities, packages, diagnostics }
    public init(from decoder: Decoder) throws {
      let values = try decoder.container(keyedBy: CodingKeys.self)
      capabilities = try values.decode([Capability].self, forKey: .capabilities)
      packages = try values.decodeIfPresent([Package].self, forKey: .packages) ?? []
      diagnostics = try values.decode([Diagnostic].self, forKey: .diagnostics)
      guard Set(capabilities.map(\.id)).count == capabilities.count,
        capabilities.allSatisfy({ !$0.id.isEmpty }),
        Set(packages.map(\.relativePath)).count == packages.count
      else { throw RuntimeAPIError.invalidResponse }
    }
  }

  public let project: PaletteProject
  public let discovery: Discovery
}

extension RuntimeAPIClient {
  /// Refresh registration before discovery. These reads never grant trust, execute commands or invoke plugin writes.
  public func projectDetails(projectID: String) async throws -> ProjectDetails {
    let projectSegment = try Self.segment(projectID)
    let catalog = try await projectCatalog()
    guard let project = catalog.projects.first(where: { $0.id == projectID }) else {
      throw RuntimeAPIError.rejected(404, "Project is no longer registered.")
    }
    let discovery: ProjectDetails.Discovery = try await fetch(
      path: "/api/projects/\(projectSegment)/capability-discovery")
    return ProjectDetails(project: project, discovery: discovery)
  }
}

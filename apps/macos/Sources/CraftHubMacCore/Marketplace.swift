import Foundation

/// Presentation contracts from the shared marketplace runtime. Version and dependency policy stays in TypeScript.
public struct PluginMetadata: Decodable, Sendable {
  public struct Localization: Decodable, Sendable {
    public let displayName: String?
    public let description: String?
    public let permissionReasons: [String: String]?
  }
  public struct Maintainer: Decodable, Sendable {
    public let name: String?
    public let handle: String?
    public let url: String?
  }
  public struct Dependency: Decodable, Identifiable, Sendable {
    public let package: String
    public let version: String
    public var id: String { package }
  }
  public struct Contribution: Decodable, Sendable {}
  public let displayName: String
  public let description: String?
  public let icon: String?
  public let permissions: [String]
  public let permissionReasons: [String: String]?
  public let localizations: [String: Localization]?
  public let links: [String: String]?
  public let maintainers: [Maintainer]?
  public let includesPlugins: [Dependency]
  public let requiresPlugins: [Dependency]
  public let contributes: [String: [Contribution]]?
  public func name(chinese: Bool) -> String { localizations?[chinese ? "zh-CN" : "en"]?.displayName ?? displayName }
  public func detail(chinese: Bool) -> String? { localizations?[chinese ? "zh-CN" : "en"]?.description ?? description }
  public func reason(_ permission: String, chinese: Bool) -> String? {
    localizations?[chinese ? "zh-CN" : "en"]?.permissionReasons?[permission] ?? permissionReasons?[permission]
  }
}
public struct CatalogPlugin: Decodable, Identifiable, Sendable {
  public let package: String
  public let version: String
  public let sourceId: String
  public let sourceName: String
  public let sourceKind: String
  public let status: String
  public let statusReason: String?
  public let publisher: String
  public let action: String
  public let preferred: Bool
  public let included: Bool
  public let metadata: PluginMetadata
  public var id: String { "\(sourceId):\(package):\(version)" }
  public var artwork: PluginArtwork {
    PluginArtwork(icon: metadata.icon, sourceID: sourceId, package: package, version: version)
  }
  enum CodingKeys: CodingKey {
    case package, version, sourceId, sourceName, sourceKind, status, statusReason, publisher, action, preferred,
      included
  }
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    package = try c.decode(String.self, forKey: .package)
    version = try c.decode(String.self, forKey: .version)
    sourceId = try c.decode(String.self, forKey: .sourceId)
    sourceName = try c.decode(String.self, forKey: .sourceName)
    sourceKind = try c.decode(String.self, forKey: .sourceKind)
    status = try c.decode(String.self, forKey: .status)
    statusReason = try c.decodeIfPresent(String.self, forKey: .statusReason)
    publisher = try c.decode(String.self, forKey: .publisher)
    action = try c.decode(String.self, forKey: .action)
    preferred = try c.decode(Bool.self, forKey: .preferred)
    included = try c.decode(Bool.self, forKey: .included)
    metadata = try PluginMetadata(from: decoder)
  }
}
public struct InstalledPlugin: Decodable, Identifiable, Sendable {
  public let package: String
  public let version: String
  public let sourceId: String
  public let enabled: Bool
  public let packagePath: String
  public let manifest: PluginMetadata
  public let origin: String?
  public let previousVersion: String?
  public let error: String?
  public var id: String { package }
  public var local: Bool { origin == "local" }
  public var artwork: PluginArtwork {
    PluginArtwork(icon: manifest.icon, sourceID: sourceId, package: package, version: version)
  }
}
public struct PluginSourceVerification: Decodable, Sendable {
  public let organization: String
  public let verifiedAt: String
}
public struct PluginSource: Decodable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let kind: String
  public let enabled: Bool
  public let verification: PluginSourceVerification?
  public let catalogUrl: String?
  public let registry: String?
  public let lastRefreshedAt: String?
  public let error: String?
}
public struct MarketplaceOverview: Decodable, Sendable {
  public let version: Int
  public let catalog: [CatalogPlugin]
  public let installed: [InstalledPlugin]
  public let sources: [PluginSource]
}
public struct PluginInstallRequest: Codable, Equatable, Sendable {
  public let sourceId: String
  public let package: String
  public let version: String
  public init(sourceId: String, package: String, version: String) {
    self.sourceId = sourceId
    self.package = package
    self.version = version
  }
}
public struct PluginInstallPlan: Codable, Equatable, Sendable {
  public struct Item: Codable, Identifiable, Equatable, Sendable {
    public let package: String
    public let version: String
    public let displayName: String
    public let sourceId: String
    public let permissions: [String]
    public let action: String
    public let root: Bool
    public var id: String { package }
  }
  public let sourceId: String
  public let rootPackage: String
  public let items: [Item]
  public let permissions: [String]
}
public struct PluginSourceInput: Codable, Equatable, Sendable {
  public let name: String
  public let catalogUrl: String
  public let registry: String?
  public init(name: String, catalogUrl: String, registry: String?) {
    self.name = name
    self.catalogUrl = catalogUrl
    self.registry = registry
  }
}
public struct PluginSourcePreview: Decodable, Sendable {
  public struct Entry: Decodable, Identifiable, Sendable {
    public let package: String
    public let version: String
    public let displayName: String
    public var id: String { "\(package):\(version)" }
  }
  public let verification: PluginSourceVerification?
  public struct Catalog: Decodable, Sendable {
    public let name: String
    public let plugins: [Entry]
  }
  public let name: String
  public let catalogUrl: String
  public let finalCatalogUrl: String
  public let registry: String?
  public let catalog: Catalog
}
public struct PluginUpdate: Decodable, Identifiable, Sendable {
  public let package: String
  public let sourceId: String
  public let currentVersion: String
  public let targetVersion: String
  public let automatic: Bool
  public let error: String?
  public var id: String { package }
}
public struct PluginUpdateResult: Decodable, Sendable {
  public let updated: [InstalledPlugin]
  public let skipped: [PluginUpdate]
  public let failures: [PluginUpdate]
}
public struct PluginDocument: Decodable, Sendable {
  public struct Document: Decodable, Sendable {
    public let status: String
    public let path: String?
    public let content: String?
    public let message: String?
  }
  public let package: String
  public let version: String
  public let sourceId: String
  public let manifest: PluginMetadata
  public let document: Document
}
public struct NativeHostExtensions: Decodable, Sendable {
  public struct Bundled: Decodable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let version: String
    public let optional: Bool?
    public let enabled: Bool?
  }
  public struct External: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let manifestPath: String
    public let modules: [String]
    public let enabled: Bool
  }
  public struct Diagnostic: Decodable, Sendable { public let message: String }
  public let bundledExtensions: [Bundled]?
  public let extensions: [External]
  public let diagnostics: [Diagnostic]
  public let restartRequired: Bool
}
/// One-use review produced by the native host backend; the client returns the complete displayed value.
public struct NativeExtensionReview: Codable, Identifiable, Sendable {
  public let id: String
  public let `extension`: NativeHostExtensions.External
  public let previous: NativeHostExtensions.External?
}

extension RuntimeAPIClient {
  public func marketplace() async throws -> MarketplaceOverview {
    let value: MarketplaceOverview = try await fetch(path: "/api/marketplace/overview")
    guard value.version == 1 else { throw RuntimeAPIError.incompatibleVersion }
    return value
  }
  public func previewPlugin(_ input: PluginInstallRequest) async throws -> PluginInstallPlan {
    try await fetch(path: "/api/plugins/install/preview", body: JSONEncoder().encode(input))
  }
  public func installPlugin(_ input: PluginInstallRequest, reviewedPlan: PluginInstallPlan) async throws
    -> InstalledPlugin
  {
    var body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as! [String: Any]
    body["reviewedPlan"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(reviewedPlan))
    return try await fetch(
      path: "/api/plugins/install", body: JSONSerialization.data(withJSONObject: body), timeout: 180)
  }
  public func setPluginEnabled(_ package: String, enabled: Bool) async throws -> InstalledPlugin {
    try await fetch(
      path: "/api/plugins/\(try Self.segment(package))/enabled", body: JSONEncoder().encode(["enabled": enabled]),
      method: "PUT")
  }
  public func rollbackPlugin(_ package: String) async throws -> InstalledPlugin {
    try await fetch(path: "/api/plugins/\(try Self.segment(package))/rollback", body: Data("{}".utf8))
  }
  public func removePlugin(_ package: String, local: Bool) async throws {
    struct Result: Decodable {
      let deleted: Bool?
      let unlinked: Bool?
    }
    let _: Result = try await fetch(
      path: "/api/plugins/\(local ? "local/" : "")\(try Self.segment(package))",
      body: JSONEncoder().encode(["deleteData": false]), method: "DELETE")
  }
  public func linkPlugin(_ path: String) async throws -> InstalledPlugin {
    try await fetch(path: "/api/plugins/local", body: JSONEncoder().encode(["path": path]))
  }
  public func refreshLocalPlugin(_ package: String) async throws -> InstalledPlugin {
    try await fetch(path: "/api/plugins/local/\(try Self.segment(package))/refresh", body: Data("{}".utf8))
  }
  public func previewPluginSource(_ input: PluginSourceInput) async throws -> PluginSourcePreview {
    try await fetch(path: "/api/marketplace/sources/preview", body: JSONEncoder().encode(input))
  }
  public func addPluginSource(_ input: PluginSourceInput) async throws -> PluginSource {
    try await fetch(path: "/api/marketplace/sources", body: JSONEncoder().encode(input))
  }
  public func refreshPluginSource(_ id: String) async throws -> PluginSource {
    try await fetch(path: "/api/marketplace/sources/\(try Self.segment(id))/refresh", body: Data("{}".utf8))
  }
  public func removePluginSource(_ id: String) async throws {
    struct Result: Decodable { let deleted: Bool }
    let _: Result = try await fetch(path: "/api/marketplace/sources/\(try Self.segment(id))", method: "DELETE")
  }
  public func pluginUpdates() async throws -> [PluginUpdate] { try await fetch(path: "/api/plugins/updates") }
  public func updatePlugins() async throws -> PluginUpdateResult {
    try await fetch(path: "/api/plugins/updates", body: Data("{}".utf8), timeout: 300)
  }
  public func pluginDocument(source: String, package: String, version: String) async throws -> PluginDocument {
    try await fetch(
      path: "/api/plugins/document",
      query: [
        .init(name: "sourceId", value: source), .init(name: "package", value: package),
        .init(name: "version", value: version),
      ])
  }
  /// Reads only the package's declared artwork through the authenticated, isolated runtime endpoint.
  public func pluginIcon(_ reference: PluginIconReference) async throws -> Data {
    var query = [
      URLQueryItem(name: "sourceId", value: reference.sourceID),
      URLQueryItem(name: "package", value: reference.package),
    ]
    if let version = reference.version { query.append(.init(name: "version", value: version)) }
    return try await fetchAsset(
      path: "/api/plugins/icon", query: query, maximumBytes: 128_000,
      contentTypes: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/svg+xml"])
  }
  public func hostExtensions() async throws -> NativeHostExtensions {
    try await fetch(path: "/api/native-host/extensions")
  }
  public func setBundledExtension(_ id: String, enabled: Bool) async throws -> NativeHostExtensions {
    try await fetch(
      path: "/api/native-host/extensions",
      body: JSONSerialization.data(withJSONObject: ["id": id, "enabled": enabled]), method: "PUT")
  }
  public func previewHostExtension(_ path: String) async throws -> NativeExtensionReview {
    try await fetch(
      path: "/api/native-host/external-extensions/preview", body: JSONEncoder().encode(["manifestPath": path]))
  }
  public func cancelHostExtensionReview(_ id: String) async throws {
    struct Result: Decodable { let cancelled: Bool }
    let _: Result = try await fetch(
      path: "/api/native-host/external-extensions/cancel", body: JSONEncoder().encode(["id": id]))
  }
  public func installHostExtension(_ review: NativeExtensionReview) async throws -> NativeHostExtensions {
    try await fetch(
      path: "/api/native-host/external-extensions/install", body: JSONEncoder().encode(["reviewed": review]))
  }
  public func setExternalExtension(_ expected: NativeHostExtensions.External, enabled: Bool) async throws
    -> NativeHostExtensions
  {
    struct Input: Encodable {
      let expected: NativeHostExtensions.External
      let enabled: Bool
    }
    return try await fetch(
      path: "/api/native-host/external-extensions/enable",
      body: JSONEncoder().encode(Input(expected: expected, enabled: enabled)))
  }
  public func removeHostExtension(_ expected: NativeHostExtensions.External) async throws -> NativeHostExtensions {
    try await fetch(
      path: "/api/native-host/external-extensions/remove", body: JSONEncoder().encode(["expected": expected]))
  }
  public func diagnosticIntegrationPath(_ id: String) async throws -> String? {
    struct View: Decodable { let id: String }
    struct Integration: Decodable {
      let id: String
      let views: [View]
    }
    struct Index: Decodable { let integrations: [Integration] }
    let index: Index = try await fetch(path: "/api/integrations")
    guard let view = index.integrations.first(where: { $0.id == id })?.views.first else { return nil }
    return "/integrations/\(try Self.segment(id))/\(try Self.segment(view.id))"
  }
}

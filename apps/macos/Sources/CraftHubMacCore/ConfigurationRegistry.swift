import Foundation

/// Device-local references. Validation, encryption and persistence remain in the configuration provider.
public struct ConfigurationRegistry: Decodable, Sendable {
  public let version: Int
  public let revision: String
  public let sources: [Source]
  public let targets: [Target]
  public let ownership: [String: String]
  public struct Source: Codable, Identifiable, Equatable, Sendable {
    public var id = ""
    public var name = ""
    public var root = ""
    public var kind = "overlay"
    public var audience = "personal"
    public var manifest: String? = "config/sync-manifest.json"
    public var enabled = true
    public init() {}
  }
  public struct Target: Codable, Identifiable, Equatable, Sendable {
    public var id = ""
    public var name = ""
    public var root: String?
    public var directory = "configuration"
    public var audience = "personal"
    public var driver = "workstation"
    public var sourceIds: [String] = []
    public var keyEnvironment: String? = "CRAFT_HUB_BACKUP_KEY_DEFAULT"
    public init() {}
  }
}

/// A revision-bound change, never a replacement of the complete registry.
public struct ConfigurationRegistryMutation: Encodable, Sendable {
  public let action: String
  public let revision: String
  public var source: ConfigurationRegistry.Source?
  public var target: ConfigurationRegistry.Target?
  public var id: String?
  public var resource: String?
  public var sourceId: String?
  public init(action: String, revision: String) {
    self.action = action
    self.revision = revision
  }
}

/// The native host accepts only a dedicated namespace of explicitly supplied backup keys.
/// Variable values remain transient, never part of a configuration request or persisted preference.
public enum BackupKeyEnvironment {
  public static func forwarded(_ inherited: [String: String]) -> [String: String] {
    inherited.filter { name, value in
      name.hasPrefix("CRAFT_HUB_BACKUP_KEY_") && name.count <= 128 && value.utf8.count <= 16_384
        && name.range(of: "^[A-Z][A-Z0-9_]*$", options: .regularExpression) != nil
    }
  }
}

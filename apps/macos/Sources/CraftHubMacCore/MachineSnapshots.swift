import Foundation

/// Read-only observations from the runtime's fixed tool probes; the client never runs those probes itself.
public struct EnvironmentSnapshot: Decodable, Sendable {
  public let schemaVersion: Int
  public let checkedAt: String
  public let host: Host
  public let runtime: Runtime
  public let searchDirectories: [String]
  public let tools: [Tool]

  public struct Host: Decodable, Sendable {
    public let platform: String
    public let arch: String
    public let osRelease: String
  }
  public struct Runtime: Decodable, Sendable {
    public let version: String
    public let executablePath: String
    public let arch: String
  }
  public struct Tool: Decodable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let status: String
    public let executablePath: String?
    public let version: String?
    public let message: String?
  }
}

/// Software metadata and observations supplied by the shared runtime and its trusted adapters.
public struct SoftwareSnapshot: Decodable, Sendable {
  public let version: Int
  public let sources: [Source]

  public struct Text: Decodable, Sendable {
    public let en: String
    public let zh: String?
    public func localized(chinese: Bool) -> String { chinese ? (zh ?? en) : en }
  }
  public struct Item: Decodable, Identifiable, Sendable {
    public let id: String
    public let title: Text
    public let group: Group
    public let description: String?
    public let url: String
    public let status: String
    public let canOpen: Bool?
  }
  public struct Group: Decodable, Sendable {
    public let id: String
    public let title: Text
  }
  public struct Support: Decodable, Sendable {
    public let state: String
    public let operations: [String: Operation]
    public struct Operation: Decodable, Sendable { public let supported: Bool }
  }
  public struct Source: Decodable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let items: [Item]
    public let error: String?
    public let canManage: Bool?
    public let operationSupport: Support?

    /// Match the runtime contract: missing reports preserve legacy providers; present reports require support.
    public func canOpen(_ item: Item) -> Bool {
      error == nil && canManage == true && item.status == "detected" && item.canOpen == true
        && (operationSupport == nil || (operationSupport?.state == "available" && operationSupport?.operations["open"]?.supported == true))
    }
  }
}

import Foundation

/// Declarative integration metadata. Selecting a block does not grant trust or execute its write actions.
public struct NativeIntegrationCatalog: Decodable, Sendable {
  public let integrations: [Contribution]
  public let diagnostics: [Diagnostic]
  public struct Diagnostic: Decodable, Sendable {
    public let integrationId: String
    public let message: String
  }
  public struct Contribution: Decodable, Identifiable, Sendable {
    public let id: String
    public let actions: [Action]
    public let views: [View]
    public let translations: [String: [String: String]]?
  }
  public struct Action: Decodable, Sendable {
    public let id: String
    public let title: String
    public let operation: String
    public let effect: String
    public let effectiveConfirmation: String
  }
  public struct View: Decodable, Identifiable, Sendable {
    public let id: String
    public let icon: String?
    public let title: String
    public let scope: String
    public let rendering: String?
    public let blocks: [Block]
    public let showInSidebar: Bool?
    public let order: Int?
  }
  public struct Block: Decodable, Sendable {
    public let id: String
    public let type: String
    public let actionId: String
    public let requiresProject: Bool?
    public let title: String?
    public let description: String?
    public let input: [String: IntegrationValue]?
    public let previewInput: [String: IntegrationValue]?
    public let statusFilter: String?
    public let assigneeFilter: String?
    public let fields: [IntegrationFormField]?
  }
}

/// Redacted display data and immutable provider plans. Swift never reads or merges the referenced files.
public struct ConfigurationPage: Decodable, Sendable {
  public let configuration: Bool
  public let items: [Item]
  public let presentation: Presentation?
  public let registry: ConfigurationRegistry?
  public let operationSupport: Support?
  public let preview: Preview?
  public let history: [History]?
  public let repositories: [Repository]?
  public let skillsAudit: Audit?
  public let managementTools: [Tool]?
  public let message: String?
  public struct Presentation: Decodable, Sendable {
    public let version: Int
    public let writableItemIds: [String]
    public let backupSourceIds: [String: [String]]?
  }
  public struct Support: Decodable, Sendable {
    public let state: String
    public let cliVersion: String?
    public let platform: String?
    public let message: String?
    public let operations: [String: SoftwareSnapshot.Support.Operation]
  }
  public struct Item: Decodable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let kind: String
    public let owner: String
    public let origin: String
    public let localPath: String
    public let sourcePath: String?
    public let sourceId: String?
    public let audience: String?
    public let resource: String?
    public let competingSources: [String]?
    public let status: String
    public let revision: String
    public let local: String
    public let source: String
    public let fields: [String]
    public let management: String?
    public let client: String?
    public let scope: String?
    public let manager: String?
    public let provenance: Provenance?
  }
  public struct Provenance: Decodable, Sendable {
    public let label: String
    public let path: String?
  }
  public struct Preview: Decodable, Identifiable, Sendable {
    public let planId: String
    public let changes: [Change]
    public var id: String { planId }
  }
  public struct Change: Decodable, Sendable {
    public let path: String
    public let direction: String
    public let before: String
    public let after: String
    public let deletion: Bool
  }
  public struct History: Decodable, Identifiable, Sendable {
    public let planId: String
    public let state: String
    public let createdAt: String?
    public let paths: [String]?
    public let error: String?
    public var id: String { planId }
  }
  public struct Repository: Decodable, Identifiable, Sendable {
    public let id: String
    public let root: String
    public let branch: String?
    public let revision: String?
    public let ahead: Int?
    public let behind: Int?
    public let outgoing: [String]?
    public let outgoingDiff: String?
    public let workingDiff: String?
    public let dirty: Bool?
    public let diverged: Bool?
    public let error: String?
    public let paths: [Path]?
    public struct Path: Decodable, Sendable {
      public let path: String
      public let status: String
    }
  }
  public struct Audit: Decodable, Sendable {
    public let state: String
    public let checkedAt: String?
    public let summary: Summary?
    public let findings: [Finding]
    public let message: String?
    public struct Summary: Decodable, Sendable {
      public let skillFileCount: Int
      public let implicitSkillCount: Int
      public let explicitOnlySkillCount: Int
      public let warningCount: Int
      public let errorCount: Int
    }
    public struct Finding: Decodable, Sendable {
      public let code: String
      public let severity: String
      public let message: String
      public let paths: [String]
    }
  }
  public struct Tool: Decodable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let url: String
    public let software: Software?
    public struct Software: Decodable, Sendable {
      public let sourceId: String
      public let softwareId: String
    }
  }
  public func supports(_ operation: String) -> Bool {
    operation == "inspect" || operationSupport == nil
      || (operationSupport?.state == "available" && operationSupport?.operations[operation]?.supported == true)
  }
  public func writable(_ id: String) -> Bool {
    presentation?.version == 1 && presentation?.writableItemIds.contains(id) == true
  }
}
public struct ConfigurationDecision: Encodable, Equatable, Sendable {
  public let id: String
  public let revision: String
  public var choice: String
  public var fields: [String: String]
  public init(id: String, revision: String, choice: String, fields: [String: String] = [:]) {
    self.id = id
    self.revision = revision
    self.choice = choice
    self.fields = fields
  }
}
public struct ConfigurationCommand: Encodable, Sendable {
  public let operation: String
  public var decisions: [ConfigurationDecision]?
  public var planId: String?
  public var action: String?
  public var repository: String?
  public var revision: String?
  public var paths: [String]?
  public var message: String?
  public var registry: ConfigurationRegistryMutation?
  public var targetId: String?
  public var resolution: String?
  public init(operation: String, decisions: [ConfigurationDecision]? = nil, planId: String? = nil) {
    self.operation = operation
    self.decisions = decisions
    self.planId = planId
  }
}
extension RuntimeAPIClient {
  public func nativeIntegrations() async throws -> NativeIntegrationCatalog {
    try await fetch(path: "/api/integrations")
  }
  /// Execute only a declared integration action; the runtime resolves its permissions and provider again.
  public func configurationAction(integration: String, action: String, command: ConfigurationCommand, confirmed: Bool)
    async throws -> ConfigurationPage
  {
    struct Request: Encodable {
      let input: ConfigurationCommand
      let confirmed: Bool
    }
    let result: ConfigurationPage = try await fetch(
      path: "/api/integrations/\(Self.configurationSegment(integration))/actions/\(Self.configurationSegment(action))",
      body: JSONEncoder().encode(Request(input: command, confirmed: confirmed)), timeout: 120)
    guard result.configuration else { throw RuntimeAPIError.invalidResponse }
    return result
  }
  public static func configurationSegment(_ value: String) throws -> String {
    try segment(value)
  }
}

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

extension RuntimeAPIClient {
  /// Read declarations for native navigation and host capabilities; business pages render in the shared Web UI.
  public func nativeIntegrations() async throws -> NativeIntegrationCatalog {
    try await fetch(path: "/api/integrations")
  }
}

import Foundation

/// Provider-native identity. No account, installation or container can be inferred from a display ID.
public struct WorkItemSourceReference: Codable, Equatable, Sendable {
  public let providerId: String
  public let instanceId: String
  public let accountId: String
  public let containerId: String
  public let kind: String
  public let itemId: String
  public init(
    providerId: String, instanceId: String, accountId: String, containerId: String, kind: String, itemId: String
  ) {
    self.providerId = providerId
    self.instanceId = instanceId
    self.accountId = accountId
    self.containerId = containerId
    self.kind = kind
    self.itemId = itemId
  }
  public var input: IntegrationValue {
    .object([
      "providerId": .string(providerId), "instanceId": .string(instanceId), "accountId": .string(accountId),
      "containerId": .string(containerId), "kind": .string(kind), "itemId": .string(itemId),
    ])
  }
}

/// Explicit source scope for a native quick action; cached targets can only display their loaded snapshot.
public struct WorkItemActionTarget: Decodable, Equatable, Sendable {
  public let integrationId: String
  public let projectId: String?
  public let item: IntegrationPresentation.Entity
  public let readOnly: Bool
  public let accountKey: String?
  public let connectionCacheKey: String?
  public let connectionInput: [String: IntegrationValue]
  public init(
    integrationId: String, projectId: String? = nil, item: IntegrationPresentation.Entity,
    readOnly: Bool = false, accountKey: String? = nil, connectionCacheKey: String? = nil,
    connectionInput: [String: IntegrationValue] = [:]
  ) {
    self.integrationId = integrationId
    self.projectId = projectId
    self.item = item
    self.readOnly = readOnly
    self.accountKey = accountKey
    self.connectionCacheKey = connectionCacheKey
    self.connectionInput = connectionInput
  }
  enum CodingKeys: String, CodingKey {
    case integrationId, projectId, item, readOnly, accountKey, connectionCacheKey, connectionInput
  }
  public init(from decoder: Decoder) throws {
    let value = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      integrationId: try value.decode(String.self, forKey: .integrationId),
      projectId: try value.decodeIfPresent(String.self, forKey: .projectId),
      item: try value.decode(IntegrationPresentation.Entity.self, forKey: .item),
      readOnly: try value.decodeIfPresent(Bool.self, forKey: .readOnly) ?? false,
      accountKey: try value.decodeIfPresent(String.self, forKey: .accountKey),
      connectionCacheKey: try value.decodeIfPresent(String.self, forKey: .connectionCacheKey),
      connectionInput: try value.decodeIfPresent([String: IntegrationValue].self, forKey: .connectionInput) ?? [:])
  }
}

extension IntegrationPresentation.Entity {
  /// Metadata is inert input; complete source identity and its native item ID always take precedence.
  public var workItemInput: [String: IntegrationValue] {
    var result = metadata ?? [:]
    result["itemId"] = .string(sourceRef?.itemId ?? id)
    if let sourceRef { result["sourceRef"] = sourceRef.input }
    return result
  }

  /// A receipt may omit sourceRef, but a conflicting identity must never update the selected item.
  public func refersToSameWorkItem(as other: Self) -> Bool {
    if let sourceRef, let next = other.sourceRef { return sourceRef == next }
    guard id == other.id else { return false }
    for key in ["workspaceId", "containerId", "type"] {
      if let expected = metadata?[key], let actual = other.metadata?[key], expected != actual { return false }
    }
    return true
  }
}

/// Live, provider-owned workflow options. Choosing a transition does not execute it.
public struct WorkItemStatusTransitions: Decodable, Sendable {
  public let currentStatus: String
  public let transitions: [Transition]
  public struct Transition: Decodable, Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let fromStatus: String
    public let toStatus: String
    public let requiredFields: [String]
    public init(id: String, title: String, fromStatus: String, toStatus: String, requiredFields: [String] = []) {
      self.id = id
      self.title = title
      self.fromStatus = fromStatus
      self.toStatus = toStatus
      self.requiredFields = requiredFields
    }
  }
}

extension RuntimeAPIClient {
  /// The ordinary action endpoint retains runtime trust checks; transitions are not presentation entities.
  public func workItemTransitions(
    integration: String, action: String, project: String? = nil, input: [String: IntegrationValue]
  ) async throws -> WorkItemStatusTransitions {
    struct Body: Encodable {
      let input: [String: IntegrationValue]
      let confirmed = false
      let reviewedAction = ["operation": "work-items.transitions", "effect": "remote-read"]
    }
    let prefix = try project.map { "/api/projects/\(try Self.segment($0))" } ?? "/api"
    return try await fetch(
      path: "\(prefix)/integrations/\(try Self.segment(integration))/actions/\(try Self.segment(action))",
      body: JSONEncoder().encode(Body(input: input)))
  }
}

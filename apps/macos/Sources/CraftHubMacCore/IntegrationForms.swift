import Foundation

/// Raw field values are normalized by the shared runtime, never by a second native domain implementation.
public struct IntegrationFormField: Decodable, Identifiable, Sendable {
  public let id: String
  public let label: String
  public let type: String
  public let required: Bool?
  public let value: IntegrationValue?
  public let options: [Choice]?
  public let suggestions: [Choice]?
  public let placeholder: String?
  public var initialValue: String {
    switch value {
    case .string(let value): value
    case .number(let value): String(value)
    case .bool(let value): value ? "true" : "false"
    default: ""
    }
  }
  public struct Choice: Decodable, Sendable {
    public let label: String
    public let value: String
  }
}
public struct IntegrationFormSelector: Encodable, Sendable {
  public let viewId: String
  public let blockId: String
  public var resource: Resource?
  public init(viewId: String, blockId: String, resourceInput: [String: IntegrationValue]? = nil, formId: String? = nil)
  {
    self.viewId = viewId
    self.blockId = blockId
    if let resourceInput, let formId { resource = Resource(input: resourceInput, formId: formId) }
  }
  public struct Resource: Encodable, Sendable {
    public let input: [String: IntegrationValue]
    public let formId: String
  }
}
/// The server owns the frozen input, definition/account revision, ten-minute expiry and one-use consumption.
public struct IntegrationFormPlan: Decodable, Identifiable, Sendable {
  public var id: String { planId }
  public let version: Int
  public let planId: String
  public let title: String
  public let description: String?
  public let effect: String
  public let operation: String
  public let requiresConfirmation: Bool
  public let expiresAt: String
  public let project: Project?
  public let fields: [Field]
  public struct Project: Decodable, Sendable {
    public let id: String
    public let name: String
    public let trust: String
  }
  public struct Field: Decodable, Sendable {
    public let label: String
    public let value: String
  }
}
extension RuntimeAPIClient {
  public func prepareIntegrationForm(
    integration: String, project: String?, selector: IntegrationFormSelector,
    values: [String: String], locale: String
  ) async throws -> IntegrationFormPlan {
    struct Body: Encodable {
      let selector: IntegrationFormSelector
      let values: [String: String]
      let locale: String
    }
    let result: IntegrationFormPlan = try await fetch(
      path: formPath(integration, project, "prepare"),
      body: JSONEncoder().encode(Body(selector: selector, values: values, locale: locale)))
    guard result.version == 1 else { throw RuntimeAPIError.incompatibleVersion }
    return result
  }
  public func executeIntegrationForm(integration: String, project: String?, plan: String, confirmed: Bool) async throws
    -> IntegrationPresentation
  {
    struct Body: Encodable {
      let planId: String
      let confirmed: Bool
    }
    let result: IntegrationPresentation = try await fetch(
      path: formPath(integration, project, "execute"),
      body: JSONEncoder().encode(Body(planId: plan, confirmed: confirmed)))
    guard result.version == 1 else { throw RuntimeAPIError.incompatibleVersion }
    return result
  }
  public func discardIntegrationForm(integration: String, project: String?, plan: String) async throws {
    struct Acknowledgement: Decodable { let version: Int }
    let _: Acknowledgement = try await fetch(
      path: formPath(integration, project, "discard"), body: JSONEncoder().encode(["planId": plan]))
  }
  private func formPath(_ integration: String, _ project: String?, _ operation: String) throws -> String {
    let prefix = try project.map { "/api/projects/\(try Self.segment($0))" } ?? "/api"
    return "\(prefix)/integrations/\(try Self.segment(integration))/forms/\(operation)"
  }
}

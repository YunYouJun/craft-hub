import Foundation

/// Provider-owned resource content. Documents, form summaries and navigation inputs are inert display data.
public struct IntegrationResourcePage: Decodable, Sendable {
  public let title: String
  public let description: String?
  public let input: [String: IntegrationValue]
  public let refreshAfterMs: Double?
  public let entities: [IntegrationPresentation.Entity]?
  public let links: [Link]?
  public let documents: [Document]?
  public let forms: [Form]?
  public let projectSuggestions: [ProjectSuggestion]?
  public struct Link: Decodable, Sendable {
    public let title: String
    public let input: [String: IntegrationValue]
    public let projectId: String?
  }
  public struct Document: Decodable, Sendable {
    public let id: String
    public let title: String
    public let content: String
    public let filename: String?
    public let compareWith: String?
    public let agentPrompt: String?
  }
  public struct Form: Decodable, Sendable {
    public let id: String
    public let title: String
    public let description: String?
    public let effect: String
    public let fields: [IntegrationFormField]?
  }
  public struct ProjectSuggestion: Decodable, Sendable {
    public let path: String
    public let title: String
  }
}

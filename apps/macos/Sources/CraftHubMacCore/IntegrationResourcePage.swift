import Foundation

/// Provider-owned resource content. Documents, form summaries and navigation inputs are inert display data.
public struct IntegrationResourcePage: Decodable, Sendable {
  public let title: String
  public let description: String?
  public let input: [String: IntegrationValue]
  public let refreshAfterMs: Double?
  public let collection: Collection?
  public let browserImport: BrowserImport?
  public let entities: [IntegrationPresentation.Entity]?
  public let links: [Link]?
  public let documents: [Document]?
  public let forms: [Form]?
  public let projectSuggestions: [ProjectSuggestion]?
  public struct Collection: Decodable, Sendable {
    public let columns: [Column]
    public let rows: [Row]
    public let selectedIds: [String]
    public let selectionInput: String
    public let filterFormId: String
    public let hiddenFormIds: [String]
    public let hiddenDocumentIds: [String]
    public struct Column: Decodable, Identifiable, Sendable {
      public let id: String
      public let label: String
    }
    public struct Row: Decodable, Identifiable, Sendable {
      public let id: String
      public let cells: [String: String]
      public let copyValue: String
      public let credentialKey: String?
      public let input: [String: IntegrationValue]?
    }
  }
  public struct BrowserImport: Codable, Sendable {
    public let id: String
    public let title: String
    public let url: String
    public let allowedOrigins: [String]
    public let formId: String
    public let request: Request
    public let response: Response
    public let credentials: Credentials
    public struct Request: Codable, Sendable {
      public let path: String
      public let operatorGlobal: String
      public let operatorParameter: String
    }
    public struct Response: Codable, Sendable {
      public let recordsPath: [String]
      public let successField: String
      public let successValue: Int
    }
    public struct Credentials: Codable, Sendable {
      public let keyField: String
      public let secretField: String
      public let availableField: String
      public let publicFields: [String]
    }
  }
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
